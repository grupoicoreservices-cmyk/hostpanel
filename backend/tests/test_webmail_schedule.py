"""Tests for webmail schedule + mark-unread + forward regression endpoints."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mail-platform-14.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@voxyra.com"
ADMIN_PASS = "Voxyra@2026"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


class TestScheduleSend:
    def test_schedule_past_date_returns_400(self, session):
        r = session.post(f"{API}/webmail/schedule", json={
            "to": ["a@b.com"], "subject": "t", "body_text": "x",
            "scheduled_at": "2020-01-01T00:00:00+00:00",
        }, timeout=15)
        assert r.status_code == 400, r.text
        assert "futuro" in r.text.lower()

    def test_schedule_invalid_date_returns_400(self, session):
        r = session.post(f"{API}/webmail/schedule", json={
            "to": ["a@b.com"], "subject": "t", "body_text": "x",
            "scheduled_at": "not-a-date",
        }, timeout=15)
        assert r.status_code == 400, r.text
        assert "inv" in r.text.lower()

    def test_schedule_future_admin_no_account_returns_400_or_403(self, session):
        r = session.post(f"{API}/webmail/schedule", json={
            "to": ["a@b.com"], "subject": "t", "body_text": "x",
            "scheduled_at": "2027-01-01T00:00:00+00:00",
        }, timeout=15)
        assert r.status_code in (400, 403), f"got {r.status_code}: {r.text}"

    def test_list_scheduled_returns_200_array(self, session):
        r = session.get(f"{API}/webmail/scheduled", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_cancel_scheduled_invalid_id_returns_404(self, session):
        r = session.delete(f"{API}/webmail/scheduled/does-not-exist-id", timeout=15)
        assert r.status_code == 404


class TestMarkUnread:
    def test_mark_unread_no_account_returns_400_or_403(self, session):
        r = session.post(f"{API}/webmail/messages/999/mark-unread", timeout=15)
        # admin has no email_account_id -> should be 400 or 403, definitely not 404
        assert r.status_code in (400, 403), f"got {r.status_code}: {r.text}"


class TestRegressionEndpoints:
    def test_send_without_account(self, session):
        r = session.post(f"{API}/webmail/send", json={
            "to": ["a@b.com"], "subject": "t", "body_text": "x",
        }, timeout=15)
        assert r.status_code in (400, 403), f"got {r.status_code}: {r.text}"

    def test_move_without_account(self, session):
        r = session.post(f"{API}/webmail/messages/1/move",
                         params={"src_folder": "INBOX", "dst_folder": "Trash"}, timeout=15)
        assert r.status_code in (400, 403), f"got {r.status_code}: {r.text}"

    def test_root_public_endpoints(self, session):
        # unauth check
        s2 = requests.Session()
        r = s2.get(f"{API}/auth/me", timeout=10)
        assert r.status_code in (401, 403)
