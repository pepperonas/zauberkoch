"""Recipe sharing: unlisted public links, adopt-to-own, dynamic OG image,
and the crawler-facing /r/{token} HTML with injected OG meta tags."""

import html
import json
import logging
import re
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.config import get_settings
from app.core.security import get_current_user, require_csrf
from app.db import get_db
from app.models import Recipe, User
from app.services import og_image
from app.services.limits import get_limits
from app.services.ratelimit_ip import check_ip_limit

logger = logging.getLogger("zauberkoch.share")
router = APIRouter()

WEBROOT_INDEX = Path("/var/www/zauberkoch.de/index.html")


def _share_url(token: str) -> str:
    return f"{get_settings().zk_base_url.rstrip('/')}/r/{token}"


def _owned_recipe(recipe_id: int, user: User, db: DbSession) -> Recipe:
    row = db.get(Recipe, recipe_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Rezept nicht gefunden."})
    return row


def _by_token(token: str, db: DbSession) -> Recipe:
    if not token or len(token) > 32:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Link ungültig."})
    # A deleted recipe's share link stops resolving (revoked along with the recipe).
    row = db.execute(
        select(Recipe).where(Recipe.share_token == token, Recipe.deleted_at.is_(None))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Link ungültig oder widerrufen."})
    return row


# ---- owner endpoints --------------------------------------------------------

@router.post("/recipes/{recipe_id}/share", dependencies=[Depends(require_csrf)])
def create_share(recipe_id: int, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    row = _owned_recipe(recipe_id, user, db)
    if row.share_token is None:
        row.share_token = secrets.token_urlsafe(9)  # 12 url-safe chars
        db.commit()
    return {"share_token": row.share_token, "share_url": _share_url(row.share_token)}


class ShareConfig(BaseModel):
    public: bool


@router.patch("/recipes/{recipe_id}/share", dependencies=[Depends(require_csrf)])
def configure_share(
    recipe_id: int,
    body: ShareConfig,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Opt a shared recipe in/out of the public gallery + sitemap."""
    row = _owned_recipe(recipe_id, user, db)
    if row.share_token is None:
        raise HTTPException(status_code=409, detail={"code": "not_shared", "message": "Rezept ist nicht geteilt."})
    row.public_listed = body.public
    db.commit()
    return {"public": row.public_listed}


@router.delete("/recipes/{recipe_id}/share", dependencies=[Depends(require_csrf)])
def revoke_share(recipe_id: int, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    row = _owned_recipe(recipe_id, user, db)
    if row.share_token is not None:
        og_image.evict(row.share_token)
        row.share_token = None
        row.public_listed = False
        db.commit()
    return {"share_token": None}


# ---- public endpoints -------------------------------------------------------

@router.get("/share/discover")
def discover(request: Request, db: DbSession = Depends(get_db)) -> dict:
    """Public gallery of opt-in shared recipes (landing page, no auth)."""
    check_ip_limit(request, scope="share", limit=60, window_s=60)
    return {"items": [_gallery_item(r) for r in _public_recipes(db)]}


@router.get("/share/daily")
def daily(request: Request, db: DbSession = Depends(get_db)) -> dict:
    """Recipe of the day: deterministic date rotation through the gallery —
    zero AI cost, same pick for everyone, changes at midnight."""
    check_ip_limit(request, scope="share", limit=60, window_s=60)
    from datetime import date

    rows = _public_recipes(db, limit=100)
    if not rows:
        return {"item": None}
    return {"item": _gallery_item(rows[date.today().toordinal() % len(rows)])}



@router.get("/share/{token}")
def get_shared(token: str, request: Request, db: DbSession = Depends(get_db)) -> dict:
    check_ip_limit(request, scope="share", limit=60, window_s=60)
    row = _by_token(token, db)
    # `intro` is the admin-configured entrance animation for shared links —
    # public on purpose, the page needs it without being logged in.
    return {
        "mode": row.mode,
        "recipe": json.loads(row.recipe_json),
        "share_token": token,
        "intro": get_limits(db).share_intro,
    }


@router.post("/share/{token}/adopt", dependencies=[Depends(require_csrf)])
def adopt_shared(token: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    source = _by_token(token, db)
    copy = Recipe(
        user_id=user.id,
        mode=source.mode,
        params_json=source.params_json,
        recipe_json=source.recipe_json,
        titel=source.titel,
        kueche=source.kueche,
        prompt_version=source.prompt_version,
        model=source.model,
    )
    db.add(copy)
    db.commit()
    logger.info("recipe adopted src=%s user=%s", source.id, user.id)
    return {"recipe_id": copy.id}


@router.get("/share/{token}/og.png")
def shared_og(token: str, request: Request, db: DbSession = Depends(get_db)) -> FileResponse:
    check_ip_limit(request, scope="share", limit=60, window_s=60)
    row = _by_token(token, db)
    path = og_image.get_or_render(token, json.loads(row.recipe_json), row.mode)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


def _gallery_item(row: Recipe) -> dict:
    recipe = json.loads(row.recipe_json)
    return {
        "token": row.share_token,
        "titel": row.titel,
        "teaser": recipe.get("teaser", ""),
        "kueche": row.kueche,
        "mode": row.mode,
        "glas": recipe.get("glas"),
        "zeit_gesamt": recipe.get("zeit_gesamt"),
        "schwierigkeit": recipe.get("schwierigkeit"),
        "tags": recipe.get("tags", []),
    }


def _public_recipes(db: DbSession, limit: int = 24) -> list[Recipe]:
    return list(
        db.execute(
            select(Recipe)
            .where(
                Recipe.share_token.is_not(None),
                Recipe.public_listed.is_(True),
                Recipe.deleted_at.is_(None),
            )
            .order_by(Recipe.created_at.desc())
            .limit(limit)
        ).scalars()
    )


@router.get("/share/{token}/story.png")
def shared_story(token: str, request: Request, db: DbSession = Depends(get_db)) -> FileResponse:
    """9:16 story image (Insta/WhatsApp-Status) with the recipe motif."""
    check_ip_limit(request, scope="share", limit=60, window_s=60)
    row = _by_token(token, db)
    path = og_image.get_or_render_story(token, json.loads(row.recipe_json), row.mode)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


# ---- crawler-facing HTML (/r/{token}, proxied by nginx, no /api prefix) -----

html_router = APIRouter()

FALLBACK_SHELL = """<!doctype html><html lang="de"><head><meta charset="utf-8"></head>
<body><p>Zauberkoch — <a href="/">zur App</a></p></body></html>"""


# The static index.html carries root-page SEO/OG tags inside this sentinel
# block — it must be stripped here, or crawlers would read the root tags
# (which come first in <head>) instead of the recipe-specific ones.
_ROOT_META_RE = re.compile(r"\s*<!--\s*zk:root-meta:start[^>]*-->.*?<!--\s*zk:root-meta:end\s*-->", re.S)
_TITLE_RE = re.compile(r"<title>.*?</title>", re.S)


def _meta_block(row: Recipe, token: str) -> str:
    settings = get_settings()
    base = settings.zk_base_url.rstrip("/")
    recipe = json.loads(row.recipe_json)
    title = html.escape(f"{recipe.get('titel', 'Rezept')} — Zauberkoch")
    desc = html.escape(recipe.get("teaser", "Ein Rezept vom Zauberkoch."))
    url = f"{base}/r/{token}"
    image = f"{base}/api/v1/share/{token}/og.png"
    return (
        f'<meta name="description" content="{desc}">'
        f'<link rel="canonical" href="{url}">'
        f'<meta property="og:type" content="article">'
        f'<meta property="og:site_name" content="Zauberkoch">'
        f'<meta property="og:locale" content="de_DE">'
        f'<meta property="og:title" content="{title}">'
        f'<meta property="og:description" content="{desc}">'
        f'<meta property="og:url" content="{url}">'
        f'<meta property="og:image" content="{image}">'
        f'<meta property="og:image:width" content="1200">'
        f'<meta property="og:image:height" content="630">'
        f'<meta property="og:image:alt" content="{title}">'
        f'<meta name="twitter:card" content="summary_large_image">'
        f'<meta name="twitter:title" content="{title}">'
        f'<meta name="twitter:description" content="{desc}">'
        f'<meta name="twitter:image" content="{image}">'
    )


def _jsonld(row: Recipe, token: str) -> str:
    """schema.org Recipe JSON-LD for Google Rich Results on shared pages."""
    settings = get_settings()
    base = settings.zk_base_url.rstrip("/")
    r = json.loads(row.recipe_json)

    def amount(z: dict) -> str:
        menge = z.get("menge")
        einheit = z.get("einheit") or ""
        prefix = f"{menge} {einheit}".strip() if menge not in (None, "") else ""
        return f"{prefix} {z.get('name', '')}".strip()

    data: dict = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": r.get("titel", ""),
        "description": r.get("teaser", ""),
        "image": [f"{base}/api/v1/share/{token}/og.png"],
        "inLanguage": "de",
        "author": {"@type": "Organization", "name": "Zauberkoch", "url": base},
        "datePublished": row.created_at.date().isoformat(),
        "recipeCuisine": r.get("kueche", ""),
        "keywords": ", ".join(r.get("tags", [])),
        "recipeYield": f"{r.get('portionen', 1)} {'Drinks' if row.mode == 'cocktail' else 'Portionen'}",
        "prepTime": f"PT{int(r.get('zeit_aktiv') or 0)}M",
        "totalTime": f"PT{int(r.get('zeit_gesamt') or 0)}M",
        "recipeIngredient": [amount(z) for z in r.get("zutaten", [])],
        "recipeInstructions": [
            {"@type": "HowToStep", "name": s_.get("titel", ""), "text": s_.get("text", "")}
            for s_ in r.get("schritte", [])
        ],
    }
    naehrwerte = r.get("naehrwerte") or {}
    if naehrwerte.get("kalorien_kcal") is not None:
        data["nutrition"] = {
            "@type": "NutritionInformation",
            "calories": f"{naehrwerte['kalorien_kcal']} kcal",
            "proteinContent": f"{naehrwerte.get('eiweiss_g', 0)} g",
            "fatContent": f"{naehrwerte.get('fett_g', 0)} g",
            "carbohydrateContent": f"{naehrwerte.get('kohlenhydrate_g', 0)} g",
        }
    # "</" would end the script tag early — escape for safe inline embedding
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{payload}</script>'


@html_router.get("/r/{token}", response_class=HTMLResponse)
def shared_page(token: str, request: Request, db: DbSession = Depends(get_db)) -> HTMLResponse:
    check_ip_limit(request, scope="share", limit=60, window_s=60)
    row = _by_token(token, db)
    shell = WEBROOT_INDEX.read_text(encoding="utf-8") if WEBROOT_INDEX.exists() else FALLBACK_SHELL
    shell = _ROOT_META_RE.sub("", shell)
    page_title = html.escape(f"{json.loads(row.recipe_json).get('titel', 'Rezept')} — Zauberkoch")
    shell = _TITLE_RE.sub(f"<title>{page_title}</title>", shell, count=1)
    page = shell.replace("</head>", f"{_meta_block(row, token)}{_jsonld(row, token)}</head>", 1)
    return HTMLResponse(page, headers={"Cache-Control": "no-cache"})


@html_router.get("/sitemap.xml")
def sitemap(db: DbSession = Depends(get_db)) -> Response:
    """Dynamic sitemap: root + every public gallery recipe (long-tail SEO)."""
    base = get_settings().zk_base_url.rstrip("/")
    urls = [f"<url><loc>{base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>"]
    for row in _public_recipes(db, limit=500):
        urls.append(f"<url><loc>{base}/r/{row.share_token}</loc><changefreq>monthly</changefreq></url>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(urls) + "</urlset>"
    )
    return Response(xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})
