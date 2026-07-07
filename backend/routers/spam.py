"""Spam quarantine — gerencia a pasta Spam via IMAP + integra com whitelist/blacklist
do DirectAdmin (CMD_API_EMAIL_SPAMASSASSIN_BLACKLIST/WHITELIST).

Endpoints do usuário final (autenticado):
  GET    /api/spam/folder             — descobre nome real da pasta de spam do usuário
  GET    /api/spam/messages           — lista mensagens da pasta de spam com score
  GET    /api/spam/messages/{uid}     — abre a mensagem
  POST   /api/spam/not-spam           — move UIDs pra Inbox + opcionalmente whitelista
  POST   /api/spam/report             — reporta como spam (move pra Spam) + opc. blacklist
  DELETE /api/spam/messages           — deleta em lote
  POST   /api/spam/whitelist          — adiciona endereços ao whitelist DA
  POST   /api/spam/blacklist          — adiciona endereços ao blacklist DA
  GET    /api/spam/stats              — contadores da conta do usuário

Endpoints admin (empresa_admin / superadmin):
  GET    /api/spam/admin/overview            — visão consolidada por domínio/conta
  GET    /api/spam/admin/accounts/{id}       — spams de UMA conta específica
  POST   /api/spam/admin/accounts/{id}/not-spam
  DELETE /api/spam/admin/accounts/{id}/messages
"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from database import get_db
from auth import get_current_user, require_admin
from crypto_utils import decrypt
from services.mail import MailClient, MailError
from services.directadmin import DirectAdminClient, DirectAdminError


router = APIRouter(prefix="/api/spam", tags=["spam"])


# ============================================================
# Payloads
# ============================================================
class UidsPayload(BaseModel):
    uids: list[str]
    folder: Optional[str] = None
    add_whitelist: bool = False
    add_blacklist: bool = False


class AddressesPayload(BaseModel):
    addresses: list[EmailStr]


class ReportSpamPayload(BaseModel):
    uids: list[str]
    src_folder: str = "INBOX"
    add_blacklist: bool = False


# ============================================================
# Helpers
# ============================================================
async def _resolve_account_and_mail(user: dict) -> tuple[dict, dict, MailClient]:
    """Devolve (account, domain, MailClient) para o usuário logado."""
    db = get_db()
    account = None
    if user.get("email_account_id"):
        account = await db.email_accounts.find_one({"id": user["email_account_id"]})
    if not account:
        account = await db.email_accounts.find_one({"email": user.get("email")})
    if not account:
        raise HTTPException(400, "Conta de e-mail não configurada para este usuário")

    password = decrypt(account.get("password_enc", "") or "")
    if not password:
        raise HTTPException(400, "Senha da conta indisponível — faça login pelo webmail para armazenar")

    domain = await db.domains.find_one({"id": account["dominio_id"]})
    if not domain:
        raise HTTPException(400, "Domínio não encontrado")

    host = _imap_host_from_domain(domain, await _get_server(db, domain))
    if not host:
        raise HTTPException(400, "Servidor IMAP não localizado")

    client = MailClient(
        host=host, email_addr=account["email"], password=password,
        imap_port=int(domain.get("imap_port") or 993),
        smtp_port=int(domain.get("smtp_port") or 587),
        use_ssl=bool(domain.get("imap_ssl", True)),
    )
    return account, domain, client


async def _get_server(db, domain: dict) -> Optional[dict]:
    if not domain.get("directadmin_server_id"):
        return None
    return await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})


def _imap_host_from_domain(domain: dict, server: Optional[dict]) -> Optional[str]:
    host = domain.get("imap_host")
    if host:
        return host
    if server:
        return server["url"].replace("https://", "").replace("http://", "").split(":")[0].rstrip("/")
    return f"mail.{domain['nome']}" if domain.get("nome") else None


async def _da_client(db, domain: dict) -> Optional[DirectAdminClient]:
    server = await _get_server(db, domain)
    if not server:
        return None
    return DirectAdminClient(
        server["url"], server["port"], server["api_user"],
        decrypt(server.get("api_token", "") or ""),
        server.get("ssl", True),
    )


def _extract_domain(addr: str) -> str:
    return addr.split("@", 1)[1].lower() if "@" in addr else ""


# ============================================================
# User endpoints
# ============================================================
@router.get("/folder")
async def spam_folder(user: dict = Depends(get_current_user)):
    _, _, client = await _resolve_account_and_mail(user)
    try:
        f = client.resolve_spam_folder()
    except MailError as e:
        raise HTTPException(502, str(e))
    if not f:
        raise HTTPException(404, "Pasta de spam não encontrada no servidor IMAP")
    return {"folder": f}


@router.get("/messages")
async def spam_messages(limit: int = 100, search: Optional[str] = None,
                         user: dict = Depends(get_current_user)):
    _, _, client = await _resolve_account_and_mail(user)
    try:
        folder = client.resolve_spam_folder() or "Junk"
        return {"folder": folder, "messages": client.list_messages(folder=folder, limit=limit, search=search)}
    except MailError as e:
        raise HTTPException(502, str(e))


@router.get("/messages/{uid}")
async def spam_get_message(uid: str, folder: Optional[str] = None,
                            user: dict = Depends(get_current_user)):
    _, _, client = await _resolve_account_and_mail(user)
    try:
        target = folder or client.resolve_spam_folder() or "Junk"
        return client.get_message(uid, folder=target)
    except MailError as e:
        raise HTTPException(502, str(e))


@router.post("/not-spam")
async def spam_not_spam(payload: UidsPayload, user: dict = Depends(get_current_user)):
    """Move UIDs da pasta Spam para INBOX e opcionalmente whitelista os remetentes."""
    db = get_db()
    account, domain, client = await _resolve_account_and_mail(user)
    try:
        src = payload.folder or client.resolve_spam_folder() or "Junk"
        # coleta remetentes antes de mover (para whitelist)
        senders: list[str] = []
        if payload.add_whitelist:
            for uid in payload.uids:
                try:
                    msg = client.get_message(uid, folder=src)
                    if msg.get("from_addr"):
                        senders.append(msg["from_addr"])
                except MailError:
                    continue
        moved = client.bulk_move(payload.uids, src, "INBOX")
    except MailError as e:
        raise HTTPException(502, str(e))

    whitelisted = 0
    if payload.add_whitelist and senders:
        whitelisted = await _apply_wl_bl(db, account, domain, senders, "whitelist")
    return {"moved": moved, "whitelisted": whitelisted}


@router.post("/report")
async def spam_report(payload: ReportSpamPayload, user: dict = Depends(get_current_user)):
    """Reporta UIDs da src_folder como spam: move para pasta de spam + opc. blacklist."""
    db = get_db()
    account, domain, client = await _resolve_account_and_mail(user)
    try:
        dst = client.resolve_spam_folder() or "Junk"
        senders: list[str] = []
        if payload.add_blacklist:
            for uid in payload.uids:
                try:
                    msg = client.get_message(uid, folder=payload.src_folder)
                    if msg.get("from_addr"):
                        senders.append(msg["from_addr"])
                except MailError:
                    continue
        moved = client.bulk_move(payload.uids, payload.src_folder, dst)
    except MailError as e:
        raise HTTPException(502, str(e))

    blacklisted = 0
    if payload.add_blacklist and senders:
        blacklisted = await _apply_wl_bl(db, account, domain, senders, "blacklist")
    return {"moved": moved, "blacklisted": blacklisted, "folder": dst}


@router.delete("/messages")
async def spam_delete(payload: UidsPayload, user: dict = Depends(get_current_user)):
    _, _, client = await _resolve_account_and_mail(user)
    try:
        folder = payload.folder or client.resolve_spam_folder() or "Junk"
        deleted = client.bulk_delete(payload.uids, folder)
        return {"deleted": deleted, "folder": folder}
    except MailError as e:
        raise HTTPException(502, str(e))


@router.post("/whitelist")
async def spam_whitelist(payload: AddressesPayload, user: dict = Depends(get_current_user)):
    db = get_db()
    account, domain, _ = await _resolve_account_and_mail(user)
    n = await _apply_wl_bl(db, account, domain, [str(a) for a in payload.addresses], "whitelist")
    return {"added": n}


@router.post("/blacklist")
async def spam_blacklist(payload: AddressesPayload, user: dict = Depends(get_current_user)):
    db = get_db()
    account, domain, _ = await _resolve_account_and_mail(user)
    n = await _apply_wl_bl(db, account, domain, [str(a) for a in payload.addresses], "blacklist")
    return {"added": n}


@router.get("/stats")
async def spam_stats(user: dict = Depends(get_current_user)):
    _, _, client = await _resolve_account_and_mail(user)
    try:
        folder = client.resolve_spam_folder() or "Junk"
        total = client.folder_count(folder)
        return {"folder": folder, "total": total}
    except MailError as e:
        raise HTTPException(502, str(e))


# ============================================================
# Whitelist/Blacklist helper compartilhado
# ============================================================
async def _apply_wl_bl(db, account: dict, domain: dict, addresses: list[str], kind: str) -> int:
    """Aplica white/blacklist via DA. Retorna contagem aplicada com sucesso.
    Sem servidor DA configurado, salva localmente em `email_accounts.spam_lists.{kind}`.
    """
    added = 0
    da = await _da_client(db, domain)
    local_user = account["email"].split("@")[0]

    for addr in dict.fromkeys(addresses):  # dedup preservando ordem
        try:
            if da:
                if kind == "whitelist":
                    da.add_whitelist(domain["nome"], local_user, addr)
                else:
                    da.add_blacklist(domain["nome"], local_user, addr)
            added += 1
        except DirectAdminError:
            continue

    # persistência local do que foi aplicado (auditoria + fallback)
    field = f"spam_lists.{kind}"
    await db.email_accounts.update_one(
        {"id": account["id"]},
        {"$addToSet": {field: {"$each": addresses}}},
    )
    return added


# ============================================================
# Admin endpoints
# ============================================================
async def _account_scope_filter(user: dict) -> dict:
    return {} if user.get("role") == "superadmin" else {"empresa_id": user.get("empresa_id")}


@router.get("/admin/overview")
async def admin_overview(user: dict = Depends(require_admin)):
    """Overview de spam por domínio/conta.

    Como listar em tempo real todas as pastas seria caro, agregamos apenas as
    contas que já têm senha em cache. Para cada uma abrimos IMAP curto e
    contamos mensagens na Spam folder.
    """
    db = get_db()
    q = await _account_scope_filter(user)
    accounts = [a async for a in db.email_accounts.find({**q, "password_enc": {"$nin": [None, ""]}}, {"_id": 0})]

    per_domain: dict[str, dict] = {}
    per_account: list[dict] = []
    total_spam = 0
    reachable = 0
    total = len(accounts)

    for acc in accounts:
        domain = await db.domains.find_one({"id": acc["dominio_id"]})
        if not domain:
            continue
        try:
            server = await _get_server(db, domain)
            host = _imap_host_from_domain(domain, server)
            if not host:
                continue
            password = decrypt(acc.get("password_enc", "") or "")
            if not password:
                continue
            client = MailClient(
                host=host, email_addr=acc["email"], password=password,
                imap_port=int(domain.get("imap_port") or 993),
                smtp_port=int(domain.get("smtp_port") or 587),
                use_ssl=bool(domain.get("imap_ssl", True)),
            )
            folder = client.resolve_spam_folder() or "Junk"
            count = client.folder_count(folder)
            reachable += 1
            total_spam += count
            key = domain["nome"]
            d_agg = per_domain.setdefault(key, {"domain": key, "spam_count": 0, "accounts": 0})
            d_agg["spam_count"] += count
            d_agg["accounts"] += 1
            per_account.append({
                "account_id": acc["id"],
                "email": acc["email"],
                "domain": domain["nome"],
                "spam_count": count,
                "folder": folder,
            })
        except MailError:
            per_account.append({
                "account_id": acc["id"],
                "email": acc["email"],
                "domain": domain["nome"],
                "spam_count": None,
                "folder": None,
                "error": "IMAP inacessível",
            })
        except Exception:
            continue

    per_account.sort(key=lambda x: (x.get("spam_count") or 0), reverse=True)
    return {
        "total_accounts": total,
        "reachable": reachable,
        "total_spam": total_spam,
        "per_domain": list(per_domain.values()),
        "per_account": per_account,
    }


async def _admin_get_account_client(account_id: str, user: dict) -> tuple[dict, dict, MailClient]:
    db = get_db()
    account = await db.email_accounts.find_one({"id": account_id})
    if not account:
        raise HTTPException(404, "Conta não encontrada")
    if user["role"] != "superadmin" and account.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")
    password = decrypt(account.get("password_enc", "") or "")
    if not password:
        raise HTTPException(400, "Senha da conta não armazenada — peça ao usuário para logar no webmail")
    domain = await db.domains.find_one({"id": account["dominio_id"]})
    if not domain:
        raise HTTPException(400, "Domínio não encontrado")
    server = await _get_server(db, domain)
    host = _imap_host_from_domain(domain, server)
    if not host:
        raise HTTPException(400, "Servidor IMAP não localizado")
    client = MailClient(
        host=host, email_addr=account["email"], password=password,
        imap_port=int(domain.get("imap_port") or 993),
        smtp_port=int(domain.get("smtp_port") or 587),
        use_ssl=bool(domain.get("imap_ssl", True)),
    )
    return account, domain, client


@router.get("/admin/accounts/{account_id}")
async def admin_account_messages(account_id: str, limit: int = 100,
                                  user: dict = Depends(require_admin)):
    _, _, client = await _admin_get_account_client(account_id, user)
    try:
        folder = client.resolve_spam_folder() or "Junk"
        return {"folder": folder, "messages": client.list_messages(folder=folder, limit=limit)}
    except MailError as e:
        raise HTTPException(502, str(e))


@router.post("/admin/accounts/{account_id}/not-spam")
async def admin_account_not_spam(account_id: str, payload: UidsPayload,
                                  user: dict = Depends(require_admin)):
    db = get_db()
    account, domain, client = await _admin_get_account_client(account_id, user)
    try:
        src = payload.folder or client.resolve_spam_folder() or "Junk"
        senders: list[str] = []
        if payload.add_whitelist:
            for uid in payload.uids:
                try:
                    msg = client.get_message(uid, folder=src)
                    if msg.get("from_addr"):
                        senders.append(msg["from_addr"])
                except MailError:
                    continue
        moved = client.bulk_move(payload.uids, src, "INBOX")
    except MailError as e:
        raise HTTPException(502, str(e))
    whitelisted = 0
    if payload.add_whitelist and senders:
        whitelisted = await _apply_wl_bl(db, account, domain, senders, "whitelist")
    return {"moved": moved, "whitelisted": whitelisted}


@router.delete("/admin/accounts/{account_id}/messages")
async def admin_account_delete(account_id: str, payload: UidsPayload,
                                user: dict = Depends(require_admin)):
    _, _, client = await _admin_get_account_client(account_id, user)
    try:
        folder = payload.folder or client.resolve_spam_folder() or "Junk"
        deleted = client.bulk_delete(payload.uids, folder)
        return {"deleted": deleted, "folder": folder}
    except MailError as e:
        raise HTTPException(502, str(e))
