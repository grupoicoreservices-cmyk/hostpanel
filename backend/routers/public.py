"""Public branding endpoints — usados pelo login sem exigir autenticação."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException

from database import get_db


router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/domains/{domain_name}/branding")
async def domain_branding(domain_name: str):
    db = get_db()
    domain_name = domain_name.lower().strip()
    d = await db.domains.find_one(
        {"nome": domain_name},
        {"_id": 0, "nome": 1, "logo_url": 1, "hero_image_url": 1, "webmail_url": 1, "allow_bypass_login": 1, "empresa_id": 1},
    )
    if not d:
        raise HTTPException(404, "Domínio não hospedado")

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
