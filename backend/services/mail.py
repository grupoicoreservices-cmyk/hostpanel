"""IMAP/SMTP service for Voxyra Mail webmail.

- IMAP: imaplib (stdlib), reads folder list and messages.
- SMTP: smtplib (stdlib), sends messages with attachments.

Connection settings are derived from the DirectAdmin server hostname associated
with the email account's domain, using standard secure ports.
"""
from __future__ import annotations

import imaplib
import smtplib
import email
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders, utils, policy
from email.header import decode_header, make_header
from typing import Optional, Tuple
from datetime import datetime, timezone


FOLDER_MAP = {
    "INBOX": "Entrada",
    "Sent": "Enviados",
    "Drafts": "Rascunhos",
    "Trash": "Lixeira",
    "Junk": "Spam",
    "Spam": "Spam",
    "Archive": "Arquivo",
}

# Nomes possíveis para a pasta de spam em servidores IMAP diferentes.
SPAM_FOLDER_CANDIDATES = ("Junk", "Spam", "INBOX.Junk", "INBOX.Spam", "INBOX/Junk", "INBOX/Spam")


def _parse_spam_headers(msg) -> dict:
    """Extrai informação de SpamAssassin dos cabeçalhos padrão."""
    flag = str(msg.get("X-Spam-Flag", "")).strip().upper() == "YES"
    score_raw = msg.get("X-Spam-Score") or msg.get("X-Spam-Level") or ""
    score = None
    try:
        score = float(str(score_raw).strip().split()[0])
    except (ValueError, IndexError, TypeError):
        # X-Spam-Level costuma ser "*****" — conta os *
        s = str(score_raw)
        if s and all(c == "*" for c in s):
            score = float(len(s))
    status = str(msg.get("X-Spam-Status", "") or "").strip()
    return {
        "flag": flag,
        "score": score,
        "status": status[:200] if status else None,
    }


def _decode(value) -> str:
    if value is None:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return str(value)


def _parse_addr(header_value: str) -> Tuple[str, str]:
    if not header_value:
        return ("", "")
    name, addr = utils.parseaddr(header_value)
    return (_decode(name), addr)


class MailError(Exception):
    pass


