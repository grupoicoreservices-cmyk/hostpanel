"""APScheduler que dispara backups periódicos por servidor SFTP configurado."""
from __future__ import annotations
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from database import get_db
from services.backup_service import backup_server_run, purge_expired


log = logging.getLogger("voxyra.backup.scheduler")

_scheduler: AsyncIOScheduler | None = None


def _job_id(server_id: str) -> str:
    return f"backup-run-{server_id}"


def _purge_job_id(server_id: str) -> str:
    return f"backup-purge-{server_id}"


async def _wrap_run(server_id: str):
    try:
        await backup_server_run(server_id)
    except Exception as e:
        log.exception("Backup run falhou para %s: %s", server_id, e)


async def _wrap_purge(server_id: str):
    try:
        await purge_expired(server_id)
    except Exception as e:
        log.exception("Purge falhou para %s: %s", server_id, e)


async def reload_jobs() -> None:
    """Re-lê os servidores do Mongo e ajusta os jobs do APScheduler.

    Chame após criar/editar/excluir servidores para sincronizar o scheduler.
    """
    global _scheduler
    if _scheduler is None:
        return
    db = get_db()
    servers = [s async for s in db.backup_servers.find({}, {"_id": 0})]
    active_ids: set[str] = set()

    for s in servers:
        sid = s["id"]
        active_ids.add(sid)
        interval = max(1, int(s.get("poll_interval_min") or 15))
        run_job_id = _job_id(sid)
        purge_job_id = _purge_job_id(sid)

        # Job de coleta — só cria se enabled
        if s.get("enabled", False):
            _scheduler.add_job(
                _wrap_run, IntervalTrigger(minutes=interval),
                args=[sid], id=run_job_id, replace_existing=True, coalesce=True, max_instances=1,
                misfire_grace_time=60,
            )
        else:
            try: _scheduler.remove_job(run_job_id)
            except Exception: pass

        # Purge nightly — sempre roda enquanto o servidor existir
        _scheduler.add_job(
            _wrap_purge, CronTrigger(hour=3, minute=30),
            args=[sid], id=purge_job_id, replace_existing=True, coalesce=True, max_instances=1,
        )

    # Remove jobs órfãos (servidores deletados)
    for job in list(_scheduler.get_jobs()):
        if not (job.id.startswith("backup-run-") or job.id.startswith("backup-purge-")):
            continue
        sid = job.id.replace("backup-run-", "").replace("backup-purge-", "")
        if sid not in active_ids:
            _scheduler.remove_job(job.id)

    log.info("Scheduler sincronizado — %s servidores ativos", len(active_ids))


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.start()
    log.info("Scheduler de backup iniciado")

    # Job global: verifica mensagens agendadas a cada 30 segundos
    from apscheduler.triggers.interval import IntervalTrigger as _IT
    _scheduler.add_job(
        _flush_scheduled_sends,
        _IT(seconds=30),
        id="scheduled-sender",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )

    async def _boot():
        # Aguarda 5s pra o backend terminar de subir antes de agendar
        await asyncio.sleep(5)
        await reload_jobs()

    asyncio.create_task(_boot())


async def _flush_scheduled_sends() -> None:
    """Envia todas as mensagens agendadas que já venceram."""
    from datetime import datetime, timezone
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    cursor = db.scheduled_messages.find(
        {"status": "pending", "scheduled_at": {"$lte": now}},
    )
    async for doc in cursor:
        try:
            from crypto_utils import decrypt as _dec
            from services.mail import MailClient as _MC
            # Recupera conta e monta client
            acc_id = doc.get("email_account_id")
            if not acc_id:
                await db.scheduled_messages.update_one({"id": doc["id"]}, {"$set": {"status": "failed", "error": "sem email_account_id"}})
                continue
            acc = await db.email_accounts.find_one({"id": acc_id})
            if not acc:
                await db.scheduled_messages.update_one({"id": doc["id"]}, {"$set": {"status": "failed", "error": "conta removida"}})
                continue
            password = _dec(acc.get("password_enc", "") or "")
            if not password:
                await db.scheduled_messages.update_one({"id": doc["id"]}, {"$set": {"status": "failed", "error": "senha ausente"}})
                continue
            dom = await db.domains.find_one({"id": acc["dominio_id"]})
            host = (dom or {}).get("imap_host") or f"mail.{(dom or {}).get('nome','')}"
            client = _MC(
                host=host, email_addr=acc["email"], password=password,
                imap_port=int((dom or {}).get("imap_port") or 993),
                smtp_port=int((dom or {}).get("smtp_port") or 587),
                use_ssl=bool((dom or {}).get("imap_ssl", True)),
            )
            client.send(
                to=doc.get("to") or [], cc=doc.get("cc") or [], bcc=doc.get("bcc") or [],
                subject=doc.get("subject") or "", body_text=doc.get("body_text") or "",
                body_html=doc.get("body_html"),
            )
            await db.scheduled_messages.update_one(
                {"id": doc["id"]},
                {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat(), "error": None}},
            )
            log.info("Scheduled send OK: %s", doc["id"])
        except Exception as e:
            await db.scheduled_messages.update_one(
                {"id": doc["id"]},
                {"$set": {"status": "failed", "error": str(e)[:500]}},
            )
            log.warning("Scheduled send falhou %s: %s", doc["id"], e)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None


def next_run_iso(server_id: str) -> str | None:
    if _scheduler is None:
        return None
    job = _scheduler.get_job(_job_id(server_id))
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None
