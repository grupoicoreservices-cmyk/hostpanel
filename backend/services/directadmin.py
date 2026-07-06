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
