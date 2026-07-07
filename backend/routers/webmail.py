"""Webmail router: IMAP/SMTP endpoints for the end user.

The end user's IMAP/SMTP credentials come from the email_account record
associated with their account (`email_account_id`). The host is derived from
the DirectAdmin server hostname associated with the account's domain, or,
when no server is set, the domain name itself (mail.<domain>) is used.
"""
from __future__ import annotations
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from typing import Optional

from database import get_db
from auth import get_current_user
from crypto_utils import decrypt
from services.mail import MailClient, MailError, FOLDER_MAP
from services.mail_idle import ImapIdleListener
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


async def _get_mail_creds(user: dict) -> tuple[str, str, str]:
    """Same as _get_mail_client but returns (host, email, password)."""
    c = await _get_mail_client(user)
    return c.host, c.email, c.password


@router.get("/folders")
async def folders(user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        return client.list_folders()
    except MailError as e:
        raise HTTPException(502, str(e))


@router.get("/messages")
async def messages(folder: str = "INBOX", limit: int = 50, search: Optional[str] = None,
                   page: int = 1, page_size: Optional[int] = None,
                   user: dict = Depends(get_current_user)):
    client = await _get_mail_client(user)
    try:
        result = client.list_messages(
            folder=folder, limit=limit, search=search,
            page=page, page_size=page_size,
        )
        # Retrocompat: se cliente não pediu paginação, devolve lista simples
        if page_size is None and page == 1:
            return result["items"]
        return result
    except MailError as e:
        raise HTTPException(502, str(e))


@router.get("/folder-counts")
async def folder_counts(folders: str = "INBOX,Sent,Drafts,Trash,Junk,Archive",
                        user: dict = Depends(get_current_user)):
    """Retorna contagens de mensagens (total/unread) por pasta em uma única conexão IMAP.

    `folders` é uma lista separada por vírgulas. Pastas inexistentes retornam zeros.
    """
    client = await _get_mail_client(user)
    try:
        wanted = [f.strip() for f in folders.split(",") if f.strip()]
        return client.unread_counts(wanted)
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


# ---------- Envio com anexos (multipart) ----------
MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024  # 25 MB (Gmail-like)


def _split_recipients(raw: str | None) -> list[str]:
    if not raw:
        return []
    # Aceita separadores por vírgula ou ponto-e-vírgula
    return [x.strip() for x in raw.replace(";", ",").split(",") if x.strip()]


@router.post("/send-with-attachments")
async def send_message_with_attachments(
    to: str = Form(...),
    cc: str = Form(""),
    bcc: str = Form(""),
    subject: str = Form("(sem assunto)"),
    body_text: str = Form(""),
    body_html: str = Form(""),
    attachments: list[UploadFile] = File(default=[]),
    user: dict = Depends(get_current_user),
):
    """Envia e-mail com anexos via multipart/form-data.

    Campos: `to`, `cc`, `bcc` são strings separadas por vírgula.
    `attachments` é uma lista de arquivos. Limite total: 25 MB.
    """
    to_list = _split_recipients(to)
    if not to_list:
        raise HTTPException(400, "Informe pelo menos um destinatário em 'to'")

    # Lê todos os arquivos em memória validando o tamanho total
    att_payloads: list[dict] = []
    total = 0
    for f in attachments or []:
        content = await f.read()
        total += len(content)
        if total > MAX_ATTACHMENTS_TOTAL_BYTES:
            raise HTTPException(413, f"Anexos excedem o limite de 25 MB (total atual: {total} bytes)")
        att_payloads.append({
            "filename": f.filename or "arquivo",
            "content": content,
            "content_type": f.content_type or "application/octet-stream",
        })

    client = await _get_mail_client(user)
    try:
        client.send(
            to=to_list,
            cc=_split_recipients(cc),
            bcc=_split_recipients(bcc),
            subject=subject or "(sem assunto)",
            body_html=body_html or None,
            body_text=body_text or None,
            attachments=att_payloads,
        )
        return {"ok": True, "attachments": len(att_payloads), "total_bytes": total}
    except MailError as e:
        raise HTTPException(502, str(e))


# ---------- Download de anexo ----------
from fastapi.responses import Response as FastAPIResponse  # noqa: E402


@router.get("/messages/{uid}/attachment/{index}")
async def download_attachment(
    uid: str, index: int, folder: str = "INBOX",
    user: dict = Depends(get_current_user),
):
    """Baixa o anexo `index`-ésimo da mensagem `uid` na pasta indicada.

    O índice segue a mesma ordem retornada em `GET /messages/{uid}` no campo
    `attachments`.
    """
    if index < 0:
        raise HTTPException(400, "Índice de anexo inválido")
    client = await _get_mail_client(user)
    try:
        filename, content_type, payload = client.get_attachment(uid, folder, index)
    except MailError as e:
        raise HTTPException(502, str(e))

    # Content-Disposition seguro (nomes com espaço/UTF-8 via RFC 5987)
    import urllib.parse
    quoted = urllib.parse.quote(filename or "arquivo")
    disp = f'attachment; filename="{(filename or "arquivo").encode("ascii", "replace").decode()}"; filename*=UTF-8\'\'{quoted}'

    return FastAPIResponse(
        content=payload,
        media_type=content_type or "application/octet-stream",
        headers={"Content-Disposition": disp},
    )


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


# ---------- SSE (IMAP IDLE push) ----------
@router.get("/events")
async def events(request: Request, folder: str = "INBOX",
                 user: dict = Depends(get_current_user)):
    """Server-Sent Events stream powered by IMAP IDLE.

    Emits:
      - `event: ready` when IDLE session is up
      - `event: new_mail` on EXISTS/RECENT (client should refetch listing + counts)
      - `event: expunge` on EXPUNGE (message removed remotely)
      - `event: error` when IMAP breaks (client will auto-reconnect via EventSource)
      - periodic `: keepalive` comments to keep proxies from closing the socket
    """
    host, email_addr, password = await _get_mail_creds(user)
    listener = ImapIdleListener(host=host, email=email_addr, password=password, folder=folder)

    async def event_generator():
        # Announce endpoint start immediately so proxies don't buffer the first bytes
        yield ": connected\n\n"
        keepalive_task: asyncio.Task | None = None
        keepalive_queue: asyncio.Queue[str] = asyncio.Queue()

        async def ping_loop():
            try:
                while True:
                    await asyncio.sleep(20)
                    await keepalive_queue.put(": keepalive\n\n")
            except asyncio.CancelledError:
                pass

        keepalive_task = asyncio.create_task(ping_loop())

        try:
            stream_iter = listener.stream().__aiter__()
            next_task = asyncio.create_task(stream_iter.__anext__())
            ping_task = asyncio.create_task(keepalive_queue.get())

            while True:
                if await request.is_disconnected():
                    break
                done, _pending = await asyncio.wait(
                    {next_task, ping_task},
                    timeout=25,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    # No progress in 25s — check disconnect and loop
                    continue
                if ping_task in done:
                    yield ping_task.result()
                    ping_task = asyncio.create_task(keepalive_queue.get())
                if next_task in done:
                    try:
                        evt = next_task.result()
                    except StopAsyncIteration:
                        # Underlying stream finished — signal client to reconnect
                        yield f"event: error\ndata: {json.dumps({'type':'error','detail':'stream_ended'})}\n\n"
                        break
                    yield evt.to_sse()
                    if evt.type == "error":
                        break
                    next_task = asyncio.create_task(stream_iter.__anext__())
        finally:
            listener.stop()
            if keepalive_task:
                keepalive_task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # nginx/proxies: disable buffering
            "Connection": "keep-alive",
        },
    )


