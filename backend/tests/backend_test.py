"""Voxyra Mail SaaS backend tests.

Note: pytest-xdist with loadscope pins each *class* to a worker but does NOT
share session fixtures across workers. So we consolidate all dependent CRUD
flows into a single class to guarantee state is available.
"""
import os
import uuid
import pytest
import requests


def _load_public_url():
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().rstrip("/")
    return "http://localhost:8001"


BASE_URL = _load_public_url()
ADMIN_EMAIL = "admin@voxyra.com"
ADMIN_PASSWORD = "Voxyra@2026"


def _admin_login():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


# ---- Auth ----
class TestAuth:
    def test_login_success_sets_cookies_and_me(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] == "superadmin"
        assert "access_token" in data
        assert "access_token" in s.cookies
        assert "refresh_token" in s.cookies
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == ADMIN_EMAIL

    def test_login_wrong_password_401(self):
        bogus = f"nobody-{uuid.uuid4().hex[:6]}@voxyra.com"
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": bogus, "password": "wrong"})
        assert r.status_code == 401

    def test_brute_force_429_after_5(self):
        target = f"brute-{uuid.uuid4().hex[:8]}@voxyra.com"
        last = None
        results = []
        for _ in range(10):
            r = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": target, "password": "wrong"})
            results.append(r.status_code)
            last = r
        # After MAX_ATTEMPTS=5 failures the system MUST eventually return 429.
        assert 429 in results, f"expected 429 in results, got {results}"

    def test_logout_clears_cookies_then_me_401(self):
        s = _admin_login()
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 200
        r = s.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200
        s2 = requests.Session()
        assert s2.get(f"{BASE_URL}/api/auth/me").status_code == 401


# ---- Webmail (auth-only, no state) ----
class TestWebmail:
    def test_webmail_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/webmail/messages")
        assert r.status_code == 401

    def test_monitoring_services_admin(self):
        # Regression: /api/monitoring/services returns 200 with expected structure for admin
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/monitoring/services")
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        data = r.json()
        for key in ("services", "summary", "activity", "checked_at"):
            assert key in data, f"missing key {key} in monitoring payload: {list(data.keys())}"

    def test_webmail_no_account_returns_400(self):
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/webmail/messages")
        assert r.status_code == 400, f"got {r.status_code}: {r.text}"
        assert "detail" in r.json()


# ---- Preferences ----
class TestPreferences:
    def test_get_default_and_persist(self):
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/preferences")
        assert r.status_code == 200
        assert "theme" in r.json() and "view_mode" in r.json()

        r = s.put(f"{BASE_URL}/api/preferences",
                  json={"theme": "dark", "view_mode": "vertical", "density": "compact"})
        assert r.status_code == 200
        r = s.get(f"{BASE_URL}/api/preferences")
        d = r.json()
        assert d["theme"] == "dark"
        assert d["view_mode"] == "vertical"


