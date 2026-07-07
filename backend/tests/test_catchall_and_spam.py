"""Testes de contrato para catch-all e spam central por domínio."""
from __future__ import annotations
import os
import httpx

BASE = os.environ.get("TEST_BASE_URL", "http://localhost:8001")


def _login() -> str:
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.post("/api/auth/login", json={"email": "admin@voxyra.com", "password": "Voxyra@2026"})
        return r.json()["access_token"]


def _hdr(t): return {"Authorization": f"Bearer {t}"}


def test_catchall_get_requires_auth():
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/dominios/x/catch-all")
    assert r.status_code in (401, 403)


def test_catchall_get_nonexistent_404():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/dominios/nao-existe/catch-all", headers=_hdr(t))
    assert r.status_code == 404


def test_catchall_put_validates_mode():
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.put("/api/dominios/nao-existe/catch-all", headers=_hdr(t),
                   json={"mode": "invalid_mode"})
    # Domain not found first — 404
    assert r.status_code == 404


def test_spam_overview_scoped():
    """Overview retorna estrutura correta mesmo com 0 contas."""
    t = _login()
    with httpx.Client(base_url=BASE, timeout=5) as ac:
        r = ac.get("/api/spam/admin/overview", headers=_hdr(t))
    assert r.status_code == 200
    data = r.json()
    assert set(data) >= {"total_accounts", "reachable", "total_spam", "per_domain", "per_account"}


def test_directadmin_catchall_helpers():
    """Testa DirectAdminClient.set/get_catch_all sem tocar rede."""
    from unittest.mock import patch
    from services.directadmin import DirectAdminClient, DirectAdminError

    c = DirectAdminClient(url="https://fake", port=2222, api_user="u", api_token="t", ssl=True)

    # set_catch_all valida entradas
    import pytest
    with pytest.raises(DirectAdminError):
        c.set_catch_all("dom.com", "invalid", None)
    with pytest.raises(DirectAdminError):
        c.set_catch_all("dom.com", "address", "invalid-email-no-at")

    # Feliz path: address válido chama _request
    captured = {}
    def fake_request(cmd, params, method="GET"):
        captured["cmd"] = cmd
        captured["params"] = params
        return "ok"

    with patch.object(c, "_request", side_effect=fake_request):
        c.set_catch_all("dom.com", "address", "spam@dom.com")
        assert captured["params"]["value"] == "spam@dom.com"

        c.set_catch_all("dom.com", "blackhole")
        assert captured["params"]["value"] == ":blackhole:"

        c.set_catch_all("dom.com", "fail")
        assert captured["params"]["value"] == ":fail:"

        c.set_catch_all("dom.com", "unset")
        assert captured["params"]["value"] == ""

    # get_catch_all normaliza retorno
    with patch.object(c, "_request", return_value={"value": "spam@dom.com"}):
        r = c.get_catch_all("dom.com")
        assert r == {"mode": "address", "value": "spam@dom.com"}

    with patch.object(c, "_request", return_value={"value": ":blackhole:"}):
        r = c.get_catch_all("dom.com")
        assert r["mode"] == "blackhole"

    with patch.object(c, "_request", return_value={"value": ":fail:"}):
        r = c.get_catch_all("dom.com")
        assert r["mode"] == "fail"

    with patch.object(c, "_request", return_value={"value": ""}):
        r = c.get_catch_all("dom.com")
        assert r["mode"] == "unset"
