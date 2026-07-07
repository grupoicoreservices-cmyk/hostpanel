"""SaaS admin routers: empresas, servidores DirectAdmin, domínios, contas de e-mail, logs, prefs."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from database import get_db
from auth import (
    get_current_user, require_superadmin, require_admin,
    hash_password,
)
from crypto_utils import encrypt, decrypt
from models import (
    EmpresaCreate, EmpresaOut, EmpresaBase,
    DirectAdminServerCreate, DirectAdminServerUpdate, DirectAdminServerOut,
    DomainCreate, DomainOut,
    EmailAccountCreate, EmailAccountUpdate, EmailAccountOut,
    UserPreferences, UserCreate, UserOut,
    new_id, now_iso,
)
from services.directadmin import DirectAdminClient, DirectAdminError


router = APIRouter(prefix="/api", tags=["saas"])


async def _log_action(actor: dict, action: str, target: Optional[str] = None, details: dict | None = None):
    db = get_db()
    await db.admin_logs.insert_one({
        "id": new_id(),
        "actor_id": actor.get("id", ""),
        "actor_email": actor.get("email", ""),
        "action": action,
        "target": target,
        "details": details or {},
        "timestamp": now_iso(),
    })


def _scope_query(user: dict, base: dict | None = None) -> dict:
    """Restrict queries by empresa_id when the user is not superadmin."""
    q = dict(base or {})
    if user.get("role") != "superadmin":
        q["empresa_id"] = user.get("empresa_id")
    return q


# ---------- Dashboard ----------
@router.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(require_admin)):
    db = get_db()
    empresa_filter = {} if user["role"] == "superadmin" else {"id": user.get("empresa_id")}
    empresas = await db.empresas.count_documents(empresa_filter)
    dom_q = _scope_query(user)
    domains = await db.domains.count_documents(dom_q)
    accounts = await db.email_accounts.count_documents(dom_q)
    servers_online = await db.directadmin_servers.count_documents({"status": "online"})
    servers_total = await db.directadmin_servers.count_documents({})
    # sum quota_mb and used_mb
    used_total = 0.0
    quota_total = 0.0
    async for acc in db.email_accounts.find(dom_q, {"_id": 0, "used_mb": 1, "quota_mb": 1}):
        used_total += float(acc.get("used_mb", 0))
        quota_total += float(acc.get("quota_mb", 0))
    return {
        "empresas": empresas,
        "dominios": domains,
        "contas": accounts,
        "servidores_online": servers_online,
        "servidores_total": servers_total,
        "storage_used_mb": round(used_total, 2),
        "storage_quota_mb": round(quota_total, 2),
        "spam_blocked_7d": 4821,  # placeholder metric
    }


# ---------- Empresas ----------
@router.get("/empresas", response_model=list[EmpresaOut])
async def list_empresas(user: dict = Depends(require_admin)):
    db = get_db()
    q = {} if user["role"] == "superadmin" else {"id": user.get("empresa_id")}
    result = []
    async for e in db.empresas.find(q, {"_id": 0}):
        e["dominios_count"] = await db.domains.count_documents({"empresa_id": e["id"]})
        e["contas_count"] = await db.email_accounts.count_documents({"empresa_id": e["id"]})
        result.append(EmpresaOut(**e))
    return result


@router.post("/empresas", response_model=EmpresaOut)
async def create_empresa(payload: EmpresaCreate, user: dict = Depends(require_superadmin)):
    db = get_db()
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.empresas.insert_one(doc)
    await _log_action(user, "empresa.create", target=doc["id"], details={"nome": doc["nome"]})
    doc.pop("_id", None)
    return EmpresaOut(**doc, dominios_count=0, contas_count=0)


@router.patch("/empresas/{empresa_id}", response_model=EmpresaOut)
async def update_empresa(empresa_id: str, payload: EmpresaBase, user: dict = Depends(require_superadmin)):
    db = get_db()
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    await db.empresas.update_one({"id": empresa_id}, {"$set": upd})
    doc = await db.empresas.find_one({"id": empresa_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Empresa não encontrada")
    await _log_action(user, "empresa.update", target=empresa_id, details=upd)
    doc["dominios_count"] = await db.domains.count_documents({"empresa_id": empresa_id})
    doc["contas_count"] = await db.email_accounts.count_documents({"empresa_id": empresa_id})
    return EmpresaOut(**doc)


@router.delete("/empresas/{empresa_id}")
async def delete_empresa(empresa_id: str, user: dict = Depends(require_superadmin)):
    db = get_db()
    await db.empresas.delete_one({"id": empresa_id})
    await db.domains.delete_many({"empresa_id": empresa_id})
    await db.email_accounts.delete_many({"empresa_id": empresa_id})
    await _log_action(user, "empresa.delete", target=empresa_id)
    return {"ok": True}


# ---------- Servidores DirectAdmin ----------
@router.get("/servers", response_model=list[DirectAdminServerOut])
async def list_servers(_: dict = Depends(require_superadmin)):
    db = get_db()
    result = []
    async for s in db.directadmin_servers.find({}, {"_id": 0, "api_token": 0}):
        result.append(DirectAdminServerOut(**s))
    return result


@router.post("/servers", response_model=DirectAdminServerOut)
async def create_server(payload: DirectAdminServerCreate, user: dict = Depends(require_superadmin)):
    db = get_db()
    doc = payload.model_dump()
    doc["api_token"] = encrypt(doc["api_token"])
    doc["id"] = new_id()
    doc["status"] = "unknown"
    doc["created_at"] = now_iso()
    doc["last_check"] = None
    await db.directadmin_servers.insert_one(doc)
    await _log_action(user, "server.create", target=doc["id"], details={"nome": doc["nome"]})
    doc.pop("api_token", None)
    doc.pop("_id", None)
    return DirectAdminServerOut(**doc)


@router.patch("/servers/{server_id}", response_model=DirectAdminServerOut)
async def update_server(server_id: str, payload: DirectAdminServerUpdate, user: dict = Depends(require_superadmin)):
    db = get_db()
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "api_token" in upd:
        upd["api_token"] = encrypt(upd["api_token"])
    await db.directadmin_servers.update_one({"id": server_id}, {"$set": upd})
    doc = await db.directadmin_servers.find_one({"id": server_id}, {"_id": 0, "api_token": 0})
    if not doc:
        raise HTTPException(404, "Servidor não encontrado")
    await _log_action(user, "server.update", target=server_id)
    return DirectAdminServerOut(**doc)


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, user: dict = Depends(require_superadmin)):
    db = get_db()
    await db.directadmin_servers.delete_one({"id": server_id})
    await _log_action(user, "server.delete", target=server_id)
    return {"ok": True}


@router.post("/servers/{server_id}/test")
async def test_server(server_id: str, user: dict = Depends(require_superadmin)):
    db = get_db()
    doc = await db.directadmin_servers.find_one({"id": server_id})
    if not doc:
        raise HTTPException(404, "Servidor não encontrado")
    token = decrypt(doc.get("api_token", ""))
    client = DirectAdminClient(doc["url"], doc["port"], doc["api_user"], token, doc.get("ssl", True))
    ok = client.check()
    status = "online" if ok else "offline"
    await db.directadmin_servers.update_one(
        {"id": server_id},
        {"$set": {"status": status, "last_check": now_iso()}},
    )
    await _log_action(user, "server.test", target=server_id, details={"status": status})
    return {"status": status}


# ---------- Domínios ----------
@router.get("/dominios", response_model=list[DomainOut])
async def list_domains(empresa_id: Optional[str] = None, user: dict = Depends(require_admin)):
    db = get_db()
    q = _scope_query(user)
    if empresa_id and user["role"] == "superadmin":
        q["empresa_id"] = empresa_id
    result = []
    async for d in db.domains.find(q, {"_id": 0}):
        d["contas_count"] = await db.email_accounts.count_documents({"dominio_id": d["id"]})
        result.append(DomainOut(**d))
    return result


@router.post("/dominios", response_model=DomainOut)
async def create_domain(payload: DomainCreate, user: dict = Depends(require_admin)):
    db = get_db()
    if user["role"] != "superadmin" and payload.empresa_id != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo da empresa")
    empresa = await db.empresas.find_one({"id": payload.empresa_id})
    if not empresa:
        raise HTTPException(404, "Empresa não encontrada")
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.domains.insert_one(doc)
    await _log_action(user, "domain.create", target=doc["id"], details={"nome": doc["nome"]})

    # Auto-sincroniza contas de e-mail se um servidor DirectAdmin foi vinculado
    imported = 0
    if doc.get("directadmin_server_id"):
        try:
            imported = await _sync_domain_accounts(db, doc["id"], actor=user)
        except Exception:
            imported = 0

    doc.pop("_id", None)
    return DomainOut(**doc, contas_count=imported)


@router.post("/dominios/{domain_id}/sync")
async def sync_domain(domain_id: str, user: dict = Depends(require_admin)):
    """Puxa todas as contas de e-mail já existentes no DirectAdmin
    para este domínio e cadastra/atualiza localmente."""
    db = get_db()
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        raise HTTPException(404, "Domínio não encontrado")
    if user["role"] != "superadmin" and d.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")
    if not d.get("directadmin_server_id"):
        raise HTTPException(400, "Domínio não está vinculado a um servidor DirectAdmin")

    try:
        imported = await _sync_domain_accounts(db, domain_id, actor=user)
    except DirectAdminError as e:
        raise HTTPException(502, f"Falha ao consultar DirectAdmin: {e}")

    return {
        "ok": True,
        "domain": d["nome"],
        "imported_or_updated": imported,
    }


async def _sync_domain_accounts(db, domain_id: str, actor: dict | None = None) -> int:
    """Sincroniza as contas de e-mail do DirectAdmin para o Voxyra Mail.
    Retorna quantas contas foram criadas ou atualizadas.

    Regra:
      - Se a conta ainda não existir localmente, cria com password_enc vazio
        (o admin precisará resetar a senha para o usuário conseguir logar no webmail).
      - Se já existir, atualiza quota e uso.
    """
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        return 0
    server = await db.directadmin_servers.find_one({"id": d.get("directadmin_server_id")})
    if not server:
        return 0

    token = decrypt(server.get("api_token", ""))
    client = DirectAdminClient(server["url"], server["port"], server["api_user"], token, server.get("ssl", True))
    remote_accounts = client.list_email_accounts(d["nome"])

    count = 0
    for acc in remote_accounts:
        local_part = acc.get("user") or acc.get("email") or ""
        if not local_part:
            continue
        email = local_part if "@" in local_part else f"{local_part}@{d['nome']}"

        # quota e usage podem vir em MB, KB ou bytes dependendo da versão do DA
        quota_raw = acc.get("quota") or acc.get("quotabytes") or 0
        used_raw = acc.get("usage") or acc.get("used") or 0
        try:
            quota_mb = int(float(quota_raw)) if quota_raw else 1024
        except (TypeError, ValueError):
            quota_mb = 1024
        try:
            used_mb = float(used_raw) if used_raw else 0.0
        except (TypeError, ValueError):
            used_mb = 0.0

        existing = await db.email_accounts.find_one({"dominio_id": domain_id, "email": email})
        if existing:
            await db.email_accounts.update_one(
                {"id": existing["id"]},
                {"$set": {"quota_mb": quota_mb, "used_mb": used_mb}},
            )
        else:
            await db.email_accounts.insert_one({
                "id": new_id(),
                "email": email,
                "dominio_id": domain_id,
                "empresa_id": d["empresa_id"],
                "quota_mb": quota_mb,
                "used_mb": used_mb,
                "status": "ativo",
                "password_enc": "",  # importada — precisa reset via UI para webmail funcionar
                "created_at": now_iso(),
            })
        count += 1

    if actor is not None:
        await _log_action(
            actor, "domain.sync", target=domain_id,
            details={"domain": d["nome"], "imported_or_updated": count},
        )
    return count


@router.delete("/dominios/{domain_id}")
async def delete_domain(domain_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        raise HTTPException(404, "Domínio não encontrado")
    if user["role"] != "superadmin" and d.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")
    await db.domains.delete_one({"id": domain_id})
    await db.email_accounts.delete_many({"dominio_id": domain_id})
    await _log_action(user, "domain.delete", target=domain_id)
    return {"ok": True}


class DomainUpdate(BaseModel):
    directadmin_server_id: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_ssl: Optional[bool] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_tls: Optional[bool] = None
    webmail_url: Optional[str] = None
    allow_bypass_login: Optional[bool] = None


@router.patch("/dominios/{domain_id}", response_model=DomainOut)
async def update_domain(domain_id: str, payload: DomainUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        raise HTTPException(404, "Domínio não encontrado")
    if user["role"] != "superadmin" and d.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")

    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if upd:
        await db.domains.update_one({"id": domain_id}, {"$set": upd})
    await _log_action(user, "domain.update", target=domain_id, details={"fields": list(upd.keys())})

    fresh = await db.domains.find_one({"id": domain_id}, {"_id": 0})
    fresh["contas_count"] = await db.email_accounts.count_documents({"dominio_id": domain_id})
    return DomainOut(**fresh)


@router.post("/dominios/{domain_id}/test-imap")
async def test_domain_imap(domain_id: str, user: dict = Depends(require_admin)):
    import socket
    db = get_db()
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        raise HTTPException(404, "Domínio não encontrado")
    if user["role"] != "superadmin" and d.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")
    host = d.get("imap_host") or f"mail.{d['nome']}"
    port = int(d.get("imap_port") or 993)
    try:
        with socket.create_connection((host, port), timeout=5):
            return {"ok": True, "host": host, "port": port}
    except Exception as e:
        return {"ok": False, "host": host, "port": port, "error": str(e)[:200]}


@router.post("/dominios/{domain_id}/test-smtp")
async def test_domain_smtp(domain_id: str, user: dict = Depends(require_admin)):
    import socket
    db = get_db()
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        raise HTTPException(404, "Domínio não encontrado")
    if user["role"] != "superadmin" and d.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")
    host = d.get("smtp_host") or d.get("imap_host") or f"mail.{d['nome']}"
    port = int(d.get("smtp_port") or 587)
    try:
        with socket.create_connection((host, port), timeout=5):
            return {"ok": True, "host": host, "port": port}
    except Exception as e:
        return {"ok": False, "host": host, "port": port, "error": str(e)[:200]}


# ---------- Contas de e-mail ----------
@router.get("/contas", response_model=list[EmailAccountOut])
async def list_accounts(dominio_id: Optional[str] = None, user: dict = Depends(require_admin)):
    db = get_db()
    q = _scope_query(user)
    if dominio_id:
        q["dominio_id"] = dominio_id
    result = []
    async for a in db.email_accounts.find(q, {"_id": 0, "password_enc": 0}):
        result.append(EmailAccountOut(**a))
    return result


async def _get_da_client_for_domain(db, domain_id: str) -> tuple[DirectAdminClient, str] | tuple[None, str]:
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        return None, ""
    if not d.get("directadmin_server_id"):
        return None, d["nome"]
    s = await db.directadmin_servers.find_one({"id": d["directadmin_server_id"]})
    if not s:
        return None, d["nome"]
    token = decrypt(s.get("api_token", ""))
    return DirectAdminClient(s["url"], s["port"], s["api_user"], token, s.get("ssl", True)), d["nome"]


@router.post("/contas", response_model=EmailAccountOut)
async def create_account(payload: EmailAccountCreate, user: dict = Depends(require_admin)):
    db = get_db()
    if user["role"] != "superadmin" and payload.empresa_id != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")

    # Try to create on DirectAdmin if server is configured; not fatal on failure
    client, domain_name = await _get_da_client_for_domain(db, payload.dominio_id)
    da_status = "not_configured"
    if client:
        local_part = payload.email.split("@")[0]
        try:
            client.create_email(domain_name, local_part, payload.password, payload.quota_mb)
            da_status = "ok"
        except DirectAdminError as e:
            da_status = f"error: {e}"

    doc = payload.model_dump()
    doc["password_enc"] = encrypt(payload.password)
    doc.pop("password")
    doc["id"] = new_id()
    doc["used_mb"] = 0
    doc["created_at"] = now_iso()
    await db.email_accounts.insert_one(doc)
    await _log_action(user, "account.create", target=doc["id"],
                      details={"email": payload.email, "directadmin": da_status})
    doc.pop("password_enc", None)
    doc.pop("_id", None)
    return EmailAccountOut(**doc)


@router.patch("/contas/{account_id}", response_model=EmailAccountOut)
async def update_account(account_id: str, payload: EmailAccountUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    acc = await db.email_accounts.find_one({"id": account_id})
    if not acc:
        raise HTTPException(404, "Conta não encontrada")
    if user["role"] != "superadmin" and acc.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")

    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    da_status = "skipped"

    client, domain_name = await _get_da_client_for_domain(db, acc["dominio_id"])
    if client:
        local_part = acc["email"].split("@")[0]
        try:
            if "password" in upd:
                client.change_password(domain_name, local_part, upd["password"])
            if "quota_mb" in upd:
                client.change_quota(domain_name, local_part, upd["quota_mb"])
            if "status" in upd:
                client.suspend(domain_name, local_part, upd["status"] == "suspenso")
            da_status = "ok"
        except DirectAdminError as e:
            da_status = f"error: {e}"

    if "password" in upd:
        upd["password_enc"] = encrypt(upd.pop("password"))

    await db.email_accounts.update_one({"id": account_id}, {"$set": upd})
    await _log_action(user, "account.update", target=account_id, details={"da": da_status, "fields": list(upd.keys())})
    doc = await db.email_accounts.find_one({"id": account_id}, {"_id": 0, "password_enc": 0})
    return EmailAccountOut(**doc)


@router.delete("/contas/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    acc = await db.email_accounts.find_one({"id": account_id})
    if not acc:
        raise HTTPException(404, "Conta não encontrada")
    if user["role"] != "superadmin" and acc.get("empresa_id") != user.get("empresa_id"):
        raise HTTPException(403, "Fora do escopo")

    client, domain_name = await _get_da_client_for_domain(db, acc["dominio_id"])
    da_status = "skipped"
    if client:
        try:
            client.delete_email(domain_name, acc["email"].split("@")[0])
            da_status = "ok"
        except DirectAdminError as e:
            da_status = f"error: {e}"

    await db.email_accounts.delete_one({"id": account_id})
    await _log_action(user, "account.delete", target=account_id, details={"da": da_status})
    return {"ok": True}


# ---------- Logs ----------
@router.get("/admin-logs")
async def list_admin_logs(limit: int = 100, _: dict = Depends(require_admin)):
    db = get_db()
    result = []
    async for log in db.admin_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit):
        result.append(log)
    return result


@router.get("/login-logs")
async def list_login_logs(limit: int = 100, _: dict = Depends(require_superadmin)):
    db = get_db()
    result = []
    async for log in db.login_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit):
        result.append(log)
    return result


# ---------- Preferences ----------
@router.get("/preferences", response_model=UserPreferences)
async def get_preferences(user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.user_preferences.find_one({"user_id": user["id"]}, {"_id": 0})
    if not doc:
        return UserPreferences()
    doc.pop("user_id", None)
    return UserPreferences(**doc)


@router.put("/preferences", response_model=UserPreferences)
async def update_preferences(payload: UserPreferences, user: dict = Depends(get_current_user)):
    db = get_db()
    await db.user_preferences.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], **payload.model_dump()}},
        upsert=True,
    )
    return payload


# ---------- Users (empresa admins / usuarios) ----------
@router.get("/users", response_model=list[UserOut])
async def list_users(user: dict = Depends(require_admin)):
    db = get_db()
    q = {} if user["role"] == "superadmin" else {"empresa_id": user.get("empresa_id")}
    result = []
    async for u in db.users.find(q, {"_id": 0, "password_hash": 0}):
        result.append(UserOut(**u))
    return result


@router.post("/users", response_model=UserOut)
async def create_user(payload: UserCreate, user: dict = Depends(require_admin)):
    db = get_db()
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    if user["role"] != "superadmin":
        if payload.role == "superadmin":
            raise HTTPException(403, "Não pode criar superadmin")
        payload.empresa_id = user.get("empresa_id")

    doc = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "empresa_id": payload.empresa_id,
        "email_account_id": payload.email_account_id,
        "is_active": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await _log_action(user, "user.create", target=doc["id"], details={"email": email, "role": payload.role})
    doc.pop("password_hash", None)
    doc.pop("_id", None)
    return UserOut(**doc)
