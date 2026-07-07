"""Pydantic models used across the Voxyra Mail SaaS backend."""
from datetime import datetime, timezone
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import uuid


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# ---------- Users ----------
UserRole = Literal["superadmin", "empresa_admin", "usuario_final"]


class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: UserRole = "usuario_final"
    empresa_id: Optional[str] = None
    email_account_id: Optional[str] = None  # for usuario_final tied to email account
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserOut(UserBase):
    id: str
    created_at: str


# ---------- Empresas ----------
class EmpresaBase(BaseModel):
    nome: str
    cnpj_cpf: Optional[str] = None
    email_responsavel: Optional[EmailStr] = None
    telefone: Optional[str] = None
    plano: str = "Starter"
    status: Literal["ativo", "inativo"] = "ativo"


class EmpresaCreate(EmpresaBase):
    pass


class EmpresaOut(EmpresaBase):
    id: str
    created_at: str
    dominios_count: int = 0
    contas_count: int = 0


# ---------- DirectAdmin Servers ----------
class DirectAdminServerBase(BaseModel):
    nome: str
    url: str
    port: int = 2222
    api_user: str
    ssl: bool = True


class DirectAdminServerCreate(DirectAdminServerBase):
    api_token: str  # will be encrypted before storage


class DirectAdminServerUpdate(BaseModel):
    nome: Optional[str] = None
    url: Optional[str] = None
    port: Optional[int] = None
    api_user: Optional[str] = None
    api_token: Optional[str] = None
    ssl: Optional[bool] = None


class DirectAdminServerOut(DirectAdminServerBase):
    id: str
    status: Literal["online", "offline", "unknown"] = "unknown"
    last_check: Optional[str] = None
    created_at: str


# ---------- Domains ----------
class DomainBase(BaseModel):
    nome: str
    empresa_id: str
    directadmin_server_id: Optional[str] = None
    # Configuração IMAP/SMTP do domínio (usado por bypass login e webmail)
    imap_host: Optional[str] = None
    imap_port: int = 993
    imap_ssl: bool = True
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_tls: bool = True
    webmail_url: Optional[str] = None
    logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    # Se True, qualquer e-mail deste domínio pode fazer login direto no webmail
    # usando a senha da própria caixa IMAP (sem cadastro manual de usuário).
    allow_bypass_login: bool = False


class DomainCreate(DomainBase):
    pass


class DomainOut(DomainBase):
    id: str
    created_at: str
    contas_count: int = 0


# ---------- Email Accounts ----------
class EmailAccountBase(BaseModel):
    email: EmailStr
    dominio_id: str
    empresa_id: str
    quota_mb: int = 1024
    status: Literal["ativo", "suspenso"] = "ativo"


class EmailAccountCreate(EmailAccountBase):
    password: str


class EmailAccountUpdate(BaseModel):
    quota_mb: Optional[int] = None
    status: Optional[Literal["ativo", "suspenso"]] = None
    password: Optional[str] = None


class EmailAccountOut(EmailAccountBase):
    id: str
    used_mb: float = 0
    created_at: str


# ---------- User Preferences ----------
class UserPreferences(BaseModel):
    theme: Literal["light", "dark"] = "light"
    view_mode: Literal["horizontal", "vertical"] = "horizontal"
    signature: Optional[str] = None
    density: Literal["comfortable", "compact"] = "comfortable"


# ---------- Admin Logs ----------
class AdminLogOut(BaseModel):
    id: str
    actor_id: str
    actor_email: str
    action: str
    target: Optional[str] = None
    details: Optional[dict] = None
    timestamp: str


# ---------- Webmail (IMAP/SMTP) ----------
class MailListItem(BaseModel):
    uid: str
    subject: str
    from_addr: str
    from_name: Optional[str] = None
    to: List[str] = []
    date: str
    preview: str = ""
    unread: bool = False
    starred: bool = False
    has_attachment: bool = False
    folder: str = "INBOX"


class MailContent(BaseModel):
    uid: str
    subject: str
    from_addr: str
    from_name: Optional[str] = None
    to: List[str] = []
    cc: List[str] = []
    date: str
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    attachments: List[dict] = []
    folder: str = "INBOX"


class SendMailPayload(BaseModel):
    to: List[EmailStr]
    cc: List[EmailStr] = []
    bcc: List[EmailStr] = []
    subject: str
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    reply_to_uid: Optional[str] = None


class FolderInfo(BaseModel):
    name: str
    display_name: str
    unread: int = 0
    total: int = 0
