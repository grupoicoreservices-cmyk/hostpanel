"""Backup / retenção de e-mails para servidor SFTP/FTP externo.

Este módulo expõe apenas o CRUD dos servidores de backup e o teste de
conexão. O agendador de coleta (polling IMAP → upload SFTP) e a UI de
restore serão implementados em iterações separadas.

Endpoints (todos exigem admin/superadmin):
  GET    /api/backup/servers                — lista servidores configurados
  POST   /api/backup/servers                — cria novo servidor
  GET    /api/backup/servers/{id}           — detalhes de um servidor
  PATCH  /api/backup/servers/{id}           — atualiza um servidor
  DELETE /api/backup/servers/{id}           — exclui um servidor
  POST   /api/backup/servers/{id}/test      — testa conexão SFTP/FTP
"""
from __future__ import annotations
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from crypto_utils import encrypt, decrypt
from database import get_db
from models import (
    BackupServerCreate, BackupServerUpdate, BackupServerOut, new_id, now_iso,
)


from services.backup_service import backup_server_run, restore_entries
from services.backup_scheduler import reload_jobs, next_run_iso


router = APIRouter(prefix="/api/backup", tags=["backup"])


# ============================================================
# Helpers
# ============================================================
def _scope_filter(user: dict) -> dict:
    """Superadmin vê tudo, empresa_admin só da própria empresa."""
    if user.get("role") == "superadmin":
        return {}
    return {"$or": [{"empresa_id": user.get("empresa_id")}, {"empresa_id": None}]}


def _serialize(doc: dict) -> BackupServerOut:
    """Remove campos sensíveis, adiciona next_run_at do scheduler e devolve model."""
    for k in ("password_enc", "private_key_enc", "passphrase_enc", "_id"):
        doc.pop(k, None)
    doc["next_run_at"] = next_run_iso(doc["id"])
    return BackupServerOut(**doc)


def _test_connection_sync(cfg: dict) -> tuple[bool, str]:
    """Executa a conexão sincronamente. Retorna (ok, mensagem)."""
    protocol = cfg["protocol"]
    host = cfg["host"]
    port = int(cfg["port"])
    username = cfg["username"]
    base_path = cfg.get("base_path", "/")
    auth_type = cfg.get("auth_type", "password")

    try:
        if protocol == "sftp":
            import paramiko  # dependência instalada sob demanda
            transport = paramiko.Transport((host, port))
            transport.banner_timeout = 15
            try:
                if auth_type == "key":
                    pk_text = decrypt(cfg.get("private_key_enc", "") or "")
                    if not pk_text:
                        return False, "Chave privada não configurada"
                    passphrase = decrypt(cfg.get("passphrase_enc", "") or "") or None
                    key = _load_private_key(pk_text, passphrase)
                    transport.connect(username=username, pkey=key)
                else:
                    password = decrypt(cfg.get("password_enc", "") or "")
                    transport.connect(username=username, password=password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                try:
                    # Testa listar o diretório base; se não existir, tenta criar
                    try:
                        sftp.stat(base_path)
                    except FileNotFoundError:
                        _mkdir_p_sftp(sftp, base_path)
                    # Testa escrita: cria e apaga um arquivo probe
                    probe = f"{base_path.rstrip('/')}/.voxyra-probe-{int(datetime.now(timezone.utc).timestamp())}"
                    with sftp.file(probe, "w") as f:
                        f.write("voxyra-probe\n")
                    sftp.remove(probe)
                    return True, f"Conectado como {username}@{host}:{port}. Escrita em {base_path} confirmada."
                finally:
                    sftp.close()
            finally:
                transport.close()

        elif protocol in ("ftp", "ftps"):
            import ftplib
            if protocol == "ftps":
                ftp = ftplib.FTP_TLS(timeout=15)
            else:
                ftp = ftplib.FTP(timeout=15)
            ftp.connect(host, port)
            password = decrypt(cfg.get("password_enc", "") or "")
            ftp.login(user=username, passwd=password)
            if protocol == "ftps":
                ftp.prot_p()
            # Tenta cd para base_path (cria se não existir)
            _cd_or_mkdir_ftp(ftp, base_path)
            # Testa escrita
            probe_name = f".voxyra-probe-{int(datetime.now(timezone.utc).timestamp())}"
            ftp.storbinary(f"STOR {probe_name}", io.BytesIO(b"voxyra-probe\n"))
            ftp.delete(probe_name)
            ftp.quit()
            return True, f"Conectado {protocol.upper()} como {username}@{host}:{port}. Escrita em {base_path} confirmada."

        return False, f"Protocolo não suportado: {protocol}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def _load_private_key(pem: str, passphrase: str | None):
    import paramiko
    from io import StringIO
    for KeyCls in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey, paramiko.DSSKey):
        try:
            return KeyCls.from_private_key(StringIO(pem), password=passphrase)
        except Exception:
            continue
    raise ValueError("Formato de chave privada não reconhecido (Ed25519/RSA/ECDSA/DSS)")


