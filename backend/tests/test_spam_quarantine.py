"""Testes de contrato para endpoints /api/spam/* (nova feature Spam Quarantine).

O ambiente de preview NÃO possui IMAP real nem contas de e-mail vinculadas
ao superadmin. Os testes verificam:
  - códigos HTTP corretos (401 sem auth, 400 quando conta indisponível, 404 para admin sobre ID inválido)
  - overview admin retorna estrutura correta mesmo com zero contas
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@voxyra.com"
ADMIN_PASSWORD = "Voxyra@2026"


@pytest.fixture(scope="module")
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return s


# ------------------------ AUTH GUARD (no cookies) ------------------------
USER_ENDPOINTS = [
    ("GET", "/api/spam/folder", None),
    ("GET", "/api/spam/messages", None),
    ("POST", "/api/spam/not-spam", {"uids": [], "add_whitelist": False}),
    ("POST", "/api/spam/report", {"uids": [], "src_folder": "INBOX", "add_blacklist": False}),
    ("DELETE", "/api/spam/messages", {"uids": []}),
    ("POST", "/api/spam/whitelist", {"addresses": []}),
    ("POST", "/api/spam/blacklist", {"addresses": []}),
    ("GET", "/api/spam/stats", None),
]

ADMIN_ENDPOINTS = [
    ("GET", "/api/spam/admin/overview", None),
    ("GET", "/api/spam/admin/accounts/invalid-id-xxx", None),
    ("POST", "/api/spam/admin/accounts/invalid-id-xxx/not-spam", {"uids": []}),
    ("DELETE", "/api/spam/admin/accounts/invalid-id-xxx/messages", {"uids": []}),
]


@pytest.mark.parametrize("method,path,body", USER_ENDPOINTS + ADMIN_ENDPOINTS)
def test_endpoint_requires_auth(anon_client, method, path, body):
    r = anon_client.request(method, f"{BASE_URL}{path}", json=body)
    assert r.status_code in (401, 403), f"{method} {path} -> {r.status_code} {r.text[:200]}"


# ------------------------ USER ENDPOINTS as superadmin (no email_account) ------------------------
@pytest.mark.parametrize("method,path,body", USER_ENDPOINTS)
def test_user_endpoints_return_400_without_account(admin_client, method, path, body):
    """Superadmin admin@voxyra.com não é uma conta de e-mail real → esperamos 400 amigável."""
    r = admin_client.request(method, f"{BASE_URL}{path}", json=body)
    # aceita 400 (esperado) e não deve retornar 500
    assert r.status_code != 500, f"{method} {path} returned 500: {r.text[:300]}"
    assert r.status_code == 400, f"{method} {path} -> {r.status_code} (expected 400) body={r.text[:200]}"
    # mensagem amigável
    try:
        detail = r.json().get("detail", "")
    except Exception:
        detail = r.text
    assert isinstance(detail, str) and len(detail) > 0


# ------------------------ ADMIN OVERVIEW ------------------------
def test_admin_overview_returns_structured_object(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/spam/admin/overview")
    assert r.status_code == 200, f"overview -> {r.status_code} {r.text[:300]}"
    data = r.json()
    for k in ("total_accounts", "reachable", "total_spam", "per_domain", "per_account"):
        assert k in data, f"missing key {k} in overview response: {list(data.keys())}"
    assert isinstance(data["per_domain"], list)
    assert isinstance(data["per_account"], list)
    assert isinstance(data["total_accounts"], int)
    assert isinstance(data["reachable"], int)
    assert isinstance(data["total_spam"], int)


def test_admin_account_invalid_id_returns_404(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/spam/admin/accounts/nonexistent-xxx")
    assert r.status_code == 404, f"-> {r.status_code} {r.text[:200]}"


def test_admin_account_not_spam_invalid_id_returns_404(admin_client):
    r = admin_client.post(f"{BASE_URL}/api/spam/admin/accounts/nonexistent-xxx/not-spam",
                           json={"uids": []})
    assert r.status_code == 404, f"-> {r.status_code} {r.text[:200]}"


def test_admin_account_delete_invalid_id_returns_404(admin_client):
    r = admin_client.delete(f"{BASE_URL}/api/spam/admin/accounts/nonexistent-xxx/messages",
                             json={"uids": []})
    assert r.status_code == 404, f"-> {r.status_code} {r.text[:200]}"


# ------------------------ OPENAPI ------------------------
def test_openapi_lists_spam_router(anon_client):
    r = anon_client.get(f"{BASE_URL}/openapi.json")
    if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
        pytest.skip("OpenAPI not exposed as JSON in this env")
    try:
        paths = r.json().get("paths", {})
    except Exception:
        pytest.skip("OpenAPI not JSON parseable")
    expected = [
        "/api/spam/folder", "/api/spam/messages", "/api/spam/not-spam",
        "/api/spam/report", "/api/spam/whitelist", "/api/spam/blacklist",
        "/api/spam/stats", "/api/spam/admin/overview",
    ]
    missing = [p for p in expected if p not in paths]
    assert not missing, f"Missing spam endpoints in OpenAPI: {missing}"