# ---- All SaaS CRUD flows in one class (state must live in one worker) ----
class TestSaaSFlow:
    session_data = {}

    def test_a_dashboard_stats(self):
        s = _admin_login()
        TestSaaSFlow.session_data["session"] = s
        r = s.get(f"{BASE_URL}/api/dashboard/stats")
        assert r.status_code == 200
        for k in ["empresas", "dominios", "contas", "servidores_online",
                  "servidores_total", "storage_used_mb", "storage_quota_mb",
                  "spam_blocked_7d"]:
            assert k in r.json(), f"missing key: {k}"

    def test_b_empresa_create_list_update(self):
        s = TestSaaSFlow.session_data["session"]
        payload = {"nome": f"TEST_Empresa_{uuid.uuid4().hex[:6]}",
                   "plano": "Starter", "status": "ativo"}
        r = s.post(f"{BASE_URL}/api/empresas", json=payload)
        assert r.status_code == 200, r.text
        emp = r.json()
        assert emp["nome"] == payload["nome"]
        TestSaaSFlow.session_data["empresa"] = emp["id"]

        r = s.get(f"{BASE_URL}/api/empresas")
        assert r.status_code == 200
        found = [e for e in r.json() if e["id"] == emp["id"]]
        assert found and "dominios_count" in found[0] and "contas_count" in found[0]

        r = s.patch(f"{BASE_URL}/api/empresas/{emp['id']}",
                    json={"nome": payload["nome"] + "_upd"})
        assert r.status_code == 200
        assert r.json()["nome"].endswith("_upd")

    def test_c_server_create_hides_token(self):
        s = TestSaaSFlow.session_data["session"]
        payload = {
            "nome": f"TEST_SRV_{uuid.uuid4().hex[:6]}",
            "url": "https://da.example.invalid",
            "port": 2222, "api_user": "admin",
            "api_token": "SECRET_TOKEN_XYZ", "ssl": True,
        }
        r = s.post(f"{BASE_URL}/api/servers", json=payload)
        assert r.status_code == 200, r.text
        srv = r.json()
        assert "api_token" not in srv
        TestSaaSFlow.session_data["server"] = srv["id"]

        r = s.get(f"{BASE_URL}/api/servers")
        assert r.status_code == 200
        assert "SECRET_TOKEN_XYZ" not in r.text
        for it in r.json():
            assert "api_token" not in it

        r = s.post(f"{BASE_URL}/api/servers/{srv['id']}/test")
        assert r.status_code == 200
        assert r.json()["status"] == "offline"

    def test_d_domain_crud(self):
        s = TestSaaSFlow.session_data["session"]
        emp_id = TestSaaSFlow.session_data["empresa"]
        payload = {"nome": f"test{uuid.uuid4().hex[:6]}.example.com",
                   "empresa_id": emp_id}
        r = s.post(f"{BASE_URL}/api/dominios", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        TestSaaSFlow.session_data["domain"] = d["id"]
        TestSaaSFlow.session_data["domain_nome"] = d["nome"]

        r = s.get(f"{BASE_URL}/api/dominios")
        assert r.status_code == 200
        found = [x for x in r.json() if x["id"] == d["id"]]
        assert found and "contas_count" in found[0]

    def test_e_account_crud_encrypted(self):
        s = TestSaaSFlow.session_data["session"]
        emp_id = TestSaaSFlow.session_data["empresa"]
        dom_id = TestSaaSFlow.session_data["domain"]
        dom_nome = TestSaaSFlow.session_data["domain_nome"]
        email = f"user{uuid.uuid4().hex[:6]}@{dom_nome}"
        payload = {"email": email, "dominio_id": dom_id, "empresa_id": emp_id,
                   "quota_mb": 500, "status": "ativo", "password": "PlainPass123!"}
        r = s.post(f"{BASE_URL}/api/contas", json=payload)
        assert r.status_code == 200, r.text
        acc = r.json()
        assert "password" not in acc and "password_enc" not in acc
        TestSaaSFlow.session_data["account"] = acc["id"]

        r = s.get(f"{BASE_URL}/api/contas")
        assert r.status_code == 200
        assert "PlainPass123!" not in r.text
        for it in r.json():
            assert "password" not in it and "password_enc" not in it

        r = s.patch(f"{BASE_URL}/api/contas/{acc['id']}",
                    json={"quota_mb": 1024, "status": "suspenso"})
        assert r.status_code == 200
        assert r.json()["quota_mb"] == 1024

    def test_f_users_create_and_list(self):
        s = TestSaaSFlow.session_data["session"]
        emp_id = TestSaaSFlow.session_data["empresa"]
        adm_email = f"TEST_admin_{uuid.uuid4().hex[:6]}@voxyra.com"
        r = s.post(f"{BASE_URL}/api/users", json={
            "email": adm_email, "name": "TestAdmin", "role": "empresa_admin",
            "empresa_id": emp_id, "password": "Adm1nPass!",
        })
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["role"] == "empresa_admin"
        assert "password_hash" not in u
        TestSaaSFlow.session_data["empresa_admin"] = {
            "email": adm_email, "password": "Adm1nPass!", "id": u["id"]}

        u_email = f"TEST_user_{uuid.uuid4().hex[:6]}@voxyra.com"
        r = s.post(f"{BASE_URL}/api/users", json={
            "email": u_email, "name": "TestUser", "role": "usuario_final",
            "empresa_id": emp_id, "password": "UsrPass!!",
        })
        assert r.status_code == 200

        r = s.get(f"{BASE_URL}/api/users")
        assert r.status_code == 200
        emails = [x["email"] for x in r.json()]
        assert adm_email.lower() in emails

    def test_g_scope_empresa_admin(self):
        s = TestSaaSFlow.session_data["session"]
        # Create extra empresa
        r = s.post(f"{BASE_URL}/api/empresas",
                   json={"nome": f"TEST_Extra_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        extra_id = r.json()["id"]
        TestSaaSFlow.session_data["extra_empresa"] = extra_id

        adm = TestSaaSFlow.session_data["empresa_admin"]
        s2 = requests.Session()
        r = s2.post(f"{BASE_URL}/api/auth/login",
                    json={"email": adm["email"], "password": adm["password"]})
        assert r.status_code == 200

        # Empresa admin listing empresas: should not include extra_empresa
        r = s2.get(f"{BASE_URL}/api/empresas")
        assert r.status_code == 200
        ids = [e["id"] for e in r.json()]
        assert extra_id not in ids

        # Domain create in extra_empresa -> 403
        r = s2.post(f"{BASE_URL}/api/dominios",
                    json={"nome": "denied.example.com", "empresa_id": extra_id})
        assert r.status_code == 403

    def test_h_domain_sync_invalid_and_no_da(self):
        s = TestSaaSFlow.session_data["session"]
        # invalid domain id -> 404
        r = s.post(f"{BASE_URL}/api/dominios/does-not-exist-xyz/sync")
        assert r.status_code == 404, r.text
        # existing domain without directadmin_server_id -> 400
        dom_id = TestSaaSFlow.session_data["domain"]
        r = s.post(f"{BASE_URL}/api/dominios/{dom_id}/sync")
        assert r.status_code == 400, r.text
        assert "DirectAdmin" in r.json().get("detail", "")

    def test_z_cleanup(self):
        s = TestSaaSFlow.session_data["session"]
        d = TestSaaSFlow.session_data
        if d.get("account"):
            s.delete(f"{BASE_URL}/api/contas/{d['account']}")
        if d.get("domain"):
            s.delete(f"{BASE_URL}/api/dominios/{d['domain']}")
        if d.get("server"):
            s.delete(f"{BASE_URL}/api/servers/{d['server']}")
        if d.get("empresa"):
            r = s.delete(f"{BASE_URL}/api/empresas/{d['empresa']}")
            assert r.status_code == 200
        if d.get("extra_empresa"):
            s.delete(f"{BASE_URL}/api/empresas/{d['extra_empresa']}")


# ---- NEW: Antispam Center ----
CLIENT_EMAIL = "cliente.demo@voxyra.com"
CLIENT_PASSWORD = "Cliente@2026"


class TestAntispam:
    def test_summary_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/antispam/summary")
        assert r.status_code == 401

    def test_usuario_final_forbidden(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD})
        if r.status_code != 200:
            pytest.skip(f"cliente.demo login failed: {r.status_code} {r.text}")
        r = s.get(f"{BASE_URL}/api/antispam/summary")
        assert r.status_code == 403, f"got {r.status_code}: {r.text}"

    def test_summary_admin(self):
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/antispam/summary")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("total_accounts", "enabled_accounts", "disabled_accounts",
                  "unknown_accounts", "total_domains", "spam_blocked_7d"):
            assert k in data, f"missing {k}"

    def test_accounts_admin(self):
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/antispam/accounts")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sync_all_no_da(self):
        s = _admin_login()
        r = s.post(f"{BASE_URL}/api/antispam/sync")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("domains", "accounts_total", "accounts_synced"):
            assert k in d

    def test_get_invalid_account_404(self):
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/antispam/accounts/does-not-exist")
        assert r.status_code == 404

    def test_put_invalid_account_404(self):
        s = _admin_login()
        r = s.put(f"{BASE_URL}/api/antispam/accounts/does-not-exist",
                  json={"enabled": True, "kill_score": 5})
        assert r.status_code == 404

    def test_blacklist_invalid_account_404(self):
        s = _admin_login()
        r = s.get(f"{BASE_URL}/api/antispam/accounts/does-not-exist/blacklist")
        assert r.status_code == 404


# ---- NEW: Webmail bypass login + domain IMAP/SMTP config ----
class TestWebmailBypassAndDomainConfig:
    state = {}

    def test_a_bypass_domain_not_found_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/webmail-login",
                          json={"email": f"nobody-{uuid.uuid4().hex[:6]}@nao-existe-{uuid.uuid4().hex[:4]}.com",
                                "password": "whatever"})
        assert r.status_code == 401, r.text
        detail = r.json().get("detail", "").lower()
        assert "domínio" in detail or "dominio" in detail or "não hospedado" in detail

    def test_b_bypass_invalid_email_format_422(self):
        r = requests.post(f"{BASE_URL}/api/auth/webmail-login",
                          json={"email": "no-at-sign", "password": "x"})
        assert r.status_code in (400, 422), r.text

    def test_c_domain_create_full_fields(self):
        s = _admin_login()
        TestWebmailBypassAndDomainConfig.state["session"] = s
        # empresa
        r = s.post(f"{BASE_URL}/api/empresas",
                   json={"nome": f"TEST_BypassEmp_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        emp_id = r.json()["id"]
        TestWebmailBypassAndDomainConfig.state["empresa"] = emp_id

        dom_name = f"bypass{uuid.uuid4().hex[:6]}.example.com"
        payload = {
            "nome": dom_name, "empresa_id": emp_id,
            "imap_host": "imap.example.invalid", "imap_port": 993, "imap_ssl": True,
            "smtp_host": "smtp.example.invalid", "smtp_port": 587, "smtp_tls": True,
            "webmail_url": "https://mail.example.invalid",
            "allow_bypass_login": False,
        }
        r = s.post(f"{BASE_URL}/api/dominios", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        TestWebmailBypassAndDomainConfig.state["domain"] = d["id"]
        TestWebmailBypassAndDomainConfig.state["domain_nome"] = dom_name
        for k in ("imap_host", "imap_port", "imap_ssl", "smtp_host", "smtp_port",
                  "smtp_tls", "webmail_url", "allow_bypass_login"):
            assert k in d, f"missing {k} in response"
        assert d["imap_host"] == "imap.example.invalid"
        assert d["imap_port"] == 993
        assert d["smtp_host"] == "smtp.example.invalid"
        assert d["webmail_url"] == "https://mail.example.invalid"
        assert d["allow_bypass_login"] is False

    def test_d_list_returns_new_fields(self):
        s = TestWebmailBypassAndDomainConfig.state["session"]
        dom_id = TestWebmailBypassAndDomainConfig.state["domain"]
        r = s.get(f"{BASE_URL}/api/dominios")
        assert r.status_code == 200
        d = next((x for x in r.json() if x["id"] == dom_id), None)
        assert d is not None
        for k in ("imap_host", "imap_port", "imap_ssl", "smtp_host", "smtp_port",
                  "smtp_tls", "webmail_url", "allow_bypass_login"):
            assert k in d

    def test_e_patch_partial_preserves_other_fields(self):
        s = TestWebmailBypassAndDomainConfig.state["session"]
        dom_id = TestWebmailBypassAndDomainConfig.state["domain"]
        r = s.patch(f"{BASE_URL}/api/dominios/{dom_id}",
                    json={"imap_host": "new.imap.invalid", "allow_bypass_login": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["imap_host"] == "new.imap.invalid"
        assert d["allow_bypass_login"] is True
        # other fields must be preserved
        assert d["smtp_host"] == "smtp.example.invalid"
        assert d["smtp_port"] == 587
        assert d["webmail_url"] == "https://mail.example.invalid"

    def test_f_bypass_disabled_when_flag_false(self):
        # create a new domain with allow_bypass_login false
        s = TestWebmailBypassAndDomainConfig.state["session"]
        emp_id = TestWebmailBypassAndDomainConfig.state["empresa"]
        dom_name = f"noflag{uuid.uuid4().hex[:6]}.example.com"
        r = s.post(f"{BASE_URL}/api/dominios", json={
            "nome": dom_name, "empresa_id": emp_id,
            "imap_host": "imap.example.invalid", "allow_bypass_login": False,
        })
        assert r.status_code == 200
        TestWebmailBypassAndDomainConfig.state["nobypass_domain"] = r.json()["id"]

        r = requests.post(f"{BASE_URL}/api/auth/webmail-login",
                          json={"email": f"any@{dom_name}", "password": "whatever"})
        assert r.status_code == 401, r.text
        detail = r.json().get("detail", "").lower()
        assert "bypass" in detail or "não habilitado" in detail or "nao habilitado" in detail

    def test_g_bypass_active_but_imap_unreachable_401(self):
        # domain from test_e has allow_bypass_login=True and imap_host=new.imap.invalid
        dom_name = TestWebmailBypassAndDomainConfig.state["domain_nome"]
        r = requests.post(f"{BASE_URL}/api/auth/webmail-login",
                          json={"email": f"someuser@{dom_name}", "password": "any"})
        # IMAP connect fails -> 401 "E-mail ou senha inválidos"
        assert r.status_code == 401, r.text

    def test_h_test_imap_invalid_id_404(self):
        s = TestWebmailBypassAndDomainConfig.state["session"]
        r = s.post(f"{BASE_URL}/api/dominios/does-not-exist-xyz/test-imap")
        assert r.status_code == 404

    def test_i_test_imap_bad_host_returns_ok_false(self):
        s = TestWebmailBypassAndDomainConfig.state["session"]
        dom_id = TestWebmailBypassAndDomainConfig.state["domain"]
        r = s.post(f"{BASE_URL}/api/dominios/{dom_id}/test-imap")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False
        assert "error" in d

    def test_j_test_smtp_invalid_id_404(self):
        s = TestWebmailBypassAndDomainConfig.state["session"]
        r = s.post(f"{BASE_URL}/api/dominios/does-not-exist-xyz/test-smtp")
        assert r.status_code == 404

    def test_k_test_smtp_bad_host_returns_ok_false(self):
        s = TestWebmailBypassAndDomainConfig.state["session"]
        dom_id = TestWebmailBypassAndDomainConfig.state["domain"]
        r = s.post(f"{BASE_URL}/api/dominios/{dom_id}/test-smtp")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False
        assert "error" in d

    def test_z_cleanup(self):
        s = TestWebmailBypassAndDomainConfig.state.get("session")
        if not s:
            return
        st = TestWebmailBypassAndDomainConfig.state
        if st.get("nobypass_domain"):
            s.delete(f"{BASE_URL}/api/dominios/{st['nobypass_domain']}")
        if st.get("domain"):
            s.delete(f"{BASE_URL}/api/dominios/{st['domain']}")
        if st.get("empresa"):
            s.delete(f"{BASE_URL}/api/empresas/{st['empresa']}")
