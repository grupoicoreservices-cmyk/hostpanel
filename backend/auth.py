"""JWT-based authentication for Voxyra Mail SaaS."""
import os
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr

from database import get_db
from models import UserRole, now_iso, new_id

JWT_ALG = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=8 * 3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax", max_age=7 * 24 * 3600, path="/")


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    user.pop("_id", None)
    user.pop("password_hash", None)
    return user


def require_role(*allowed_roles: UserRole):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail="Acesso negado para este perfil")
        return user
    return _dep


require_superadmin = require_role("superadmin")
require_admin = require_role("superadmin", "empresa_admin")


# ---------- Brute force ----------
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


async def _check_lockout(identifier: str) -> None:
    db = get_db()
    doc = await db.login_attempts.find_one({"identifier": identifier})
    if not doc:
        return
    if doc.get("attempts", 0) >= MAX_ATTEMPTS:
        locked_at = doc.get("last_at")
        if locked_at:
            locked_dt = datetime.fromisoformat(locked_at)
            if datetime.now(timezone.utc) < locked_dt + timedelta(minutes=LOCKOUT_MINUTES):
                raise HTTPException(status_code=429, detail="Muitas tentativas. Tente novamente em alguns minutos.")
            await db.login_attempts.delete_one({"identifier": identifier})


async def _record_failed(identifier: str) -> None:
    db = get_db()
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"attempts": 1}, "$set": {"last_at": now_iso()}},
        upsert=True,
    )
    await db.login_logs.insert_one({
        "id": new_id(),
        "identifier": identifier,
        "success": False,
        "timestamp": now_iso(),
    })


async def _record_success(identifier: str, user_id: str) -> None:
    db = get_db()
    await db.login_attempts.delete_one({"identifier": identifier})
    await db.login_logs.insert_one({
        "id": new_id(),
        "identifier": identifier,
        "user_id": user_id,
        "success": True,
        "timestamp": now_iso(),
    })


# ---------- Router ----------
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class RegisterPayload(BaseModel):
    email: EmailStr
    password: str
    name: str
    empresa_id: str | None = None


@router.post("/login")
async def login(payload: LoginPayload, request: Request, response: Response):
    db = get_db()
    email = payload.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"

    await _check_lockout(identifier)

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await _record_failed(identifier)
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Usuário desativado")

    await _record_success(identifier, user["id"])

    access = create_access_token(user["id"], user["email"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)

    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"user": user, "access_token": access}


@router.post("/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    tok = request.cookies.get("refresh_token")
    if not tok:
        raise HTTPException(status_code=401, detail="Sem refresh token")
    try:
        payload = jwt.decode(tok, _secret(), algorithms=[JWT_ALG])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Token inválido")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")

    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    access = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=8 * 3600, path="/")
    return {"ok": True}


async def seed_superadmin() -> None:
    db = get_db()
    email = os.environ.get("ADMIN_EMAIL", "admin@voxyra.com").lower()
    password = os.environ.get("ADMIN_PASSWORD", "Voxyra@2026")
    existing = await db.users.find_one({"email": email})
    if existing is None:
        await db.users.insert_one({
            "id": new_id(),
            "email": email,
            "password_hash": hash_password(password),
            "name": "Super Admin",
            "role": "superadmin",
            "empresa_id": None,
            "is_active": True,
            "created_at": now_iso(),
        })
    elif not verify_password(password, existing.get("password_hash", "")):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password)}})
