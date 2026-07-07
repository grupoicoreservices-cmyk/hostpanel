"""Voxyra Mail SaaS backend entry point."""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from database import get_db, close_db
from auth import router as auth_router, seed_superadmin
from routers.saas import router as saas_router
from routers.webmail import router as webmail_router
from routers.monitoring import router as monitoring_router
from routers.antispam import router as antispam_router
from routers.webmail_auth import router as webmail_auth_router
from routers.public import router as public_router
from routers.spam import router as spam_router
from routers.backup import router as backup_router


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("voxyra")


app = FastAPI(title="Voxyra Mail SaaS", version="1.0.0")


# ---------- CORS ----------
origins_env = os.environ.get("CORS_ORIGINS", "*")
if origins_env.strip() == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins_env.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ---------- Health ----------
health_router = APIRouter(prefix="/api")


@health_router.get("/")
async def root():
    return {"service": "voxyra-mail", "status": "ok"}


@health_router.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(saas_router)
app.include_router(webmail_router)
app.include_router(monitoring_router)
app.include_router(antispam_router)
app.include_router(webmail_auth_router)
app.include_router(public_router)
app.include_router(spam_router)
app.include_router(backup_router)


# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    db = get_db()
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("empresa_id")
        await db.empresas.create_index("id", unique=True)
        await db.domains.create_index([("empresa_id", 1), ("nome", 1)])
        await db.email_accounts.create_index([("dominio_id", 1), ("email", 1)])
        await db.email_accounts.create_index("empresa_id")
        await db.directadmin_servers.create_index("id", unique=True)
        await db.login_attempts.create_index("identifier")
        await db.admin_logs.create_index([("timestamp", -1)])
        await db.login_logs.create_index([("timestamp", -1)])
    except Exception as e:
        logger.warning(f"Index setup: {e}")

    try:
        await seed_superadmin()
        logger.info("Superadmin seeded")
    except Exception as e:
        logger.error(f"Seed error: {e}")

    # Indexes para o backup índice
    try:
        await db.backup_servers.create_index("id", unique=True)
        await db.backup_index.create_index("id", unique=True)
        await db.backup_index.create_index([("server_id", 1), ("account_id", 1), ("backed_up_at", -1)])
    except Exception as e:
        logger.warning(f"Backup index setup: {e}")

    # Scheduler de backup
    try:
        from services.backup_scheduler import start_scheduler
        start_scheduler()
    except Exception as e:
        logger.warning(f"Backup scheduler start: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    try:
        from services.backup_scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        pass
    await close_db()