class MailClient:
    def __init__(self, host: str, email_addr: str, password: str,
                 imap_port: int = 993, smtp_port: int = 587, use_ssl: bool = True):
        self.host = host
        self.email = email_addr
        self.password = password
        self.imap_port = imap_port
        self.smtp_port = smtp_port
        self.use_ssl = use_ssl

    # ---------- IMAP ----------
    def _imap(self) -> imaplib.IMAP4:
        try:
            if self.use_ssl:
                m = imaplib.IMAP4_SSL(self.host, self.imap_port)
            else:
                m = imaplib.IMAP4(self.host, self.imap_port)
            m.login(self.email, self.password)
            return m
        except Exception as e:
            raise MailError(f"IMAP: {e}") from e

    def list_folders(self) -> list[dict]:
        m = self._imap()
        try:
            typ, data = m.list()
            folders = []
            if typ == "OK":
                for raw in data:
                    if not raw:
                        continue
                    parts = raw.decode(errors="ignore").split(' "/" ')
                    name = parts[-1].strip().strip('"')
                    display = FOLDER_MAP.get(name, name)
                    folders.append({"name": name, "display_name": display})
            return folders
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def list_messages(self, folder: str = "INBOX", limit: int = 50, search: str | None = None) -> list[dict]:
        m = self._imap()
        try:
            m.select(folder, readonly=True)
            criteria = "ALL"
            if search:
                # naive text search across subject / from / body
                safe = search.replace('"', '')
                criteria = f'(OR OR SUBJECT "{safe}" FROM "{safe}" BODY "{safe}")'
            typ, data = m.search(None, criteria)
            if typ != "OK" or not data or not data[0]:
                return []
            ids = data[0].split()
            ids = ids[-limit:][::-1]
            result = []
            for uid in ids:
                typ, msg_data = m.fetch(uid, "(RFC822.HEADER FLAGS)")
                if typ != "OK":
                    continue
                flags = []
                header_bytes = b""
                for part in msg_data:
                    if isinstance(part, tuple) and len(part) >= 2:
                        header_bytes = part[1]
                    if isinstance(part, bytes):
                        s = part.decode(errors="ignore")
                        if "FLAGS" in s:
                            flags = s
                msg = email.message_from_bytes(header_bytes, policy=policy.default)
                name, addr = _parse_addr(msg.get("From", ""))
                subject = _decode(msg.get("Subject", "(sem assunto)"))
                unread = "\\Seen" not in str(flags)
                starred = "\\Flagged" in str(flags)
                spam_info = _parse_spam_headers(msg)
                result.append({
                    "uid": uid.decode(),
                    "subject": subject or "(sem assunto)",
                    "from_addr": addr,
                    "from_name": name or addr,
                    "to": [msg.get("To", "")],
                    "date": msg.get("Date", ""),
                    "preview": "",
                    "unread": unread,
                    "starred": starred,
                    "has_attachment": False,
                    "folder": folder,
                    "spam_flag": spam_info["flag"],
                    "spam_score": spam_info["score"],
                    "spam_status": spam_info["status"],
                })
            return result
        except Exception as e:
            raise MailError(f"IMAP list: {e}") from e
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def get_message(self, uid: str, folder: str = "INBOX") -> dict:
        m = self._imap()
        try:
            m.select(folder)
            typ, data = m.fetch(uid.encode() if isinstance(uid, str) else uid, "(RFC822)")
            if typ != "OK" or not data or not data[0]:
                raise MailError("Mensagem não encontrada")
            raw = data[0][1]
            msg = email.message_from_bytes(raw, policy=policy.default)
            name, addr = _parse_addr(msg.get("From", ""))
            body_text, body_html = "", ""
            attachments = []
            if msg.is_multipart():
                for part in msg.walk():
                    ctype = part.get_content_type()
                    disp = part.get("Content-Disposition", "") or ""
                    if "attachment" in disp:
                        attachments.append({
                            "filename": _decode(part.get_filename() or "arquivo"),
                            "content_type": ctype,
                            "size": len(part.get_payload(decode=True) or b""),
                        })
                    elif ctype == "text/plain" and "attachment" not in disp:
                        body_text += part.get_content()
                    elif ctype == "text/html" and "attachment" not in disp:
                        body_html += part.get_content()
            else:
                if msg.get_content_type() == "text/html":
                    body_html = msg.get_content()
                else:
                    body_text = msg.get_content()
            # mark as read
            try:
                m.store(uid.encode() if isinstance(uid, str) else uid, "+FLAGS", "\\Seen")
            except Exception:
                pass
            return {
                "uid": str(uid),
                "subject": _decode(msg.get("Subject", "")),
                "from_addr": addr,
                "from_name": name or addr,
                "to": [msg.get("To", "")],
                "cc": [msg.get("Cc", "")] if msg.get("Cc") else [],
                "date": msg.get("Date", ""),
                "body_html": body_html or None,
                "body_text": body_text or None,
                "attachments": attachments,
                "folder": folder,
                **{f"spam_{k}": v for k, v in _parse_spam_headers(msg).items()},
            }
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def resolve_spam_folder(self) -> str | None:
        """Retorna o nome real da pasta de spam do IMAP (Junk / Spam / INBOX.Spam…)."""
        m = self._imap()
        try:
            typ, data = m.list()
            if typ != "OK" or not data:
                return None
            available = []
            for raw in data:
                if not raw:
                    continue
                parts = raw.decode(errors="ignore").split(' "/" ')
                name = parts[-1].strip().strip('"')
                available.append(name)
            for cand in SPAM_FOLDER_CANDIDATES:
                if cand in available:
                    return cand
            # heurística: qualquer pasta contendo "spam" ou "junk"
            for name in available:
                low = name.lower()
                if "junk" in low or "spam" in low:
                    return name
            return None
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def bulk_move(self, uids: list[str], src_folder: str, dst_folder: str) -> int:
        """Move várias UIDs de src_folder para dst_folder. Retorna quantas foram movidas."""
        if not uids:
            return 0
        m = self._imap()
        moved = 0
        try:
            m.select(src_folder)
            for uid in uids:
                try:
                    m.copy(uid, dst_folder)
                    m.store(uid, "+FLAGS", "\\Deleted")
                    moved += 1
                except Exception:
                    continue
            m.expunge()
            return moved
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def bulk_delete(self, uids: list[str], folder: str) -> int:
        if not uids:
            return 0
        m = self._imap()
        deleted = 0
        try:
            m.select(folder)
            for uid in uids:
                try:
                    m.store(uid, "+FLAGS", "\\Deleted")
                    deleted += 1
                except Exception:
                    continue
            m.expunge()
            return deleted
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def folder_count(self, folder: str) -> int:
        m = self._imap()
        try:
            typ, data = m.select(folder, readonly=True)
            if typ != "OK":
                return 0
            try:
                return int(data[0])
            except (TypeError, ValueError):
                return 0
        except Exception:
            return 0
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def move_message(self, uid: str, src_folder: str, dst_folder: str) -> None:
        m = self._imap()
        try:
            m.select(src_folder)
            m.copy(uid, dst_folder)
            m.store(uid, "+FLAGS", "\\Deleted")
            m.expunge()
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def delete_message(self, uid: str, folder: str = "INBOX") -> None:
        m = self._imap()
        try:
            m.select(folder)
            m.store(uid, "+FLAGS", "\\Deleted")
            m.expunge()
        finally:
            try:
                m.logout()
            except Exception:
                pass

    def mark_flag(self, uid: str, folder: str, flag: str, add: bool = True) -> None:
        m = self._imap()
        try:
            m.select(folder)
            m.store(uid, "+FLAGS" if add else "-FLAGS", flag)
        finally:
            try:
                m.logout()
            except Exception:
                pass

    # ---------- SMTP ----------
    def send(self, to: list[str], subject: str, body_html: str | None = None, body_text: str | None = None,
             cc: list[str] | None = None, bcc: list[str] | None = None, attachments: list[dict] | None = None) -> None:
        msg = MIMEMultipart("alternative")
        msg["From"] = self.email
        msg["To"] = ", ".join(to)
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg["Subject"] = subject
        msg["Date"] = utils.formatdate(localtime=True)
        msg["Message-ID"] = utils.make_msgid()

        if body_text:
            msg.attach(MIMEText(body_text, "plain", "utf-8"))
        if body_html:
            msg.attach(MIMEText(body_html, "html", "utf-8"))

        if attachments:
            for att in attachments:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(att.get("content", b""))
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", f'attachment; filename="{att.get("filename", "file")}"')
                msg.attach(part)

        recipients = list(to) + list(cc or []) + list(bcc or [])
        try:
            if self.use_ssl and self.smtp_port == 465:
                s = smtplib.SMTP_SSL(self.host, self.smtp_port, timeout=20)
            else:
                s = smtplib.SMTP(self.host, self.smtp_port, timeout=20)
                s.starttls()
            s.login(self.email, self.password)
            s.sendmail(self.email, recipients, msg.as_string())
            s.quit()
        except Exception as e:
            raise MailError(f"SMTP: {e}") from e
