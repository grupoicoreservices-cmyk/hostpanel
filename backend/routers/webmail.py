"""Webmail router: IMAP/SMTP endpoints for the end user.

The end user's IMAP/SMTP credentials come from the email_account record
associated with their account (`email_account_id`). The host is derived from
the DirectAdmin server hostname associated with the account's domain, or,
when no server is set, the domain name itself (mail.<domain>) is used.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import Optional

from database import get_db
from auth import get_current_user
from crypto_utils import decrypt
from services.mail import MailClient, MailError, FOLDER_MAP
from models import SendMailPayload


router = APIRouter(prefix="/api/webmail", tags=["webmail"])


async def _get_mail_client(user: dict) -> MailClient:
    if user.get("role") not in ("usuario_final", "empresa_admin", "superadmin"):
        raise HTTPException(403, "Perfil sem acesso ao webmail")

    db = get_db()
    account = None
    if user.get("email_account_id"):
        account = await db.email_accounts.find_one({"id": user["email_account_id"]})
    if not account:
        # fallback: try to match by email
        account = await db.email_accounts.find_one({"email": user.get("email")})
    if not account:
        raise HTTPException(400, "Conta de e-mail não configurada para este usuário")

    password = decrypt(account.get("password_enc", ""))
    if not password:
        raise HTTPException(400, "Senha da conta de e-mail indisponível")

    domain = await db.domains.find_one({"id": account["dominio_id"]})
    host = None
    if domain and domain.get("directadmin_server_id"):
        server = await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})
        if server:
            host = server["url"].replace("https://", "").replace("http://", "").split(":")[0].rstrip("/")
    if not host and domain:
        host = f"mail.{domain['nome']}"
    if not host:
        raise HTTPException(400, "Servidor de e-mail não localizado")

    return MailClient(host=host, email_addr=account["email"], password=password)


@router.get("/folders")
async def folders(user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        return client.list_folders()
    except MailError as e:
        raise HTTPException(502, str(e))


@router.get("/messages")
async def messages(folder: str = "INBOX", limit: int = 50, search: Optional[str] = None,
                   user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        return client.list_messages(folder=folder, limit=limit, search=search)
    except MailError as e:
        raise HTTPException(502, str(e))


@router.get("/messages/{uid}")
async def get_message(uid: str, folder: str = "INBOX", user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        return client.get_message(uid, folder=folder)
    except MailError as e:
        raise HTTPException(502, str(e))


@router.post("/send")
async def send_message(payload: SendMailPayload, user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        client.send(
            to=[str(e) for e in payload.to],
            cc=[str(e) for e in payload.cc],
            bcc=[str(e) for e in payload.bcc],
            subject=payload.subject,
            body_html=payload.body_html,
            body_text=payload.body_text,
        )
        return {"ok": True}
    except MailError as e:
        raise HTTPException(502, str(e))


# ---------- Envio agendado ----------
from datetime import datetime, timezone  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from models import new_id, now_iso  # noqa: E402


class ScheduledSendPayload(SendMailPayload):
    scheduled_at: str = Field(..., description="ISO-8601 UTC")


@router.post("/schedule")
async def schedule_send(payload: ScheduledSendPayload, user: dict = Depends(get_current_user)):
    # Valida data futura e conta
    try:
        when = datetime.fromisoformat(payload.scheduled_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Data inválida (use ISO-8601)")
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if when <= datetime.now(timezone.utc):
        raise HTTPException(400, "A data agendada deve estar no futuro")

    # Garante que o usuário tem conta com credencial (falha cedo)
    await _get_mail_client(user)

    db = get_db()
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "email_account_id": user.get("email_account_id"),
        "to": [str(e) for e in payload.to],
        "cc": [str(e) for e in payload.cc],
        "bcc": [str(e) for e in payload.bcc],
        "subject": payload.subject or "(sem assunto)",
        "body_text": payload.body_text or "",
        "body_html": payload.body_html or None,
        "scheduled_at": when.isoformat(),
        "status": "pending",
        "created_at": now_iso(),
        "sent_at": None,
        "error": None,
    }
    await db.scheduled_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/scheduled")
async def list_scheduled(user: dict = Depends(get_current_user)):
    db = get_db()
    q = {"user_id": user["id"]} if user["role"] not in ("superadmin",) else {}
    rows = []
    async for d in db.scheduled_messages.find(q, {"_id": 0}).sort("scheduled_at", 1).limit(200):
        rows.append(d)
    return rows


@router.delete("/scheduled/{sched_id}")
async def cancel_scheduled(sched_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.scheduled_messages.find_one({"id": sched_id})
    if not doc:
        raise HTTPException(404, "Agendamento não encontrado")
    if doc["user_id"] != user["id"] and user["role"] != "superadmin":
        raise HTTPException(403, "Fora do escopo")
    if doc["status"] != "pending":
        raise HTTPException(400, f"Não é possível cancelar (status={doc['status']})")
    await db.scheduled_messages.update_one({"id": sched_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


# ---------- Marcar como não lida ----------
@router.post("/messages/{uid}/mark-unread")
async def mark_unread(uid: str, folder: str = "INBOX", user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        client.flag(uid, folder=folder, flag="\\Seen", add=False)
        return {"ok": True}
    except MailError as e:
        raise HTTPException(502, str(e))


@router.post("/messages/{uid}/move")
async def move_message(uid: str, src_folder: str, dst_folder: str, user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        client.move_message(uid, src_folder, dst_folder)
        return {"ok": True}
    except MailError as e:
        raise HTTPException(502, str(e))


@router.delete("/messages/{uid}")
async def delete_message(uid: str, folder: str = "INBOX", user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        client.delete_message(uid, folder)
        return {"ok": True}
    except MailError as e:
        raise HTTPException(502, str(e))


@router.post("/messages/{uid}/flag")
async def flag_message(uid: str, folder: str, flag: str, add: bool = True,
                       user: dict = Depends(get_current_user)):
    """Toggle IMAP flags: \\Seen (read), \\Flagged (starred), \\Deleted."""
    client = await _get_mail_client(user)
    try:
        client.flag(uid, folder, flag, add)
        return {"ok": True}
    except MailError as e:
        raise HTTPException(502, str(e))
