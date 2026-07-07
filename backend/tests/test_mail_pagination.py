"""Regression tests for IMAP-side pagination and unread counting logic.

These tests use a fake IMAP client so the logic in MailClient.list_messages /
MailClient.unread_counts can be validated without a real server.
"""
from __future__ import annotations

import re
from types import SimpleNamespace
import pytest

from services.mail import MailClient


class FakeIMAP:
    """Minimal IMAP4 mock. Simulates 15 messages in INBOX; 4 unread."""

    def __init__(self, total=15, unread_ids=(1, 2, 3, 4)):
        self._total = total
        self._unread = set(unread_ids)
        self._selected = None

    def select(self, folder, readonly=False):
        self._selected = folder
        return ("OK", [str(self._total).encode()])

    def search(self, charset, criteria):
        if criteria == "ALL":
            ids = " ".join(str(i) for i in range(1, self._total + 1)).encode()
            return ("OK", [ids])
        if criteria == "UNSEEN":
            ids = " ".join(str(i) for i in sorted(self._unread)).encode()
            return ("OK", [ids])
        return ("OK", [b""])

    def fetch(self, uid, part):
        uid_int = int(uid)
        headers = (
            f"From: user{uid_int}@example.com\r\n"
            f"To: dest@example.com\r\n"
            f"Subject: Assunto {uid_int}\r\n"
            f"Date: Mon, 01 Jul 2026 10:00:00 -0300\r\n"
            f"\r\n"
        ).encode()
        flag = "" if uid_int in self._unread else "\\Seen"
        return ("OK", [(b"1 (RFC822.HEADER {0})", headers), f"FLAGS ({flag})".encode()])

    def status(self, folder, items):
        name = folder.strip('"')
        # STATUS INBOX (MESSAGES 15 UNSEEN 4)
        payload = f'"{name}" (MESSAGES {self._total} UNSEEN {len(self._unread)})'.encode()
        return ("OK", [payload])

    def logout(self):
        return ("BYE", [])


@pytest.fixture
def fake_client(monkeypatch):
    c = MailClient("host", "u@example.com", "pw")
    fake = FakeIMAP()
    monkeypatch.setattr(c, "_imap", lambda: fake)
    return c


def test_list_messages_returns_pagination_envelope(fake_client):
    r = fake_client.list_messages(folder="INBOX", page=1, page_size=10)
    assert isinstance(r, dict)
    assert set(r) >= {"items", "total", "page", "page_size", "unread"}
    assert r["total"] == 15
    assert r["page"] == 1
    assert r["page_size"] == 10
    assert r["unread"] == 4
    assert len(r["items"]) == 10
    # First item should be the newest (uid 15)
    assert r["items"][0]["uid"] == "15"


def test_list_messages_second_page(fake_client):
    r = fake_client.list_messages(folder="INBOX", page=2, page_size=10)
    assert r["total"] == 15
    assert r["page"] == 2
    assert len(r["items"]) == 5  # 15 - 10 = 5 on page 2
    assert r["items"][0]["uid"] == "5"


def test_list_messages_out_of_range(fake_client):
    r = fake_client.list_messages(folder="INBOX", page=99, page_size=10)
    assert r["total"] == 15
    assert r["items"] == []


def test_unread_counts(fake_client):
    r = fake_client.unread_counts(["INBOX", "Sent"])
    assert "INBOX" in r
    assert r["INBOX"]["total"] == 15
    assert r["INBOX"]["unread"] == 4


def test_list_messages_unread_flag_per_message(fake_client):
    r = fake_client.list_messages(folder="INBOX", page=1, page_size=10)
    # uid 15 is not in unread_ids (1-4), so unread=False
    top = r["items"][0]
    assert top["unread"] is False
    # uid 4 falls on page 2, but let's grab it there
    r2 = fake_client.list_messages(folder="INBOX", page=2, page_size=10)
    uid4 = next(x for x in r2["items"] if x["uid"] == "4")
    assert uid4["unread"] is True
