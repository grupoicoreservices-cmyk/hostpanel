"""DirectAdmin API client service.

Uses the modern JSON=yes query flag on DirectAdmin endpoints.
Docs: https://docs.directadmin.com/directadmin/general-usage/api-all.html
"""
from __future__ import annotations
from typing import Optional
import requests
from urllib.parse import urlencode


class DirectAdminError(Exception):
    pass


class DirectAdminClient:
    def __init__(self, url: str, port: int, api_user: str, api_token: str, ssl: bool = True, timeout: int = 15):
        scheme = "https" if ssl else "http"
        host = url.replace("https://", "").replace("http://", "").rstrip("/")
        self.base = f"{scheme}://{host}:{port}"
        self.user = api_user
        self.token = api_token
        self.timeout = timeout
        self.verify_ssl = ssl

    def _request(self, cmd: str, params: dict | None = None, method: str = "GET") -> dict | list | str:
        params = dict(params or {})
        params["json"] = "yes"
        url = f"{self.base}/{cmd.lstrip('/')}"
        try:
            if method == "GET":
                r = requests.get(url, params=params, auth=(self.user, self.token), timeout=self.timeout, verify=self.verify_ssl)
            else:
                r = requests.post(url, data=params, auth=(self.user, self.token), timeout=self.timeout, verify=self.verify_ssl)
        except requests.RequestException as e:
            raise DirectAdminError(f"Falha de conexão: {e}") from e

        if r.status_code >= 400:
            raise DirectAdminError(f"HTTP {r.status_code}: {r.text[:200]}")

        try:
            return r.json()
        except Exception:
            return r.text

    # ---------- Connectivity ----------
    def check(self) -> bool:
        """Test connectivity. Returns True on success."""
        try:
            self._request("CMD_API_SHOW_USER_CONFIG")
            return True
        except DirectAdminError:
            return False

    # ---------- Domains ----------
    def list_domains(self) -> list[str]:
        data = self._request("CMD_API_SHOW_DOMAINS")
        if isinstance(data, dict):
            return list(data.keys())
        if isinstance(data, list):
            return data
        # legacy string parsing
        return [d for d in str(data).split("&") if d]

    # ---------- E-mail Accounts ----------
    def list_email_accounts(self, domain: str) -> list[dict]:
        data = self._request("CMD_API_POP", {"action": "list", "domain": domain})
        result = []
        if isinstance(data, dict):
            for user, info in data.items():
                if isinstance(info, dict):
                    result.append({"user": user, **info})
                else:
                    result.append({"user": user})
        elif isinstance(data, list):
            result = [{"user": u} for u in data]
        return result

    def create_email(self, domain: str, user: str, password: str, quota_mb: int = 1024) -> dict:
        return self._request(
            "CMD_API_POP",
            {"action": "create", "domain": domain, "user": user, "passwd": password, "passwd2": password, "quota": quota_mb},
            method="POST",
        )

    def delete_email(self, domain: str, user: str) -> dict:
        return self._request(
            "CMD_API_POP",
            {"action": "delete", "domain": domain, "user": user},
            method="POST",
        )

    def change_password(self, domain: str, user: str, password: str) -> dict:
        return self._request(
            "CMD_API_POP",
            {"action": "modify", "domain": domain, "user": user, "passwd": password, "passwd2": password},
            method="POST",
        )

    def change_quota(self, domain: str, user: str, quota_mb: int) -> dict:
        return self._request(
            "CMD_API_POP",
            {"action": "modify", "domain": domain, "user": user, "quota": quota_mb},
            method="POST",
        )

    def suspend(self, domain: str, user: str, suspend: bool = True) -> dict:
        return self._request(
            "CMD_API_POP",
            {"action": "suspend" if suspend else "unsuspend", "domain": domain, "user": user},
            method="POST",
        )

    def get_usage(self, domain: str, user: str) -> Optional[float]:
        try:
            accounts = self.list_email_accounts(domain)
            for a in accounts:
                if a.get("user") == user:
                    used = a.get("usage") or a.get("used") or 0
                    try:
                        return float(used)
                    except (TypeError, ValueError):
                        return 0.0
        except DirectAdminError:
            return None
        return None

    # ---------- Vacation / Autoresponder ----------
    def get_vacation(self, domain: str, user: str) -> Optional[dict]:
        """Retorna configuração de vacation da conta ou None se inativa.

        DirectAdmin `CMD_API_EMAIL_VACATION?domain=X` retorna a lista de usuários
        com vacation ativo em formato `list[]=user1&list[]=user2` ou `key=value`.
        Para ler o conteúdo específico, `CMD_API_EMAIL_VACATION?domain=X&user=Y`.
        """
        try:
            data = self._request(
                "CMD_API_EMAIL_VACATION",
                {"domain": domain, "user": user},
            )
        except DirectAdminError:
            return None
        if not data:
            return None
        # DirectAdmin costuma devolver dict com keys: text, starttime, endtime
        if isinstance(data, dict) and (data.get("text") or data.get("reply")):
            return {
                "active": True,
                "text": data.get("text") or data.get("reply") or "",
                "starttime": data.get("starttime"),
                "endtime": data.get("endtime"),
            }
        return None

    def set_vacation(self, domain: str, user: str, reply: str, start: str, end: str) -> dict:
        return self._request(
            "CMD_API_EMAIL_VACATION",
            {"action": "create", "domain": domain, "user": user, "text": reply,
             "starttime": start, "endtime": end},
            method="POST",
        )

    def clear_vacation(self, domain: str, user: str) -> dict:
        return self._request(
            "CMD_API_EMAIL_VACATION",
            {"action": "delete", "domain": domain, "select0": user},
            method="POST",
        )

    # ---------- Antispam (SpamAssassin per user) ----------
    def get_spam_config(self, domain: str, user: str) -> dict:
        """Retorna a configuração de SpamAssassin para a conta.

        DirectAdmin CMD_API_EMAIL_SPAMASSASSIN action=view retorna campos como
        is_on, high_score, subject_tag, use_bayes, use_razor, etc.
        Devolve um dict normalizado para o Voxyra Mail.
        """
        try:
            data = self._request(
                "CMD_API_EMAIL_SPAMASSASSIN",
                {"action": "view", "domain": domain, "user": user},
            )
        except DirectAdminError:
            return {"enabled": False, "kill_score": None, "subject_tag": None,
                    "use_bayes": False, "use_razor": False, "available": False}

        if not isinstance(data, dict):
            return {"enabled": False, "available": False}

        def _y(k, default=False):
            v = data.get(k, "")
            if isinstance(v, bool):
                return v
            return str(v).lower() in ("yes", "on", "1", "true", "ON")

        def _num(k):
            v = data.get(k, "")
            try:
                return float(v) if v not in ("", None) else None
            except (TypeError, ValueError):
                return None

        return {
            "enabled": _y("is_on"),
            "kill_score": _num("high_score") or _num("kill_score"),
            "subject_tag": data.get("subject_tag") or data.get("rewrite_subject") or "***SPAM***",
            "use_bayes": _y("use_bayes"),
            "use_razor": _y("use_razor"),
            "available": True,
            "raw": data,
        }

    def set_spam_config(self, domain: str, user: str, *, enabled: bool | None = None,
                        kill_score: float | None = None, subject_tag: str | None = None,
                        use_bayes: bool | None = None, use_razor: bool | None = None) -> dict:
        params = {"action": "save", "domain": domain, "user": user}
        if enabled is not None:
            params["is_on"] = "ON" if enabled else "OFF"
        if kill_score is not None:
            params["high_score"] = str(kill_score)
        if subject_tag is not None:
            params["subject_tag"] = subject_tag
        if use_bayes is not None:
            params["use_bayes"] = "ON" if use_bayes else "OFF"
        if use_razor is not None:
            params["use_razor"] = "ON" if use_razor else "OFF"
        return self._request("CMD_API_EMAIL_SPAMASSASSIN", params, method="POST")

    def get_blacklist(self, domain: str, user: str) -> list[str]:
        try:
            data = self._request(
                "CMD_API_EMAIL_SPAMASSASSIN_BLACKLIST",
                {"action": "list", "domain": domain, "user": user},
            )
        except DirectAdminError:
            return []
        if isinstance(data, list):
            return [str(x) for x in data if x]
        if isinstance(data, dict):
            return list(data.values()) if data else []
        return []

    def add_blacklist(self, domain: str, user: str, address: str) -> dict:
        return self._request(
            "CMD_API_EMAIL_SPAMASSASSIN_BLACKLIST",
            {"action": "add", "domain": domain, "user": user, "email": address},
            method="POST",
        )

    def remove_blacklist(self, domain: str, user: str, address: str) -> dict:
        return self._request(
            "CMD_API_EMAIL_SPAMASSASSIN_BLACKLIST",
            {"action": "delete", "domain": domain, "user": user, "select0": address},
            method="POST",
        )

    def get_whitelist(self, domain: str, user: str) -> list[str]:
        try:
            data = self._request(
                "CMD_API_EMAIL_SPAMASSASSIN_WHITELIST",
                {"action": "list", "domain": domain, "user": user},
            )
        except DirectAdminError:
            return []
        if isinstance(data, list):
            return [str(x) for x in data if x]
        if isinstance(data, dict):
            return list(data.values()) if data else []
        return []

    def add_whitelist(self, domain: str, user: str, address: str) -> dict:
        return self._request(
            "CMD_API_EMAIL_SPAMASSASSIN_WHITELIST",
            {"action": "add", "domain": domain, "user": user, "email": address},
            method="POST",
        )

    def remove_whitelist(self, domain: str, user: str, address: str) -> dict:
        return self._request(
            "CMD_API_EMAIL_SPAMASSASSIN_WHITELIST",
            {"action": "delete", "domain": domain, "user": user, "select0": address},
            method="POST",
        )
