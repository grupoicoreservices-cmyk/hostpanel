"""API contract tests for webmail pagination + spam regression."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend .env; keep tests explicit
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@voxyra.com"
ADMIN_PASS = "Voxyra@2026"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
    return s


class TestAuth:
    def test_login_ok(self, session):
        me = session.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert me.status_code == 200
        assert me.json().get("email") == ADMIN_EMAIL


class TestWebmailPagination:
    """Superadmin has no email_account -> expect graceful 400 (NOT 500)."""

    def test_messages_with_pagination_params_graceful(self, session):
        r = session.get(f"{BASE_URL}/api/webmail/messages",
                        params={"folder": "INBOX", "page": 1, "page_size": 20}, timeout=15)
        # No IMAP account configured -> should be 400 with detail
        assert r.status_code in (200, 400, 502), f"unexpected {r.status_code}: {r.text}"
        if r.status_code == 400:
            assert "Conta de e-mail" in r.json().get("detail", "")
        elif r.status_code == 200:
            data = r.json()
            # If it succeeded, must be envelope shape
            assert set(["items", "total", "page", "page_size"]).issubset(data.keys())
            assert data["page"] == 1
            assert data["page_size"] == 20

    def test_messages_legacy_returns_list_or_400(self, session):
        # Legacy: no page_size => should return LIST when successful
        r = session.get(f"{BASE_URL}/api/webmail/messages",
                        params={"folder": "INBOX", "limit": 50}, timeout=15)
        assert r.status_code in (200, 400, 502)
        if r.status_code == 200:
            assert isinstance(r.json(), list), "legacy call must return list"
        elif r.status_code == 400:
            assert "Conta de e-mail" in r.json().get("detail", "")

    def test_folder_counts_graceful(self, session):
        r = session.get(f"{BASE_URL}/api/webmail/folder-counts",
                        params={"folders": "INBOX,Sent"}, timeout=15)
        assert r.status_code in (200, 400, 502)
        if r.status_code == 200:
            data = r.json()
            assert isinstance(data, dict)
            # Each folder key -> {total, unread}
            for k, v in data.items():
                assert "total" in v and "unread" in v
        elif r.status_code == 400:
            assert "Conta de e-mail" in r.json().get("detail", "")


class TestSpamRegression:
    """After list_messages signature change, /api/spam/messages must still work."""

    def test_spam_messages_endpoint(self, session):
        r = session.get(f"{BASE_URL}/api/spam/messages", params={"limit": 10}, timeout=15)
        # graceful failure allowed since no IMAP account
        assert r.status_code in (200, 400, 502), f"unexpected {r.status_code}: {r.text}"
        if r.status_code == 200:
            data = r.json()
            assert "folder" in data
            assert "messages" in data
            assert isinstance(data["messages"], list)
        elif r.status_code == 400:
            assert "Conta" in r.json().get("detail", "") or "conta" in r.json().get("detail", "").lower()

    def test_no_500_on_any_endpoint(self, session):
        """Ensure the modified endpoints never leak 500 responses."""
        for path, params in [
            ("/api/webmail/messages", {"folder": "INBOX", "page": 1, "page_size": 20}),
            ("/api/webmail/messages", {"folder": "INBOX", "limit": 50}),
            ("/api/webmail/folder-counts", {"folders": "INBOX,Sent"}),
            ("/api/spam/messages", {"limit": 10}),
        ]:
            r = session.get(f"{BASE_URL}{path}", params=params, timeout=15)
            assert r.status_code != 500, f"{path} returned 500: {r.text}"