def _mkdir_p_sftp(sftp, path: str) -> None:
    parts = [p for p in path.split("/") if p]
    cur = ""
    for p in parts:
        cur = f"{cur}/{p}"
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def _cd_or_mkdir_ftp(ftp, path: str) -> None:
    parts = [p for p in path.split("/") if p]
    ftp.cwd("/")
    for p in parts:
        try:
            ftp.cwd(p)
        except Exception:
            ftp.mkd(p)
            ftp.cwd(p)


# ============================================================
# Endpoints
# ============================================================
@router.get("/servers", response_model=list[BackupServerOut])
async def list_servers(user: dict = Depends(require_admin)):
    db = get_db()
    q = _scope_filter(user)
    rows = []
    async for d in db.backup_servers.find(q, {"_id": 0}):
        rows.append(_serialize(dict(d)))
    return rows


@router.post("/servers", response_model=BackupServerOut, status_code=201)
async def create_server(payload: BackupServerCreate, user: dict = Depends(require_admin)):
    db = get_db()
    doc = {
        "id": new_id(),
        "nome": payload.nome,
        "protocol": payload.protocol,
        "host": payload.host,
        "port": int(payload.port),
        "username": payload.username,
        "auth_type": payload.auth_type,
        "base_path": payload.base_path or "/backup",
        "empresa_id": payload.empresa_id,
        "retention_days": max(1, int(payload.retention_days)),
        "enabled": bool(payload.enabled),
        "poll_interval_min": max(1, int(payload.poll_interval_min)),
        "created_at": now_iso(),
        "last_run_at": None,
        "last_status": "never",
        "last_error": None,
        "total_messages_backed_up": 0,
        "password_enc": encrypt(payload.password or "") if payload.password else "",
        "private_key_enc": encrypt(payload.private_key or "") if payload.private_key else "",
        "passphrase_enc": encrypt(payload.passphrase or "") if payload.passphrase else "",
    }
    # Regras mínimas de validação de credenciais
    if payload.auth_type == "password" and not payload.password:
        raise HTTPException(400, "Senha obrigatória para autenticação por senha")
    if payload.auth_type == "key" and not payload.private_key:
        raise HTTPException(400, "Chave privada obrigatória para autenticação por chave")

    await db.backup_servers.insert_one(doc)
    await reload_jobs()
    return _serialize(dict(doc))


