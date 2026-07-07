"""Webmail login por bypass IMAP — autentica direto contra o servidor IMAP do domínio.

Fluxo:
  1. Cliente envia email + senha para /api/auth/webmail-login
  2. Backend extrai o domínio, busca config IMAP
  3. Se `allow_bypass_login=True`, tenta login IMAP com aquelas credenciais
  4. Se sucesso: cria/atualiza User (role=usuario_final) + EmailAccount com senha criptografada
  5. Retorna JWT + user (mesma resposta de /auth/login)
"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from database import get_db
from crypto_utils import encrypt
from models import new_id, now_iso
from auth import (
    hash_password, create_access_token, create_refresh_token, set_auth_cookies,
    _check_lockout, _record_failed, _record_success,
)
from services.mail import MailClient, MailError


router = APIRouter(prefix="/api/auth", tags=["auth"])


class WebmailLoginPayload(BaseModel):
    email: EmailStr
    password: str


@router.post("/webmail-login")
async def webmail_login(payload: WebmailLoginPayload, request: Request, response: Response):
    db = get_db()
    email = payload.email.lower().strip()
    if "@" not in email:
        raise HTTPException(400, "Formato de e-mail inválido")

    domain_name = email.split("@", 1)[1]
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"

    await _check_lockout(identifier)

    domain = await db.domains.find_one({"nome": domain_name})
    if not domain:
        await _record_failed(identifier)
        raise HTTPException(401, "Domínio não hospedado nesta plataforma")

    if not domain.get("allow_bypass_login"):
        # Bypass desabilitado — cai para o login normal
        raise HTTPException(
            401,
            "Login direto não habilitado para este domínio. Use um usuário cadastrado ou peça ao administrador para ativar 'Bypass IMAP' no domínio.",
        )

    imap_host = domain.get("imap_host")
    if not imap_host:
        # tenta derivar do servidor DirectAdmin associado
        if domain.get("directadmin_server_id"):
            server = await db.directadmin_servers.find_one({"id": domain["directadmin_server_id"]})
            if server:
                imap_host = server["url"].replace("https://", "").replace("http://", "").split(":")[0].rstrip("/")
    if not imap_host:
        raise HTTPException(400, "IMAP não configurado para este domínio")

    client = MailClient(
        host=imap_host,
        email_addr=email,
        password=payload.password,
        imap_port=int(domain.get("imap_port") or 993),
        smtp_port=int(domain.get("smtp_port") or 587),
        use_ssl=bool(domain.get("imap_ssl", True)),
    )
    try:
        # tenta abrir uma conexão IMAP autenticada (valida email+senha)
        m = client._imap()
        m.logout()
    except MailError:
        await _record_failed(identifier)
        raise HTTPException(401, "E-mail ou senha inválidos")

    # ---------- Upsert local ----------
    # 1) EmailAccount
    account = await db.email_accounts.find_one({"email": email, "dominio_id": domain["id"]})
    if not account:
        account = {
            "id": new_id(),
            "email": email,
            "dominio_id": domain["id"],
            "empresa_id": domain["empresa_id"],
            "quota_mb": 1024,
            "used_mb": 0,
            "status": "ativo",
            "password_enc": encrypt(payload.password),
            "created_at": now_iso(),
        }
        await db.email_accounts.insert_one(account)
    else:
        # atualiza a senha em cache (usuário pode ter trocado)
        await db.email_accounts.update_one(
            {"id": account["id"]},
            {"$set": {"password_enc": encrypt(payload.password)}},
        )

    # 2) User (usuario_final)
    user = await db.users.find_one({"email": email})
    if not user:
        user = {
            "id": new_id(),
            "email": email,
            "password_hash": hash_password(payload.password),
            "name": email.split("@")[0].replace(".", " ").title(),
            "role": "usuario_final",
            "empresa_id": domain["empresa_id"],
            "email_account_id": account["id"],
            "is_active": True,
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
    else:
        # ressincroniza vínculo com a conta + refresha o hash da senha
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "email_account_id": account["id"],
                "empresa_id": domain["empresa_id"],
                "password_hash": hash_password(payload.password),
                "is_active": True,
            }},
        )

    await _record_success(identifier, user["id"])

    access = create_access_token(user["id"], user["email"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)

    user_out = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return {"user": user_out, "access_token": access}
