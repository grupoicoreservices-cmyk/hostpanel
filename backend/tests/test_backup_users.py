"""Tests for iteration 8: backup CRUD, users mgmt, and account password bug fix."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://mail-platform-14.preview.emergentagent.com').rstrip('/')

ADMIN_EMAIL = "admin@voxyra.com"
ADMIN_PASS = "Voxyra@2026"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin_me(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 200
    return r.json()


# ============================================================
# BACKUP SERVERS CRUD
# ============================================================
class TestBackupServers:
    created_ids = []

    def test_unauthenticated_401(self):
        r = requests.get(f"{BASE_URL}/api/backup/servers", timeout=10)
        assert r.status_code == 401, f"Expected 401 got {r.status_code}"

    def test_list_initially(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/backup/servers", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_password_missing(self, admin_session):
        payload = {
            "nome": "TEST_bkp_nopass", "protocol": "sftp", "host": "example.com",
            "port": 22, "username": "u", "auth_type": "password", "base_path": "/backup",
        }
        r = admin_session.post(f"{BASE_URL}/api/backup/servers", json=payload, timeout=10)
        assert r.status_code == 400
        assert "senha" in r.text.lower() or "obrigat" in r.text.lower()

    def test_create_key_missing(self, admin_session):
        payload = {
            "nome": "TEST_bkp_nokey", "protocol": "sftp", "host": "example.com",
            "port": 22, "username": "u", "auth_type": "key", "base_path": "/backup",
        }
        r = admin_session.post(f"{BASE_URL}/api/backup/servers", json=payload, timeout=10)
        assert r.status_code == 400
        assert "chave" in r.text.lower()

    def test_create_valid(self, admin_session):
        payload = {
            "nome": "TEST_bkp_1", "protocol": "sftp", "host": "nonexistent.invalid",
            "port": 22, "username": "backup", "auth_type": "password",
            "password": "supersecret", "base_path": "/backup",
        }
        r = admin_session.post(f"{BASE_URL}/api/backup/servers", json=payload, timeout=10)
        assert r.status_code == 201, r.text
        data = r.json()
        assert "id" in data and data["id"]
        # sensitive fields NOT present
        for k in ("password_enc", "private_key_enc", "passphrase_enc"):
            assert k not in data, f"Sensitive field {k} leaked in response"
        assert data["nome"] == "TEST_bkp_1"
        assert data["port"] == 22
        TestBackupServers.created_ids.append(data["id"])

    def test_get_single(self, admin_session):
        assert TestBackupServers.created_ids, "prereq: create test failed"
        sid = TestBackupServers.created_ids[0]
        r = admin_session.get(f"{BASE_URL}/api/backup/servers/{sid}", timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("password_enc", "private_key_enc", "passphrase_enc"):
            assert k not in d

    def test_patch_enabled_false(self, admin_session):
        sid = TestBackupServers.created_ids[0]
        r = admin_session.patch(f"{BASE_URL}/api/backup/servers/{sid}", json={"enabled": False}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("enabled") is False

    def test_patch_preserves_password(self, admin_session):
        """PATCH sem password preserva password_enc existente."""
        sid = TestBackupServers.created_ids[0]
        # Update just nome — should keep password intact
        r = admin_session.patch(f"{BASE_URL}/api/backup/servers/{sid}", json={"nome": "TEST_bkp_1_renamed"}, timeout=10)
        assert r.status_code == 200
        # Directly check via mongo — using another API call: test connection will use password
        # We check via server admin fields don't have password_enc in response but stored still.
        # Best proxy: run test endpoint; expects to still auth with old pw before failing on DNS.
        r2 = admin_session.post(f"{BASE_URL}/api/backup/servers/{sid}/test", timeout=20)
        # Should error 502 due to invalid host — but not because password missing
        assert r2.status_code in (502, 400)
        # Ensure error is not about missing password
        assert "senha" not in r2.text.lower() or "gaierror" in r2.text.lower() or "getaddr" in r2.text.lower()

    def test_patch_updates_password(self, admin_session):
        sid = TestBackupServers.created_ids[0]
        r = admin_session.patch(f"{BASE_URL}/api/backup/servers/{sid}", json={"password": "novaSenha123"}, timeout=10)
        assert r.status_code == 200

    def test_connection_invalid_host(self, admin_session):
        sid = TestBackupServers.created_ids[0]
        r = admin_session.post(f"{BASE_URL}/api/backup/servers/{sid}/test", timeout=30)
        # backend returns 502 (may pass through cloudflare as html)
        assert r.status_code in (502, 400, 500), f"Got {r.status_code}: {r.text[:200]}"
        # verify last_status updated
        r2 = admin_session.get(f"{BASE_URL}/api/backup/servers/{sid}", timeout=10)
        assert r2.status_code == 200
        st = r2.json().get("last_status", "")
        assert st.startswith("error:") or st == "never", f"Unexpected last_status: {st}"

    def test_delete(self, admin_session):
        for sid in TestBackupServers.created_ids:
            r = admin_session.delete(f"{BASE_URL}/api/backup/servers/{sid}", timeout=10)
            assert r.status_code == 200
            # verify gone
            r2 = admin_session.get(f"{BASE_URL}/api/backup/servers/{sid}", timeout=10)
            assert r2.status_code == 404
        TestBackupServers.created_ids.clear()


# ============================================================
# USERS MANAGEMENT
# ============================================================
class TestUsers:
    created_user_id = None

    def test_create_test_user(self, admin_session):
        payload = {
            "email": "TEST_user_it8@voxyra.com",
            "password": "senha_valida_12345",
            "name": "Test User",
            "role": "usuario_final",
            "empresa_id": None,
        }
        # Clean up any existing
        r = admin_session.get(f"{BASE_URL}/api/users", timeout=10)
        if r.status_code == 200:
            for u in r.json():
                if u.get("email") == payload["email"]:
                    admin_session.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=10)

        r = admin_session.post(f"{BASE_URL}/api/users", json=payload, timeout=10)
        assert r.status_code == 200, r.text
        TestUsers.created_user_id = r.json()["id"]

    def test_patch_name(self, admin_session):
        uid = TestUsers.created_user_id
        r = admin_session.patch(f"{BASE_URL}/api/users/{uid}", json={"name": "Novo Nome"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["name"] == "Novo Nome"

    def test_patch_invalid_role(self, admin_session):
        uid = TestUsers.created_user_id
        r = admin_session.patch(f"{BASE_URL}/api/users/{uid}", json={"role": "perfil_invalido"}, timeout=10)
        assert r.status_code == 400
        assert "perfil" in r.text.lower() or "invalid" in r.text.lower()

    def test_cannot_deactivate_self(self, admin_session, admin_me):
        me_id = admin_me["id"]
        r = admin_session.patch(f"{BASE_URL}/api/users/{me_id}", json={"is_active": False}, timeout=10)
        assert r.status_code == 400
        assert "desativar" in r.text.lower() or "si mesmo" in r.text.lower()

    def test_cannot_delete_self(self, admin_session, admin_me):
        me_id = admin_me["id"]
        r = admin_session.delete(f"{BASE_URL}/api/users/{me_id}", timeout=10)
        assert r.status_code == 400
        assert "excluir" in r.text.lower() or "si mesmo" in r.text.lower()

    def test_reset_password_too_short(self, admin_session):
        uid = TestUsers.created_user_id
        r = admin_session.post(f"{BASE_URL}/api/users/{uid}/reset-password", json={"password": "abc"}, timeout=10)
        assert r.status_code == 400

    def test_reset_password_valid(self, admin_session):
        uid = TestUsers.created_user_id
        r = admin_session.post(f"{BASE_URL}/api/users/{uid}/reset-password", json={"password": "senha_valida_12345"}, timeout=10)
        assert r.status_code == 200

    def test_delete_user_cleanup(self, admin_session):
        uid = TestUsers.created_user_id
        if uid:
            r = admin_session.delete(f"{BASE_URL}/api/users/{uid}", timeout=10)
            assert r.status_code == 200


# ============================================================
# ACCOUNT PASSWORD BUG FIX
# ============================================================
class TestAccountPasswordBugFix:
    """The bug: PATCH /api/contas/{id} with password wasn't working via panel."""
    account_id = None
    domain_id = None
    empresa_id = None

    @pytest.fixture(scope="class", autouse=True)
    def setup_seed(self, admin_session):
        """Create empresa + domain (no DA server) + account directly via API."""
        import uuid
        suffix = uuid.uuid4().hex[:6]
        # empresa
        r = admin_session.post(f"{BASE_URL}/api/empresas", json={"nome": f"TEST_emp_{suffix}"}, timeout=10)
        assert r.status_code == 200, r.text
        TestAccountPasswordBugFix.empresa_id = r.json()["id"]
        # domain — no directadmin_server_id
        r = admin_session.post(f"{BASE_URL}/api/dominios", json={
            "nome": f"test-{suffix}.example.com",
            "empresa_id": TestAccountPasswordBugFix.empresa_id,
        }, timeout=10)
        assert r.status_code == 200, r.text
        TestAccountPasswordBugFix.domain_id = r.json()["id"]
        # account
        r = admin_session.post(f"{BASE_URL}/api/contas", json={
            "email": f"user-{suffix}@test-{suffix}.example.com",
            "password": "senhaInicial123",
            "dominio_id": TestAccountPasswordBugFix.domain_id,
            "empresa_id": TestAccountPasswordBugFix.empresa_id,
            "quota_mb": 100,
        }, timeout=10)
        assert r.status_code == 200, r.text
        TestAccountPasswordBugFix.account_id = r.json()["id"]

        yield

        # teardown
        if TestAccountPasswordBugFix.account_id:
            admin_session.delete(f"{BASE_URL}/api/contas/{TestAccountPasswordBugFix.account_id}", timeout=10)
        if TestAccountPasswordBugFix.domain_id:
            admin_session.delete(f"{BASE_URL}/api/dominios/{TestAccountPasswordBugFix.domain_id}", timeout=10)
        if TestAccountPasswordBugFix.empresa_id:
            admin_session.delete(f"{BASE_URL}/api/empresas/{TestAccountPasswordBugFix.empresa_id}", timeout=10)

    def test_patch_password_too_short_returns_400(self, admin_session):
        aid = TestAccountPasswordBugFix.account_id
        r = admin_session.patch(f"{BASE_URL}/api/contas/{aid}", json={"password": "abc"}, timeout=10)
        assert r.status_code == 400
        assert "curta" in r.text.lower() or "mínimo" in r.text.lower() or "minimo" in r.text.lower()

    def test_patch_password_valid_no_da_returns_200(self, admin_session):
        aid = TestAccountPasswordBugFix.account_id
        r = admin_session.patch(f"{BASE_URL}/api/contas/{aid}", json={"password": "senha_valida_123"}, timeout=10)
        assert r.status_code == 200, r.text


# ============================================================
# REGRESSION
# ============================================================
class TestRegression:
    def test_dashboard_stats(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/stats", timeout=10)
        assert r.status_code == 200

    def test_spam_overview(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/spam/admin/overview", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict)

    def test_list_dominios(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dominios", timeout=10)
        assert r.status_code == 200
