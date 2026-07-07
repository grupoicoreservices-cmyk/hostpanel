"""Antispam Center — configurações SpamAssassin via DirectAdmin.

Endpoints:
  GET   /api/antispam/summary                  — visão geral (contas com spam ON/OFF)
  GET   /api/antispam/accounts                 — lista contas com config cacheada em DB
  GET   /api/antispam/accounts/{id}            — config LIVE do DirectAdmin
  PUT   /api/antispam/accounts/{id}            — atualiza config
  POST  /api/antispam/sync                     — sincroniza TODAS as contas
  POST  /api/antispam/sync/{domain_id}         — sincroniza um domínio
  GET   /api/antispam/accounts/{id}/blacklist  — lista blacklist
  POST  /api/antispam/accounts/{id}/blacklist  — adiciona (payload {address})
  DELETE /api/antispam/accounts/{id}/blacklist — remove (?address=)
  GET|POST|DELETE /api/antispam/accounts/{id}/whitelist  — idem para whitelist
"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_db
from auth import require_admin
from crypto_utils import decrypt
from services.directadmin import DirectAdminClient, DirectAdminError
from models import now_iso


router = APIRouter(prefix="/api/antispam", tags=["antispam"])


class SpamConfigPayload(BaseModel):
    enabled: Optional[bool] = None
    kill_score: Optional[float] = None
    subject_tag: Optional[str] = None
    use_bayes: Optional[bool] = None
    use_razor: Optional[bool] = None


class AddressPayload(BaseModel):
    address: str


def _scope(user: dict) -> dict:
    return {} if user.get("role") == "superadmin" else {"empresa_id": user.get("empresa_id")}


async def _get_da_context(db, account_id: str, user: dict):
    acc = await db.email_accounts.find_one({"id": account_id})
    if not acc:
        raise HTTPException(404, "Conta não encontrada")
    if user["role"] != "superadmin" and acc.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")

    domain = await db.domains.find_one({"id": acc["dominio_id"]})
    if not domain or not domain.get("directadmin_server_id"):
        raise HTTPException(400, "Domínio sem servidor DirectAdmin configurado")

    server = await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})
    if not server:
        raise HTTPException(400, "Servidor DirectAdmin não encontrado")

    token = decrypt(server.get("api_token", ""))
    client = DirectAdminClient(server["url"], server["port"], server["api_user"], token, server.get("ssl", True))
    local_part = acc["email"].split("@")[0]
    return acc, domain, client, local_part


# ---------- Summary ----------
@router.get("/summary")
async def summary(user: dict = Depends(require_admin)):
    db = get_db()
    q = _scope(user)
    total = await db.email_accounts.count_documents(q)
    enabled = await db.email_accounts.count_documents({**q, "spam_config.enabled": True})
    disabled = await db.email_accounts.count_documents({**q, "spam_config.enabled": False})
    unknown = total - enabled - disabled

    # spam_blocked_7d: contagem de ações "spam.report" nos audit logs (últimos 7 dias)
    from datetime import datetime, timezone, timedelta
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    spam_q = {"action": {"$in": ["spam.report", "spam.blacklist"]}, "created_at": {"$gte": week_ago}}
    if user["role"] != "superadmin":
        spam_q["empresa_id"] = user.get("empresa_id")
    spam_blocked_7d = await db.audit_logs.count_documents(spam_q)

    domains = await db.domains.count_documents(_scope(user))
    return {
        "total_accounts": total,
        "enabled_accounts": enabled,
        "disabled_accounts": disabled,
        "unknown_accounts": unknown,
        "total_domains": domains,
        "spam_blocked_7d": spam_blocked_7d,
    }


# ---------- List accounts w/ cached config ----------
@router.get("/accounts")
async def list_accounts(user: dict = Depends(require_admin)):
    db = get_db()
    q = _scope(user)
    result = []
    async for a in db.email_accounts.find(q, {"_id": 0, "password_enc": 0}):
        cfg = a.get("spam_config") or {}
        result.append({
            "id": a["id"],
            "email": a["email"],
            "dominio_id": a["dominio_id"],
            "status": a.get("status", "ativo"),
            "spam_enabled": cfg.get("enabled"),
            "kill_score": cfg.get("kill_score"),
            "subject_tag": cfg.get("subject_tag"),
            "use_bayes": cfg.get("use_bayes"),
            "use_razor": cfg.get("use_razor"),
            "last_sync": a.get("spam_last_sync"),
        })
    return result


# ---------- Live config for a single account ----------
@router.get("/accounts/{account_id}")
async def get_config(account_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    _, domain, client, local = await _get_da_context(db, account_id, user)
    try:
        cfg = client.get_spam_config(domain["nome"], local)
    except DirectAdminError as e:
        raise HTTPException(502, str(e))
    # cache local
    await db.email_accounts.update_one(
        {"id": account_id},
        {"$set": {"spam_config": {k: v for k, v in cfg.items() if k != "raw"},
                   "spam_last_sync": now_iso()}},
    )
    return cfg


@router.put("/accounts/{account_id}")
async def set_config(account_id: str, payload: SpamConfigPayload, user: dict = Depends(require_admin)):
    db = get_db()
    _, domain, client, local = await _get_da_context(db, account_id, user)
    try:
        client.set_spam_config(
            domain["nome"], local,
            enabled=payload.enabled, kill_score=payload.kill_score,
            subject_tag=payload.subject_tag, use_bayes=payload.use_bayes, use_razor=payload.use_razor,
        )
        # re-lê e cacheia
        fresh = client.get_spam_config(domain["nome"], local)
    except DirectAdminError as e:
        raise HTTPException(502, str(e))

    await db.email_accounts.update_one(
        {"id": account_id},
        {"$set": {"spam_config": {k: v for k, v in fresh.items() if k != "raw"},
                  "spam_last_sync": now_iso()}},
    )
    return fresh


# ---------- Sync ----------
async def _sync_one_account(db, client: DirectAdminClient, domain_name: str, account: dict) -> bool:
    local = account["email"].split("@")[0]
    try:
        cfg = client.get_spam_config(domain_name, local)
    except DirectAdminError:
        return False
    await db.email_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"spam_config": {k: v for k, v in cfg.items() if k != "raw"},
                  "spam_last_sync": now_iso()}},
    )
    return True


@router.post("/sync/{domain_id}")
async def sync_domain(domain_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    domain = await db.domains.find_one({"id": domain_id})
    if not domain:
        raise HTTPException(404, "Domínio não encontrado")
    if user["role"] != "superadmin" and domain.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")
    if not domain.get("directadmin_server_id"):
        raise HTTPException(400, "Domínio sem servidor DirectAdmin")

    server = await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})
    if not server:
        raise HTTPException(400, "Servidor não encontrado")
    token = decrypt(server.get("api_token", ""))
    client = DirectAdminClient(server["url"], server["port"], server["api_user"], token, server.get("ssl", True))

    synced = 0
    total = 0
    async for a in db.email_accounts.find({"dominio_id": domain_id}):
        total += 1
        if await _sync_one_account(db, client, domain["nome"], a):
            synced += 1

    return {"domain": domain["nome"], "total": total, "synced": synced}


@router.post("/sync")
async def sync_all(user: dict = Depends(require_admin)):
    db = get_db()
    q = _scope(user)
    total_synced = 0
    total_accounts = 0
    domains_touched = 0

    async for domain in db.domains.find({**q}):
        if not domain.get("directadmin_server_id"):
            continue
        server = await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})
        if not server:
            continue
        token = decrypt(server.get("api_token", ""))
        client = DirectAdminClient(server["url"], server["port"], server["api_user"], token, server.get("ssl", True))
        domains_touched += 1
        async for a in db.email_accounts.find({"dominio_id": domain["id"]}):
            total_accounts += 1
            if await _sync_one_account(db, client, domain["nome"], a):
                total_synced += 1

    return {"domains": domains_touched, "accounts_total": total_accounts, "accounts_synced": total_synced}


# ---------- Blacklist / Whitelist ----------
def _lists_router(kind: str):
    """Retorna 3 handlers para blacklist ou whitelist."""
    async def _list(account_id: str, user: dict = Depends(require_admin)):
        db = get_db()
        _, domain, client, local = await _get_da_context(db, account_id, user)
        try:
            addrs = client.get_blacklist(domain["nome"], local) if kind == "blacklist" \
                    else client.get_whitelist(domain["nome"], local)
        except DirectAdminError as e:
            raise HTTPException(502, str(e))
        return {"addresses": addrs}

    async def _add(account_id: str, payload: AddressPayload, user: dict = Depends(require_admin)):
        db = get_db()
        _, domain, client, local = await _get_da_context(db, account_id, user)
        try:
            if kind == "blacklist":
                client.add_blacklist(domain["nome"], local, payload.address)
            else:
                client.add_whitelist(domain["nome"], local, payload.address)
        except DirectAdminError as e:
            raise HTTPException(502, str(e))
        return {"ok": True}

    async def _del(account_id: str, address: str, user: dict = Depends(require_admin)):
        db = get_db()
        _, domain, client, local = await _get_da_context(db, account_id, user)
        try:
            if kind == "blacklist":
                client.remove_blacklist(domain["nome"], local, address)
            else:
                client.remove_whitelist(domain["nome"], local, address)
        except DirectAdminError as e:
            raise HTTPException(502, str(e))
        return {"ok": True}

    return _list, _add, _del


bl_list, bl_add, bl_del = _lists_router("blacklist")
wl_list, wl_add, wl_del = _lists_router("whitelist")

router.get("/accounts/{account_id}/blacklist")(bl_list)
router.post("/accounts/{account_id}/blacklist")(bl_add)
router.delete("/accounts/{account_id}/blacklist")(bl_del)

router.get("/accounts/{account_id}/whitelist")(wl_list)
router.post("/accounts/{account_id}/whitelist")(wl_add)
router.delete("/accounts/{account_id}/whitelist")(wl_del)
