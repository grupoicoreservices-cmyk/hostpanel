"""Public branding endpoints — usados pelo login sem exigir autenticação."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request

from database import get_db


router = APIRouter(prefix="/api/public", tags=["public"])

# Prefixos comuns de subdomínio de e-mail a serem descartados no lookup.
_MAIL_SUBDOMAIN_PREFIXES = ("mail.", "webmail.", "email.", "correio.", "webmailer.")


async def _find_domain_by_name(db, raw: str) -> dict | None:
    """Localiza o domínio no Mongo tentando múltiplas variações do nome recebido.

    Aceita host completos como `mail.empresa.com.br` e retorna o registro de
    `empresa.com.br`. Também tenta ir subindo os labels (`sub.mail.empresa.com.br`
    → `mail.empresa.com.br` → `empresa.com.br`) até achar algo cadastrado.
    """
    if not raw:
        return None
    name = raw.strip().lower()
    tried: set[str] = set()

    # 1) exato
    tried.add(name)
    d = await db.domains.find_one({"nome": name}, {"_id": 0})
    if d:
        return d

    # 2) descarta prefixo comum de subdomínio de e-mail
    for pref in _MAIL_SUBDOMAIN_PREFIXES:
        if name.startswith(pref):
            stripped = name[len(pref):]
            if stripped and stripped not in tried:
                tried.add(stripped)
                d = await db.domains.find_one({"nome": stripped}, {"_id": 0})
                if d:
                    return d

    # 3) sobe labels: a.b.c.d → b.c.d → c.d
    parts = name.split(".")
    while len(parts) > 2:
        parts = parts[1:]
        cand = ".".join(parts)
        if cand in tried:
            continue
        tried.add(cand)
        d = await db.domains.find_one({"nome": cand}, {"_id": 0})
        if d:
            return d
    return None


async def _serialize_branding(db, d: dict) -> dict:
    empresa = None
    if d.get("empresa_id"):
        empresa = await db.empresas.find_one({"id": d["empresa_id"]}, {"_id": 0, "nome": 1})
    return {
        "domain": d["nome"],
        "logo_url": d.get("logo_url") or None,
        "hero_image_url": d.get("hero_image_url") or None,
        "webmail_url": d.get("webmail_url") or None,
        "allow_bypass_login": bool(d.get("allow_bypass_login", False)),
        "empresa": empresa.get("nome") if empresa else None,
    }


@router.get("/domains/{domain_name}/branding")
async def domain_branding(domain_name: str):
    """Lookup por nome/subdomínio (endpoint clássico usado no blur do e-mail)."""
    db = get_db()
    d = await _find_domain_by_name(db, domain_name)
    if not d:
        raise HTTPException(404, "Domínio não hospedado")
    return await _serialize_branding(db, d)


@router.get("/host-branding")
async def host_branding(request: Request):
    """Lookup pelo Host header do request — usado para white-label automático
    quando o cliente aponta o DNS do próprio domínio para o Voxyra Mail.

    Retorna 204 quando não há domínio hospedado que combine com o host,
    para o front simplesmente manter o branding neutro sem erro.
    """
    db = get_db()
    # X-Forwarded-Host tem prioridade (proxy reverso), depois Host padrão
    forwarded = request.headers.get("x-forwarded-host") or ""
    host = (forwarded.split(",")[0] if forwarded else request.headers.get("host") or "").split(":")[0].strip().lower()
    if not host:
        return {"domain": None}
    d = await _find_domain_by_name(db, host)
    if not d:
        return {"domain": None, "host": host}
    payload = await _serialize_branding(db, d)
    payload["host"] = host
    return payload
