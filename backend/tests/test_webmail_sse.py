"""Basic contract tests for the SSE (/api/webmail/events) endpoint.

Focus: authentication + graceful error when the user has no email_account.
The full IDLE streaming can only be validated against a real IMAP server.
"""
from __future__ import annotations
import os
import httpx

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001")


def test_events_requires_auth():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/webmail/events")
    assert r.status_code in (401, 403), r.text


def test_events_returns_400_without_email_account():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.post("/api/auth/login", json={
            "email": "admin@voxyra.com", "password": "Voxyra@2026",
        })
        assert r.status_code == 200, r.text
        token = r.json().get("access_token")
        assert token
        r2 = ac.get("/api/webmail/events",
                    headers={"Authorization": f"Bearer {token}"})
    # Superadmin has no email_account in the seed → 400 with expected detail
    assert r2.status_code == 400, r2.text
    assert "Conta de e-mail" in r2.text
