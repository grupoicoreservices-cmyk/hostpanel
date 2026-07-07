"""Backup service — baixa e-mails via IMAP e envia para o SFTP/FTP.

Estrutura no SFTP:
    {base_path}/{empresa_slug}/{domain}/{email_local}/{YYYY-MM}/{msg_uid}.eml

Índice no Mongo (coleção `backup_index`): permite pesquisar e restaurar
mensagens sem precisar percorrer o SFTP a cada consulta.
"""
from __future__ import annotations
import email
import io
import logging
import re
import ssl
from datetime import datetime, timezone, timedelta
from email import policy
from email.utils import parseaddr

from crypto_utils import decrypt
from database import get_db
from services.mail import _decode  # reutiliza decoder de headers do webmail


log = logging.getLogger("voxyra.backup")

# Máximo de mensagens processadas por conta em uma corrida (evita rodadas gigantes).
MAX_MESSAGES_PER_RUN = 200
# Chunk usado pelo SFTPClient para escrita
SFTP_CHUNK = 32 * 1024


# ============================================================
# Slug helpers
# ============================================================
_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def slugify(txt: str) -> str:
    return _SAFE_RE.sub("_", (txt or "").strip()).strip("_") or "sem-nome"


# ============================================================
# SFTP wrappers
# ============================================================
class _SFTPHandle:
    """Contexto simples que abre e fecha uma sessão SFTP/FTP."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.protocol = cfg["protocol"]
        self._transport = None
        self._sftp = None
        self._ftp = None

    def __enter__(self):
        import paramiko
        cfg = self.cfg
        if self.protocol == "sftp":
            self._transport = paramiko.Transport((cfg["host"], int(cfg["port"])))
            self._transport.banner_timeout = 20
            if cfg.get("auth_type") == "key":
                pk_text = decrypt(cfg.get("private_key_enc", "") or "")
                passphrase = decrypt(cfg.get("passphrase_enc", "") or "") or None
                key = _load_private_key(pk_text, passphrase)
                self._transport.connect(username=cfg["username"], pkey=key)
            else:
                password = decrypt(cfg.get("password_enc", "") or "")
                self._transport.connect(username=cfg["username"], password=password)
            self._sftp = paramiko.SFTPClient.from_transport(self._transport)
            return self
        else:
            import ftplib
            if self.protocol == "ftps":
                ftp = ftplib.FTP_TLS(timeout=20)
            else:
                ftp = ftplib.FTP(timeout=20)
            ftp.connect(cfg["host"], int(cfg["port"]))
            password = decrypt(cfg.get("password_enc", "") or "")
            ftp.login(user=cfg["username"], passwd=password)
            if self.protocol == "ftps":
                ftp.prot_p()
            self._ftp = ftp
            return self

    def __exit__(self, *a):
        try:
            if self._sftp: self._sftp.close()
        except Exception: pass
        try:
            if self._transport: self._transport.close()
        except Exception: pass
        try:
            if self._ftp: self._ftp.quit()
        except Exception: pass

    def mkdirs(self, path: str) -> None:
        """Cria (idempotente) toda a hierarquia de diretórios do path fornecido.

        Após a execução, o CWD do FTP FICA no diretório criado — assim uploads
        subsequentes podem usar nomes de arquivo RELATIVOS (essencial para
        servidores FTP com chroot que rejeitam paths absolutos em STOR).
        """
        parts = [p for p in path.split("/") if p]
        if self._sftp is not None:
            cur = ""
            for p in parts:
                cur = f"{cur}/{p}"
                try:
                    self._sftp.stat(cur)
                except FileNotFoundError:
                    self._sftp.mkdir(cur)
        else:
            self._ftp.cwd("/")
            for p in parts:
                try:
                    self._ftp.cwd(p)
                except Exception:
                    self._ftp.mkd(p); self._ftp.cwd(p)
            # NÃO volta para "/" — o caller vai fazer STOR com nome relativo

    def upload(self, path: str, data: bytes) -> None:
        parent = "/".join(path.split("/")[:-1])
        filename = path.split("/")[-1]
        if parent:
            self.mkdirs(parent)
        if self._sftp is not None:
            # SFTP aceita path absoluto sem problemas
            with self._sftp.file(path, "wb") as f:
                f.write(data)
        else:
            # FTP: `mkdirs` já colocou o CWD no diretório correto.
            # Usar nome relativo evita "550 Permission denied" em chroots.
            self._ftp.storbinary(f"STOR {filename}", io.BytesIO(data))

    def download(self, path: str) -> bytes:
        if self._sftp is not None:
            with self._sftp.file(path, "rb") as f:
                return f.read()
        # FTP: navega ao diretório-pai e faz RETR com nome relativo
        parent = "/".join(path.split("/")[:-1])
        filename = path.split("/")[-1]
        if parent:
            self._ftp.cwd("/")
            for p in [x for x in parent.split("/") if x]:
                self._ftp.cwd(p)
        buf = io.BytesIO()
        self._ftp.retrbinary(f"RETR {filename}", buf.write)
        return buf.getvalue()

    def remove(self, path: str) -> None:
        try:
            if self._sftp is not None:
                self._sftp.remove(path)
            else:
                # FTP: DELE com nome relativo após CD
                parent = "/".join(path.split("/")[:-1])
                filename = path.split("/")[-1]
                if parent:
                    self._ftp.cwd("/")
                    for p in [x for x in parent.split("/") if x]:
                        self._ftp.cwd(p)
                self._ftp.delete(filename)
        except Exception as e:
            log.warning("failed to remove %s: %s", path, e)


def _load_private_key(pem: str, passphrase: str | None):
    import paramiko
    from io import StringIO
    for KeyCls in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey, paramiko.DSSKey):
        try:
            return KeyCls.from_private_key(StringIO(pem), password=passphrase)
        except Exception:
            continue
    raise ValueError("Formato de chave privada não reconhecido")


# ============================================================
# IMAP helpers (síncrono, roda em thread pool)
# ============================================================
def _open_imap(account: dict, domain: dict, server: dict | None):
    import imaplib
    host = _imap_host(domain, server)
    if not host:
        raise RuntimeError(f"IMAP host não encontrado para {account['email']}")
    port = int(domain.get("imap_port") or 993)
    ssl_flag = bool(domain.get("imap_ssl", True))
    ctx = ssl.create_default_context()
    m = imaplib.IMAP4_SSL(host, port, ssl_context=ctx) if ssl_flag else imaplib.IMAP4(host, port)
    password = decrypt(account.get("password_enc", "") or "")
    m.login(account["email"], password)
    return m


def _imap_host(domain: dict, server: dict | None) -> str | None:
    host = domain.get("imap_host")
    if host: return host
    if server:
        return server["url"].replace("https://", "").replace("http://", "").split(":")[0].rstrip("/")
    return f"mail.{domain['nome']}" if domain.get("nome") else None


def _parse_email_headers(raw: bytes) -> dict:
    msg = email.message_from_bytes(raw, policy=policy.default)
    from_name, from_addr = parseaddr(str(msg.get("From", "") or ""))
    return {
        "subject": _decode(msg.get("Subject", "")),
        "from_name": from_name or from_addr,
        "from_addr": from_addr,
        "to_addr": str(msg.get("To", "") or ""),
        "date": str(msg.get("Date", "") or ""),
        "message_id": str(msg.get("Message-ID", "") or ""),
    }


# ============================================================
# Backup runner
# ============================================================
async def backup_server_run(server_id: str) -> dict:
    """Executa uma corrida de backup para o servidor SFTP indicado.

    Retorna dict com contadores {accounts, uploaded, skipped, errors}.
    """
    import asyncio
    db = get_db()
    srv = await db.backup_servers.find_one({"id": server_id})
    if not srv:
        raise RuntimeError(f"Servidor de backup {server_id} não encontrado")
    if not srv.get("enabled", False):
        log.info("Servidor %s desabilitado — pulando", server_id)
        return {"skipped_disabled": True}

    log.info("Iniciando corrida de backup para %s (%s)", server_id, srv.get("nome"))
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.backup_servers.update_one({"id": server_id}, {"$set": {"last_run_started_at": now_iso}})

    # Descobre contas em escopo com senha em cache
    q: dict = {"password_enc": {"$nin": [None, ""]}}
    if srv.get("empresa_id"):
        q["empresa_id"] = srv["empresa_id"]
    accounts = [a async for a in db.email_accounts.find(q, {"_id": 0})]

    dom_ids = list({a["dominio_id"] for a in accounts if a.get("dominio_id")})
    domains = {d["id"]: d async for d in db.domains.find({"id": {"$in": dom_ids}}, {"_id": 0})}
    srv_ids = list({d["directadmin_server_id"] for d in domains.values() if d.get("directadmin_server_id")})
    servers = {s["id"]: s async for s in db.directadmin_servers.find({"id": {"$in": srv_ids}}, {"_id": 0})}

    counters = {"accounts_processed": 0, "uploaded": 0, "skipped": 0, "errors": 0}
    first_error_detail: str | None = None  # armazena a 1ª mensagem para debug no UI

    def _run_one_account(acc: dict, dom: dict, da_srv: dict | None) -> dict:
        """Bloco síncrono — roda em thread. Retorna resumo por conta."""
        local = {"uploaded": 0, "skipped": 0, "errors": 0, "entries": [], "first_error": None}
        try:
            m = _open_imap(acc, dom, da_srv)
        except Exception as e:
            local["errors"] += 1
            local["first_error"] = f"IMAP login {acc['email']}: {type(e).__name__}: {e}"
            log.warning("Falha login IMAP %s: %s", acc["email"], e)
            return local
        try:
            typ, _ = m.select("INBOX", readonly=True)
            if typ != "OK":
                local["errors"] += 1
                return local
            # UIDVALIDITY protege contra reciclagem de UIDs
            typ, data = m.response("UIDVALIDITY")
            uidvalidity = int(data[0]) if typ == "OK" and data and data[0] else 0

            checkpoint_key = f"{server_id}:{acc['id']}"
            last = acc.get("_backup_last") or {}
            reset = last.get("server_id") != server_id or last.get("uidvalidity") != uidvalidity
            since_uid = 0 if reset else int(last.get("last_uid") or 0)

            typ, data = m.uid("search", None, "ALL")
            if typ != "OK":
                local["errors"] += 1
                return local
            uids = [int(x) for x in (data[0] or b"").split()]
            uids = [u for u in uids if u > since_uid][:MAX_MESSAGES_PER_RUN]
            if not uids:
                return local

            # Sessão SFTP única para todos os uploads dessa conta
            with _SFTPHandle(srv) as sf:
                base = (srv.get("base_path") or "/backup").rstrip("/")
                empresa_slug = slugify(acc.get("_empresa_nome") or acc.get("empresa_id") or "sem-empresa")
                dom_slug = slugify(dom["nome"])
                mail_local = slugify(acc["email"].split("@")[0])
                for uid in uids:
                    try:
                        typ, msg_data = m.uid("fetch", str(uid).encode(), "(RFC822)")
                        if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                            local["errors"] += 1; continue
                        raw = msg_data[0][1]
                        headers = _parse_email_headers(raw)
                        # Data pra pasta YYYY-MM: tenta pelo header, cai pra hoje
                        try:
                            d = email.utils.parsedate_to_datetime(headers["date"]) if headers.get("date") else None
                        except Exception:
                            d = None
                        if not d:
                            d = datetime.now(timezone.utc)
                        yyyymm = d.strftime("%Y-%m")
                        remote_path = f"{base}/{empresa_slug}/{dom_slug}/{mail_local}/{yyyymm}/{uid}.eml"
                        sf.upload(remote_path, raw)
                        local["entries"].append({
                            "message_uid": str(uid),
                            "uidvalidity": uidvalidity,
                            "sftp_path": remote_path,
                            "size": len(raw),
                            "date": headers.get("date"),
                            "message_id": headers.get("message_id"),
                            "subject": headers.get("subject"),
                            "from_addr": headers.get("from_addr"),
                            "from_name": headers.get("from_name"),
                            "to_addr": headers.get("to_addr"),
                        })
                        local["uploaded"] += 1
                    except Exception as e:
                        detail = f"upload uid={uid} de {acc['email']}: {type(e).__name__}: {e}"
                        log.warning("Falha %s", detail)
                        if not local.get("first_error"):
                            local["first_error"] = detail
                        local["errors"] += 1
            local["last_uid"] = uids[-1] if uids else since_uid
            local["uidvalidity"] = uidvalidity
        finally:
            try: m.logout()
            except Exception: pass
        return local

    # Loop async — cada conta em thread pool
    for acc in accounts:
        dom = domains.get(acc.get("dominio_id"))
        if not dom:
            counters["skipped"] += 1; continue
        srv_da = servers.get(dom.get("directadmin_server_id")) if dom.get("directadmin_server_id") else None
        # Anexa nome da empresa para o slug do path
        if acc.get("empresa_id"):
            empresa = await db.empresas.find_one({"id": acc["empresa_id"]}, {"_id": 0, "nome": 1})
            acc["_empresa_nome"] = (empresa or {}).get("nome") if empresa else None

        result = await asyncio.to_thread(_run_one_account, acc, dom, srv_da)
        counters["accounts_processed"] += 1
        counters["uploaded"] += result["uploaded"]
        counters["skipped"] += result["skipped"]
        counters["errors"] += result["errors"]
        if not first_error_detail and result.get("first_error"):
            first_error_detail = result["first_error"]

        # Persiste entradas no índice
        if result["entries"]:
            docs = []
            for e in result["entries"]:
                docs.append({
                    **e,
                    "id": f"{server_id}:{acc['id']}:{e['message_uid']}",
                    "server_id": server_id,
                    "account_id": acc["id"],
                    "email": acc["email"],
                    "dominio_id": acc.get("dominio_id"),
                    "empresa_id": acc.get("empresa_id"),
                    "backed_up_at": datetime.now(timezone.utc).isoformat(),
                    "restored_at": None,
                    "deleted_at": None,
                })
            # bulk upsert (evita duplicar em reruns)
            for d in docs:
                await db.backup_index.update_one({"id": d["id"]}, {"$set": d}, upsert=True)

        # Atualiza checkpoint da conta
        if "last_uid" in result:
            await db.email_accounts.update_one(
                {"id": acc["id"]},
                {"$set": {"_backup_last": {
                    "server_id": server_id,
                    "uidvalidity": result["uidvalidity"],
                    "last_uid": result["last_uid"],
                    "at": datetime.now(timezone.utc).isoformat(),
                }}},
            )

    # Finaliza métricas
    if counters["errors"] == 0:
        last_status = f"ok ({counters['uploaded']} uploads)"
        last_error = None
    else:
        # Mostra o detalhe do 1º erro observado — ajuda muito no debug via UI
        last_status = f"partial: {counters['errors']} erros"
        last_error = first_error_detail or f"{counters['errors']} erros"

    await db.backup_servers.update_one(
        {"id": server_id},
        {"$set": {
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "last_status": last_status,
            "last_error": last_error,
        }, "$inc": {"total_messages_backed_up": counters["uploaded"]}},
    )
    log.info("Backup %s finalizado: %s (first_error=%s)", server_id, counters, first_error_detail)
    return counters


# ============================================================
# Retention purge
# ============================================================
async def purge_expired(server_id: str) -> int:
    """Remove entradas do índice + arquivos no SFTP mais antigos que retention_days."""
    db = get_db()
    srv = await db.backup_servers.find_one({"id": server_id})
    if not srv: return 0
    retention = int(srv.get("retention_days") or 90)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention)).isoformat()
    q = {"server_id": server_id, "backed_up_at": {"$lt": cutoff}, "deleted_at": None}
    to_remove = [d async for d in db.backup_index.find(q, {"_id": 0})]
    if not to_remove:
        return 0
    removed = 0
    import asyncio
    def _remove_all():
        with _SFTPHandle(srv) as sf:
            n = 0
            for entry in to_remove:
                try:
                    sf.remove(entry["sftp_path"])
                    n += 1
                except Exception:
                    pass
            return n
    removed = await asyncio.to_thread(_remove_all)
    now_iso = datetime.now(timezone.utc).isoformat()
    for entry in to_remove:
        await db.backup_index.update_one(
            {"id": entry["id"]},
            {"$set": {"deleted_at": now_iso}},
        )
    log.info("Purge %s removeu %s entradas", server_id, removed)
    return removed


# ============================================================
# Restore
# ============================================================
async def restore_entries(server_id: str, entry_ids: list[str], target_folder: str = "INBOX") -> dict:
    """Baixa .eml do SFTP e faz IMAP APPEND na conta original."""
    import asyncio, imaplib
    db = get_db()
    srv = await db.backup_servers.find_one({"id": server_id})
    if not srv:
        raise RuntimeError("Servidor de backup não encontrado")
    entries = [e async for e in db.backup_index.find({"id": {"$in": entry_ids}}, {"_id": 0})]
    if not entries:
        return {"restored": 0, "errors": 0}

    def _do_restore() -> dict:
        restored, errors = 0, 0
        # agrupa por account
        by_acc: dict[str, list[dict]] = {}
        for e in entries:
            by_acc.setdefault(e["account_id"], []).append(e)
        with _SFTPHandle(srv) as sf:
            for account_id, ents in by_acc.items():
                # busca conta síncrono no event loop já é impossível — pré-buscamos abaixo
                acc = _sync_account_cache.get(account_id)
                if not acc:
                    errors += len(ents); continue
                dom = _sync_domain_cache.get(acc.get("dominio_id"))
                if not dom:
                    errors += len(ents); continue
                da_srv = _sync_server_cache.get(dom.get("directadmin_server_id")) if dom.get("directadmin_server_id") else None
                try:
                    m = _open_imap(acc, dom, da_srv)
                except Exception:
                    errors += len(ents); continue
                try:
                    # tenta criar pasta destino se não existir
                    try: m.create(target_folder)
                    except Exception: pass
                    for e in ents:
                        try:
                            raw = sf.download(e["sftp_path"])
                            m.append(target_folder, "", imaplib.Time2Internaldate(datetime.now(timezone.utc)), raw)
                            restored += 1
                        except Exception:
                            errors += 1
                finally:
                    try: m.logout()
                    except Exception: pass
        return {"restored": restored, "errors": errors}

    # Pré-cache contas/domínios/servidores (o loop de restore roda em thread)
    account_ids = list({e["account_id"] for e in entries})
    _sync_account_cache = {a["id"]: a async for a in db.email_accounts.find({"id": {"$in": account_ids}}, {"_id": 0})}
    dom_ids = list({a["dominio_id"] for a in _sync_account_cache.values() if a.get("dominio_id")})
    _sync_domain_cache = {d["id"]: d async for d in db.domains.find({"id": {"$in": dom_ids}}, {"_id": 0})}
    srv_ids = list({d["directadmin_server_id"] for d in _sync_domain_cache.values() if d.get("directadmin_server_id")})
    _sync_server_cache = {s["id"]: s async for s in db.directadmin_servers.find({"id": {"$in": srv_ids}}, {"_id": 0})}

    result = await asyncio.to_thread(_do_restore)
    now_iso = datetime.now(timezone.utc).isoformat()
    if result["restored"] > 0:
        await db.backup_index.update_many(
            {"id": {"$in": entry_ids}},
            {"$set": {"restored_at": now_iso, "restored_to": target_folder}},
        )
    return result
