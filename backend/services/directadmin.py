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


_SIZE_UNITS = {"b": 1, "kb": 1024, "mb": 1024 ** 2, "gb": 1024 ** 3}


def _parse_size(txt: str) -> int:
    """Converte '63.04 KB', '2 MB', '512 B' em bytes (int).

    Retorna 0 se não conseguir parsear. Aceita separador de milhar `.`
    ou `,` e mesmo formato sem unidade (assume bytes).
    """
    if not txt:
        return 0
    s = txt.strip().lower().replace(",", ".")
    # extrai número + unidade
    import re as _re
    m = _re.match(r"^([\d\.]+)\s*(kb|mb|gb|b)?$", s)
    if not m:
        return 0
    try:
        val = float(m.group(1))
    except ValueError:
        return 0
    unit = (m.group(2) or "b").lower()
    return int(val * _SIZE_UNITS.get(unit, 1))


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

    # ---------- Catch-all ----------
    def get_catch_all(self, domain: str) -> dict:
        """Retorna a config atual do catch-all do domínio.

        DirectAdmin `CMD_API_EMAIL_CATCH_ALL?domain=X` devolve algo tipo
        `value=user@domain.com` ou `value=:blackhole:` ou `value=:fail:` (ou vazio).
        Normaliza para `{"mode": "address"|"blackhole"|"fail"|"unset", "value": "…"}`.
        """
        try:
            data = self._request("CMD_API_EMAIL_CATCH_ALL", {"domain": domain})
        except DirectAdminError:
            return {"mode": "unset", "value": ""}

        # Pode vir como dict {value: "..."} ou string "value=..."
        raw = ""
        if isinstance(data, dict):
            raw = data.get("value", "") or data.get("catch", "") or ""
        elif isinstance(data, str):
            raw = data.strip()

        if not raw:
            return {"mode": "unset", "value": ""}
        low = raw.lower()
        if low.startswith(":blackhole"):
            return {"mode": "blackhole", "value": ""}
        if low.startswith(":fail"):
            return {"mode": "fail", "value": ""}
        return {"mode": "address", "value": raw}

    def set_catch_all(self, domain: str, mode: str, address: str | None = None) -> dict:
        """Define o catch-all do domínio.

        `mode`:
          - `address`  → encaminha para `address` (e-mail válido)
          - `blackhole`→ descarta silenciosamente
          - `fail`     → rejeita (bounce)
          - `unset`    → remove catch-all (fica no comportamento default do DA)
        """
        mode = (mode or "").strip().lower()
        if mode == "address":
            addr = (address or "").strip()
            if "@" not in addr:
                raise DirectAdminError("Endereço de catch-all inválido")
            value = addr
        elif mode == "blackhole":
            value = ":blackhole:"
        elif mode == "fail":
            value = ":fail:"
        elif mode == "unset":
            value = ""
        else:
            raise DirectAdminError(f"Modo de catch-all inválido: {mode!r}")

        params = {
            "action": "modify" if value else "clear",
            "domain": domain,
            "value": value,
        }
        return self._request("CMD_API_EMAIL_CATCH_ALL", params, method="POST")

    # ---------- Email logs / tracking ----------
    def get_email_logs(
        self,
        domain: str,
        *,
        date_from: str | None = None,   # "YYYY-MM-DD HH:MM" ou "YYYY-MM-DD"
        date_to: str | None = None,
        address: str | None = None,
        state: str | None = None,       # "delivered" | "bounced" | "deferred" | ...
        direction: str | None = None,   # "in" | "out" | ""
        limit: int = 500,
    ) -> list[dict]:
        """Faz scraping do `CMD_EMAIL_LOGS` (a tela web do DA) para retornar
        um histórico paginado de entrega de e-mails do domínio.

        DirectAdmin não expõe `CMD_API_EMAIL_LOGS` na maioria das versões, mas
        a tela HTML é autenticada com o mesmo token do painel, então usamos ela
        via `requests` + BeautifulSoup para extrair a tabela.

        Retorna lista de dicts: {direction, state, from, to, subject, size, date}
        onde `size` está em bytes (int) e `date` é ISO-8601 UTC quando possível.
        """
        import requests as _req
        from bs4 import BeautifulSoup

        params = {"domain": domain}
        if date_from: params["period_start"] = date_from
        if date_to: params["period_end"] = date_to
        if address: params["address"] = address
        if state: params["state"] = state
        if direction: params["direction"] = direction

        url = f"{self.base}/CMD_EMAIL_LOGS"
        try:
            r = _req.get(
                url, params=params,
                auth=(self.user, self.token),
                timeout=self.timeout, verify=self.verify_ssl,
            )
        except _req.RequestException as e:
            raise DirectAdminError(f"Falha ao consultar CMD_EMAIL_LOGS: {e}") from e
        if r.status_code >= 400:
            raise DirectAdminError(f"HTTP {r.status_code} ao consultar logs")

        soup = BeautifulSoup(r.text, "lxml")

        # DirectAdmin renderiza a tabela de logs dentro de um <table> com colunas
        # em ordem: Direção, Estado, De, Para, Assunto, Tamanho, Data.
        # Alguns temas do DA usam `<table class="list">` ou `#emailLogTable` — para
        # ser robusto, iteramos por TODAS as tabelas e escolhemos aquela cujo header
        # contém "De" e "Para" e "Assunto".
        target = None
        for tbl in soup.find_all("table"):
            headers = [th.get_text(strip=True).lower() for th in tbl.find_all("th")]
            if not headers:
                # tenta a 1ª linha como header
                first_row = tbl.find("tr")
                if first_row:
                    headers = [td.get_text(strip=True).lower() for td in first_row.find_all(["td", "th"])]
            joined = " ".join(headers)
            # Match tanto pt quanto en
            if ("de" in headers and "para" in headers) or ("from" in headers and "to" in headers) \
                    or ("assunto" in joined) or ("subject" in joined):
                target = tbl
                break

        if not target:
            return []

        rows_out: list[dict] = []
        rows = target.find_all("tr")
        # detecta header index dinamicamente
        header_cells = rows[0].find_all(["th", "td"])
        headers = [c.get_text(strip=True).lower() for c in header_cells]

        def _idx(*names):
            for n in names:
                if n in headers:
                    return headers.index(n)
            return -1

        i_dir = _idx("direção", "direcao", "direction")
        i_state = _idx("estado", "state", "status")
        i_from = _idx("de", "from")
        i_to = _idx("para", "to")
        i_subj = _idx("assunto", "subject")
        i_size = _idx("tamanho", "size")
        i_date = _idx("data", "date")

        for tr in rows[1:limit + 1]:
            cells = tr.find_all(["td"])
            if not cells:
                continue
            def _get(i):
                return cells[i].get_text(" ", strip=True) if 0 <= i < len(cells) else ""
            size_txt = _get(i_size)
            size_bytes = _parse_size(size_txt)
            rows_out.append({
                "direction": _get(i_dir).lower() or "out",
                "state": _get(i_state).lower() or "unknown",
                "from": _get(i_from),
                "to": _get(i_to),
                "subject": _get(i_subj),
                "size": size_bytes,
                "size_text": size_txt,
                "date": _get(i_date),
            })
        return rows_out

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
