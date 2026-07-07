"""IMAP IDLE listener + broker that pushes SSE events to logged-in users.

Design:
- Each SSE subscription opens a dedicated `aioimaplib.IMAP4_SSL` connection.
- IDLE is entered on INBOX; the server pushes untagged responses (EXISTS/EXPUNGE)
  whenever the mailbox changes.
- We consume those responses with a background task and forward compact events
  through an `asyncio.Queue` to the SSE stream.
- IDLE is refreshed every 25 minutes (RFC 2177 recommends ≤29 minutes).
- On client disconnect the queue-consumer cancels the background task and the
  IMAP connection is closed.

The listener is intentionally per-connection (no shared broker across users):
it's the simplest correct model, and Dovecot handles thousands of IDLE
connections without issue on a small VM.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import AsyncIterator, Optional

try:
    from aioimaplib import aioimaplib
except ImportError:  # pragma: no cover
    aioimaplib = None  # type: ignore

log = logging.getLogger("mail.idle")

# Refresh IDLE a bit before Dovecot's 29-minute inactivity limit.
IDLE_REFRESH_SEC = 25 * 60

# Regex to detect EXISTS / EXPUNGE / RECENT untagged responses coming through
# aioimaplib's `wait_server_push()` iterator. Format is usually:
#   b"5 EXISTS", b"3 EXPUNGE", b"1 RECENT"
_EVENT_RE = re.compile(rb"^(\d+)\s+(EXISTS|EXPUNGE|RECENT)\b", re.IGNORECASE)


@dataclass
class IdleEvent:
    """A tiny push event surfaced to the SSE layer."""
    type: str            # "new_mail" | "expunge" | "recent" | "error" | "ready"
    folder: str = "INBOX"
    count: Optional[int] = None
    detail: Optional[str] = None

    def to_sse(self) -> str:
        import json
        payload = {"type": self.type, "folder": self.folder}
        if self.count is not None:
            payload["count"] = self.count
        if self.detail:
            payload["detail"] = self.detail
        return f"event: {self.type}\ndata: {json.dumps(payload)}\n\n"


class ImapIdleListener:
    """One-shot IDLE listener. Use as `async for evt in listener.stream():`."""

    def __init__(self, host: str, email: str, password: str, imap_port: int = 993, folder: str = "INBOX"):
        if aioimaplib is None:
            raise RuntimeError("aioimaplib not installed")
        self.host = host
        self.email = email
        self.password = password
        self.imap_port = imap_port
        self.folder = folder
        self._client: Optional["aioimaplib.IMAP4_SSL"] = None
        self._stop = asyncio.Event()

    async def _open(self) -> None:
        c = aioimaplib.IMAP4_SSL(host=self.host, port=self.imap_port, timeout=30)
        await c.wait_hello_from_server()
        res = await c.login(self.email, self.password)
        if res.result != "OK":
            raise RuntimeError(f"IMAP login failed: {res.result} {res.lines}")
        res = await c.select(self.folder)
        if res.result != "OK":
            raise RuntimeError(f"IMAP select failed: {res.result} {res.lines}")
        if not c.has_pending_idle_command() and not c.has_capability("IDLE"):
            raise RuntimeError("Servidor IMAP não suporta IDLE (RFC 2177).")
        self._client = c

    async def _close(self) -> None:
        c = self._client
        if not c:
            return
        try:
            if c.has_pending_idle_command():
                c.idle_done()
                try:
                    await asyncio.wait_for(c.wait_server_push(), timeout=2)
                except (asyncio.TimeoutError, Exception):
                    pass
        except Exception:
            pass
        try:
            await asyncio.wait_for(c.logout(), timeout=3)
        except Exception:
            pass
        self._client = None

    def stop(self) -> None:
        self._stop.set()

    async def stream(self) -> AsyncIterator[IdleEvent]:
        """Async generator that yields IdleEvent while the caller is connected."""
        try:
            await self._open()
        except Exception as e:
            log.warning("IDLE open failed for %s: %s", self.email, e)
            yield IdleEvent(type="error", detail=str(e)[:200])
            return

        yield IdleEvent(type="ready", folder=self.folder)

        c = self._client
        assert c is not None

        try:
            while not self._stop.is_set():
                # Enter IDLE. `idle_start()` returns a future that resolves on `idle_done()`.
                idle_task = await c.idle_start(timeout=IDLE_REFRESH_SEC + 30)
                deadline = asyncio.get_event_loop().time() + IDLE_REFRESH_SEC

                # Loop: drain pushes until refresh window expires or client stops.
                while not self._stop.is_set():
                    remaining = deadline - asyncio.get_event_loop().time()
                    if remaining <= 0:
                        break
                    try:
                        pushes = await asyncio.wait_for(
                            c.wait_server_push(),
                            timeout=min(remaining, 60),
                        )
                    except asyncio.TimeoutError:
                        continue
                    except Exception as e:
                        log.info("IDLE stream error for %s: %s", self.email, e)
                        yield IdleEvent(type="error", detail=str(e)[:200])
                        break

                    if not pushes:
                        continue
                    # `pushes` is a list of bytes lines
                    for line in pushes:
                        if isinstance(line, (bytes, bytearray)):
                            m = _EVENT_RE.search(bytes(line))
                            if not m:
                                continue
                            n = int(m.group(1).decode())
                            kind = m.group(2).decode().upper()
                            if kind == "EXISTS":
                                yield IdleEvent(type="new_mail", folder=self.folder, count=n)
                            elif kind == "EXPUNGE":
                                yield IdleEvent(type="expunge", folder=self.folder, count=n)
                            elif kind == "RECENT":
                                yield IdleEvent(type="recent", folder=self.folder, count=n)

                # Refresh idle: send DONE and re-enter.
                try:
                    c.idle_done()
                    await asyncio.wait_for(idle_task, timeout=5)
                except Exception:
                    # If refresh fails, drop out of the outer loop to trigger reconnect logic
                    break
        finally:
            await self._close()
