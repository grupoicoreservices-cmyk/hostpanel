"""Live monitoring of Voxyra Mail services.

Checks:
- API self (uptime, latency)
- MongoDB (ping + latency)
- Each DirectAdmin server (HTTP check via DirectAdminClient)
- IMAP (993) and SMTP (587) reachability for each unique mail host
"""
from __future__ import annotations
import os
import time
import socket
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends

from database import get_db
from auth import require_admin
from crypto_utils import decrypt
from services.directadmin import DirectAdminClient


router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


PROCESS_START = time.time()


def _tcp_check(host: str, port: int, timeout: float = 3.0) -> tuple[bool, float]:
    """Return (ok, latency_ms). latency=-1 on failure."""
    start = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, round((time.perf_counter() - start) * 1000, 1)
    except Exception:
        return False, -1.0


async def _check_mongo() -> dict:
    start = time.perf_counter()
    db = get_db()
    try:
        await db.command("ping")
        latency = round((time.perf_counter() - start) * 1000, 1)
        return {
            "name": "MongoDB",
            "kind": "database",
            "status": "online",
            "latency_ms": latency,
            "detail": os.environ.get("DB_NAME", ""),
        }
    except Exception as e:
        return {
            "name": "MongoDB",
            "kind": "database",
            "status": "offline",
            "latency_ms": -1,
            "detail": str(e)[:180],
        }


def _check_da_server(server: dict) -> dict:
    token = decrypt(server.get("api_token", ""))
    client = DirectAdminClient(server["url"], server["port"], server["api_user"], token, server.get("ssl", True))
    start = time.perf_counter()
    ok = client.check()
    latency = round((time.perf_counter() - start) * 1000, 1) if ok else -1
    return {
        "id": server["id"],
        "name": server.get("nome", server["url"]),
        "kind": "directadmin",
        "status": "online" if ok else "offline",
        "latency_ms": latency,
        "detail": f"{server['url']}:{server['port']}",
    }


def _da_host(server: dict) -> str:
    return server["url"].replace("https://", "").replace("http://", "").split(":")[0].rstrip("/")


@router.get("/services")
async def services(_: dict = Depends(require_admin)):
    db = get_db()

    # 1) API self
    api_svc = {
        "name": "API Voxyra",
        "kind": "api",
        "status": "online",
        "latency_ms": 0.5,
        "detail": f"uptime {int(time.time() - PROCESS_START)}s",
    }

    # 2) Mongo
    mongo_svc = await _check_mongo()

    # 3) DirectAdmin servers + persist status
    da_servers = []
    async for s in db.directadmin_servers.find({}):
        da_servers.append(s)

    # run TCP + DA checks in a threadpool (they are blocking)
    loop = asyncio.get_event_loop()
    da_results: list[dict] = []
    imap_smtp_results: list[dict] = []
    seen_hosts: set[str] = set()

    tasks = [loop.run_in_executor(None, _check_da_server, s) for s in da_servers]
    if tasks:
        da_results = list(await asyncio.gather(*tasks))
        # persist state
        for r in da_results:
            await db.directadmin_servers.update_one(
                {"id": r["id"]},
                {"$set": {"status": r["status"], "last_check": datetime.now(timezone.utc).isoformat()}},
            )

    # IMAP/SMTP per unique host
    for s in da_servers:
        host = _da_host(s)
        if host in seen_hosts:
            continue
        seen_hosts.add(host)
        imap_ok, imap_lat = await loop.run_in_executor(None, _tcp_check, host, 993)
        smtp_ok, smtp_lat = await loop.run_in_executor(None, _tcp_check, host, 587)
        imap_smtp_results.append({
            "name": f"IMAP · {host}",
            "kind": "imap",
            "status": "online" if imap_ok else "offline",
            "latency_ms": imap_lat,
            "detail": f"{host}:993",
        })
        imap_smtp_results.append({
            "name": f"SMTP · {host}",
            "kind": "smtp",
            "status": "online" if smtp_ok else "offline",
            "latency_ms": smtp_lat,
            "detail": f"{host}:587",
        })

    services_list = [api_svc, mongo_svc] + da_results + imap_smtp_results

    # counts summary
    total = len(services_list)
    online = sum(1 for s in services_list if s["status"] == "online")
    offline = total - online

    # 24h admin activity + login stats
    since = time.time() - 24 * 3600
    since_iso = datetime.fromtimestamp(since, tz=timezone.utc).isoformat()
    admin_actions_24h = await db.admin_logs.count_documents({"timestamp": {"$gte": since_iso}})
    login_success_24h = await db.login_logs.count_documents({"timestamp": {"$gte": since_iso}, "success": True})
    login_failed_24h = await db.login_logs.count_documents({"timestamp": {"$gte": since_iso}, "success": False})

    return {
        "services": services_list,
        "summary": {
            "total": total,
            "online": online,
            "offline": offline,
            "uptime_seconds": int(time.time() - PROCESS_START),
        },
        "activity": {
            "admin_actions_24h": admin_actions_24h,
            "login_success_24h": login_success_24h,
            "login_failed_24h": login_failed_24h,
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