# ---------- Vacation / Autoresponder (DirectAdmin) ----------
from services.directadmin import DirectAdminClient, DirectAdminError  # noqa: E402
from crypto_utils import decrypt as _decrypt  # noqa: E402


class VacationPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000, description="Corpo da resposta automática")
    starttime: str = Field(..., description="Data/hora início ISO-8601")
    endtime: str = Field(..., description="Data/hora fim ISO-8601")


async def _resolve_da_context(user: dict) -> tuple["DirectAdminClient", str, str]:
    """Retorna (DA client, domain, user_part) para a conta de e-mail do usuário.

    Levanta 400 se não for possível resolver — mesma semântica de `_get_mail_client`.
    """
    db = get_db()
    account = None
    if user.get("email_account_id"):
        account = await db.email_accounts.find_one({"id": user["email_account_id"]})
    if not account:
        account = await db.email_accounts.find_one({"email": user.get("email")})
    if not account:
        raise HTTPException(400, "Conta de e-mail não configurada para este usuário")

    domain = await db.domains.find_one({"id": account["dominio_id"]})
    if not domain or not domain.get("directadmin_server_id"):
        raise HTTPException(400, "Domínio sem servidor DirectAdmin configurado")

    server = await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})
    if not server:
        raise HTTPException(400, "Servidor DirectAdmin não localizado")

    token = _decrypt(server.get("api_token_enc", ""))
    if not token:
        raise HTTPException(400, "Token do DirectAdmin indisponível")

    url = server["url"].rstrip("/")
    # url pode ser https://host:2222 ou similar
    ssl = url.startswith("https://")
    host = url.replace("https://", "").replace("http://", "").split(":")[0]
    port = 2222
    try:
        port = int(url.split(":")[-1])
    except Exception:
        pass

    client = DirectAdminClient(
        url=f"{'https' if ssl else 'http'}://{host}",
        port=port,
        api_user=server.get("api_user", ""),
        api_token=token,
        ssl=ssl,
    )
    domain_name = domain["nome"]
    user_part = account["email"].split("@")[0]
    return client, domain_name, user_part


@router.get("/settings/vacation")
async def get_vacation(user: dict = Depends(get_current_user)):
    da, domain, user_part = await _resolve_da_context(user)
    try:
        cfg = da.get_vacation(domain, user_part)
    except DirectAdminError as e:
        raise HTTPException(502, str(e))
    return cfg or {"active": False, "text": "", "starttime": None, "endtime": None}


@router.put("/settings/vacation")
async def set_vacation(payload: VacationPayload, user: dict = Depends(get_current_user)):
    da, domain, user_part = await _resolve_da_context(user)
    # DirectAdmin espera formato "YYYY-MM-DD" para starttime/endtime
    def _fmt(dt_str: str) -> str:
        try:
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d")
        except Exception:
            raise HTTPException(400, f"Data inválida: {dt_str}")

    start = _fmt(payload.starttime)
    end = _fmt(payload.endtime)
    try:
        da.set_vacation(domain, user_part, payload.text, start, end)
    except DirectAdminError as e:
        raise HTTPException(502, str(e))
    return {"active": True, "text": payload.text, "starttime": start, "endtime": end}


@router.delete("/settings/vacation")
async def delete_vacation(user: dict = Depends(get_current_user)):
    da, domain, user_part = await _resolve_da_context(user)
    try:
        da.clear_vacation(domain, user_part)
    except DirectAdminError as e:
        raise HTTPException(502, str(e))
    return {"active": False}
