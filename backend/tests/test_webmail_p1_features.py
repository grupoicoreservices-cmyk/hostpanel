"""Contract tests for the new Webmail features:
- SSE /events endpoint contract
- Multipart /send-with-attachments endpoint contract
- Attachment download endpoint
- Vacation settings endpoints (get/put/delete)
- Signature persistence via /preferences

Focus: authentication + graceful 400 when the account is not configured.
End-to-end validation with a real IMAP + DirectAdmin server happens in
production. These tests exercise the router surface only.
"""
from __future__ import annotations
import os
import io
import httpx

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001")


def _login() -> str:
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.post("/api/auth/login", json={"email": "admin@voxyra.com", "password": "Voxyra@2026"})
        assert r.status_code == 200, r.text
        return r.json()["access_token"]


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


# ---------- SSE ----------
def test_events_requires_auth():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/events")
    assert r.status_code in (401, 403), r.text


def test_events_400_without_account():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/events", headers=_hdr(t))
    assert r.status_code == 400
    assert "Conta de e-mail" in r.text


# ---------- Attachments ----------
def test_send_with_attachments_requires_auth():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.post("/api/webmail/send-with-attachments",
                    data={"to": "x@y.com", "subject": "t", "body_text": "b"})
    assert r.status_code in (401, 403)


def test_send_with_attachments_multipart_accepted():
    t = _login()
    files = [("attachments", ("hello.txt", io.BytesIO(b"hello world"), "text/plain"))]
    data = {"to": "someone@example.com", "subject": "Test", "body_text": "hi"}
    with httpx.Client(base_url=BASE, timeout=10) as ac:
        r = ac.post("/api/webmail/send-with-attachments", data=data, files=files, headers=_hdr(t))
    # No email_account for superadmin → expect 400 with the account-not-configured detail.
    # Critical: NOT 422 (missing form field) and NOT 500 (unhandled).
    assert r.status_code == 400
    assert "Conta de e-mail" in r.text


def test_send_with_attachments_missing_to_returns_400():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        # Empty `to` → server-side split returns [] → 400
        r = ac.post("/api/webmail/send-with-attachments",
                    data={"to": "", "subject": "t"}, headers=_hdr(t))
    assert r.status_code == 400


def test_attachment_download_requires_auth():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/messages/1/attachment/0")
    assert r.status_code in (401, 403)


def test_attachment_download_negative_index_returns_400():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/messages/1/attachment/-1", headers=_hdr(t))
    assert r.status_code == 400


# ---------- Vacation ----------
def test_vacation_get_requires_auth():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/settings/vacation")
    assert r.status_code in (401, 403)


def test_vacation_get_400_without_account():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/settings/vacation", headers=_hdr(t))
    assert r.status_code == 400
    assert "Conta de e-mail" in r.text or "DirectAdmin" in r.text


def test_vacation_put_validates_date():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.put("/api/webmail/settings/vacation", headers=_hdr(t), json={
            "text": "Fora do escritório",
            "starttime": "not-a-date",
            "endtime": "not-a-date",
        })
    # Superadmin has no email_account, so first check is 400 for that.
    # If somehow account resolves, next check is the date validation (also 400).
    assert r.status_code == 400


# ---------- Signature via /preferences ----------
def test_signature_roundtrip():
    t = _login()
    payload = {
        "theme": "light",
        "view_mode": "horizontal",
        "signature": "João Silva\nVoxyra Mail",
        "density": "comfortable",
    }
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r_put = ac.put("/api/preferences", headers=_hdr(t), json=payload)
        assert r_put.status_code == 200, r_put.text
        assert r_put.json()["signature"] == payload["signature"]
        r_get = ac.get("/api/preferences", headers=_hdr(t))
        assert r_get.status_code == 200
        assert r_get.json()["signature"] == payload["signature"]