@router.get("/servers/{server_id}", response_model=BackupServerOut)
async def get_server(server_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    doc = await db.backup_servers.find_one({"id": server_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Servidor não encontrado")
    if user.get("role") != "superadmin" and doc.get("empresa_id") not in (None, user.get("empresa_id")):
        raise HTTPException(403, "Fora do escopo")
    return _serialize(dict(doc))


@router.patch("/servers/{server_id}", response_model=BackupServerOut)
async def update_server(server_id: str, payload: BackupServerUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    doc = await db.backup_servers.find_one({"id": server_id})
    if not doc:
        raise HTTPException(404, "Servidor não encontrado")
    if user.get("role") != "superadmin" and doc.get("empresa_id") not in (None, user.get("empresa_id")):
        raise HTTPException(403, "Fora do escopo")

    raw = payload.model_dump(exclude_unset=True)
    upd: dict = {}

    # Campos "simples" (não criptografados)
    for f in ("nome", "protocol", "host", "port", "username", "auth_type",
              "base_path", "empresa_id", "retention_days", "enabled", "poll_interval_min"):
        if f in raw and raw[f] is not None:
            upd[f] = raw[f]

    # Campos sensíveis: só sobrescreve se novos valores foram fornecidos
    if raw.get("password"):
        upd["password_enc"] = encrypt(raw["password"])
    if raw.get("private_key"):
        upd["private_key_enc"] = encrypt(raw["private_key"])
    if raw.get("passphrase") is not None:
        upd["passphrase_enc"] = encrypt(raw["passphrase"]) if raw["passphrase"] else ""

    if upd:
        await db.backup_servers.update_one({"id": server_id}, {"$set": upd})
    await reload_jobs()
    fresh = await db.backup_servers.find_one({"id": server_id}, {"_id": 0})
    return _serialize(dict(fresh))


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    doc = await db.backup_servers.find_one({"id": server_id})
    if not doc:
        raise HTTPException(404, "Servidor não encontrado")
    if user.get("role") != "superadmin" and doc.get("empresa_id") not in (None, user.get("empresa_id")):
        raise HTTPException(403, "Fora do escopo")
    await db.backup_servers.delete_one({"id": server_id})
    # Também remove entradas de índice órfãs (não apaga arquivos SFTP)
    await db.backup_index.delete_many({"server_id": server_id})
    await reload_jobs()
    return {"ok": True}


@router.post("/servers/{server_id}/test")
async def test_server(server_id: str, user: dict = Depends(require_admin)):
    import asyncio
    db = get_db()
    doc = await db.backup_servers.find_one({"id": server_id})
    if not doc:
        raise HTTPException(404, "Servidor não encontrado")
    if user.get("role") != "superadmin" and doc.get("empresa_id") not in (None, user.get("empresa_id")):
        raise HTTPException(403, "Fora do escopo")

    ok, msg = await asyncio.to_thread(_test_connection_sync, doc)
    await db.backup_servers.update_one(
        {"id": server_id},
        {"$set": {
            "last_status": "ok" if ok else f"error: {msg[:200]}",
            "last_error": None if ok else msg,
            "last_run_at": now_iso(),
        }},
    )
    if not ok:
        raise HTTPException(502, msg)
    return {"ok": True, "message": msg}


# ============================================================
# Fase 2 — Run manual, Archive listing e Restore
# ============================================================
from pydantic import BaseModel  # noqa: E402

class RestorePayload(BaseModel):
    entry_ids: list[str]
    target_folder: str = "INBOX"


@router.post("/servers/{server_id}/run")
async def run_now(server_id: str, user: dict = Depends(require_admin)):
    """Dispara imediatamente uma corrida de backup para o servidor."""
    import asyncio
    db = get_db()
    srv = await db.backup_servers.find_one({"id": server_id})
    if not srv:
        raise HTTPException(404, "Servidor não encontrado")
    if user.get("role") != "superadmin" and srv.get("empresa_id") not in (None, user.get("empresa_id")):
        raise HTTPException(403, "Fora do escopo")
    # Dispara em background para não bloquear a resposta HTTP
    async def _bg():
        try:
            await backup_server_run(server_id)
        except Exception:
            pass
    asyncio.create_task(_bg())
    return {"ok": True, "message": "Backup disparado em background"}


@router.get("/archive")
async def list_archive(
    server_id: str | None = None,
    account_id: str | None = None,
    dominio_id: str | None = None,
    q: str | None = None,
    limit: int = 100,
    user: dict = Depends(require_admin),
):
    """Lista entradas do índice de backup com filtros e paginação simples."""
    db = get_db()
    query: dict = {"deleted_at": None}
    if server_id:  query["server_id"] = server_id
    if account_id: query["account_id"] = account_id
    if dominio_id: query["dominio_id"] = dominio_id
    if q:
        query["$or"] = [
            {"subject": {"$regex": q, "$options": "i"}},
            {"from_addr": {"$regex": q, "$options": "i"}},
            {"from_name": {"$regex": q, "$options": "i"}},
        ]
    if user.get("role") != "superadmin":
        query["empresa_id"] = user.get("empresa_id")
    limit = max(1, min(500, int(limit)))
    rows = []
    async for d in db.backup_index.find(query, {"_id": 0}).sort("backed_up_at", -1).limit(limit):
        rows.append(d)
    return {"total": len(rows), "entries": rows}


@router.post("/servers/{server_id}/restore")
async def restore(server_id: str, payload: RestorePayload, user: dict = Depends(require_admin)):
    db = get_db()
    srv = await db.backup_servers.find_one({"id": server_id})
    if not srv:
        raise HTTPException(404, "Servidor não encontrado")
    if user.get("role") != "superadmin" and srv.get("empresa_id") not in (None, user.get("empresa_id")):
        raise HTTPException(403, "Fora do escopo")
    if not payload.entry_ids:
        raise HTTPException(400, "Nenhuma entrada selecionada")
    result = await restore_entries(server_id, payload.entry_ids, payload.target_folder or "INBOX")
    return {"ok": True, **result}
