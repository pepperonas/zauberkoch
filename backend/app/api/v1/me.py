"""Current-user endpoints — profile, preferences, data export, account deletion."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.orm import Session as DbSession

from pydantic import BaseModel, ValidationError

from fastapi import Request

from app.core.security import (
    _load_session,
    clear_session_cookie,
    get_current_user,
    require_csrf,
)
from app.db import get_db
from app.models import (
    AllowlistEntry,
    Favorite,
    Generation,
    MealPlanEntry,
    RateLimit,
    Recipe,
    ShoppingListItem,
    User,
)
from app.schemas.recipe import Preferences
from app.services import ai, byok
from app.services.passwords import verify_password

router = APIRouter(prefix="/me")


@router.get("")
def me(request: Request, db: DbSession = Depends(get_db)) -> dict:
    """200 for everyone: {"authenticated": false} when logged out — a 401
    here would log a console error on every anonymous page view."""
    session = _load_session(request, db)
    user = db.get(User, session.user_id) if session else None
    if session is None or user is None:
        return {"authenticated": False}
    from app.core.config import get_settings

    return {
        "authenticated": True,
        "is_admin": user.email.lower() in get_settings().admin_emails,
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture_url": user.picture_url,
        "adult_confirmed": user.adult_confirmed_at is not None,
        # Drives the delete-account dialog: only a password account can be asked
        # to re-authenticate.
        "has_password": user.password_hash is not None,
        # Own Anthropic key: active + last 4 chars, never the key itself.
        "own_key": byok.status_for(user),
        "csrf_token": session.csrf_token,
        "preferences": load_preferences(user).model_dump(),
    }


@router.post("/confirm-adult", dependencies=[Depends(require_csrf)])
def confirm_adult(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    if user.adult_confirmed_at is None:
        user.adult_confirmed_at = datetime.now(timezone.utc)
        db.commit()
    return {"adult_confirmed": True}


def load_preferences(user: User) -> Preferences:
    try:
        return Preferences.model_validate_json(user.preferences_json or "{}")
    except ValidationError:
        return Preferences()


@router.put("/preferences", dependencies=[Depends(require_csrf)])
def put_preferences(
    prefs: Preferences,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    user.preferences_json = prefs.model_dump_json()
    db.commit()
    return {"preferences": prefs.model_dump()}


class AnthropicKeyBody(BaseModel):
    key: str


@router.put("/anthropic-key", dependencies=[Depends(require_csrf)])
async def set_anthropic_key(
    body: AnthropicKeyBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Store an own Anthropic key (BYOK) — encrypted, after proving it works.

    Validation is a `models.list()` call on the user's key: authenticated, but
    free of tokens, so checking costs its owner nothing. Rejecting a broken key
    here is what keeps the failure out of the middle of a generation.
    """
    key = body.key.strip()
    if not byok.looks_like_key(key):
        raise HTTPException(
            status_code=422,
            detail="Das sieht nicht nach einem Anthropic-Schlüssel aus (beginnt mit „sk-ant-“).",
        )
    if not await ai.verify_key(key):
        raise HTTPException(
            status_code=422,
            detail="Anthropic akzeptiert diesen Schlüssel nicht. Bitte prüfe ihn in der Console.",
        )
    byok.store_key(user, key, datetime.now(timezone.utc))
    db.commit()
    return byok.status_for(user)


@router.delete("/anthropic-key", dependencies=[Depends(require_csrf)])
def delete_anthropic_key(
    user: User = Depends(get_current_user), db: DbSession = Depends(get_db)
) -> dict:
    byok.clear_key(user)
    db.commit()
    return byok.status_for(user)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _loads(raw: str | None) -> object:
    """Stored JSON columns become real objects in the export — a wall of
    escaped strings would satisfy Art. 15 on paper and nobody in practice."""
    try:
        return json.loads(raw or "null")
    except ValueError:
        return raw


@router.get("/export")
def export_data(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> Response:
    """Everything this account holds, as one downloadable JSON file (Art. 15/20).

    Includes soft-deleted recipes, flagged as such: they are still stored, so
    withholding them here would make the export a half-truth.
    """
    fav_ids = {
        r for (r,) in db.execute(select(Favorite.recipe_id).where(Favorite.user_id == user.id))
    }
    plan_rows = db.execute(
        select(MealPlanEntry).where(MealPlanEntry.user_id == user.id).order_by(MealPlanEntry.datum)
    ).scalars().all()
    recipes = db.execute(
        select(Recipe).where(Recipe.user_id == user.id).order_by(Recipe.created_at)
    ).scalars().all()
    shopping = db.execute(
        select(ShoppingListItem)
        .where(ShoppingListItem.user_id == user.id)
        .order_by(ShoppingListItem.position)
    ).scalars().all()
    usage = db.execute(
        select(Generation).where(Generation.user_id == user.id).order_by(Generation.created_at)
    ).scalars().all()

    key_status = byok.status_for(user)
    methoden = []
    if user.google_sub:
        methoden.append("google")
    if user.password_hash:
        methoden.append("passwort")

    payload = {
        "export_version": 1,
        "erstellt_am": datetime.now(timezone.utc).isoformat(),
        "hinweis": (
            "Vollständiger Export deines Zauberkoch-Kontos (DSGVO Art. 15/20). "
            "Passwörter sind nicht enthalten — sie liegen nur als nicht "
            "umkehrbarer Hash vor."
        ),
        "konto": {
            "email": user.email,
            "name": user.name,
            "angelegt_am": _iso(user.created_at),
            "anmeldung": methoden,
            "email_bestaetigt_am": _iso(user.email_verified_at),
            "volljaehrigkeit_bestaetigt_am": _iso(user.adult_confirmed_at),
            "tageslimit": user.daily_limit,
            # Deliberately the status, never the key: an export file is copied
            # around and mailed — a live API credential has no business in it.
            "eigener_api_key": {
                "aktiv": key_status["active"],
                "endet_auf": key_status["hint"],
                "hinterlegt_am": key_status["since"],
            },
        },
        "einstellungen": load_preferences(user).model_dump(),
        "rezepte": [
            {
                "id": r.id,
                "titel": r.titel,
                "modus": r.mode,
                "kueche": r.kueche,
                "gericht_typ": r.gericht_typ,
                "erstellt_am": _iso(r.created_at),
                "favorit": r.id in fav_ids,
                "notiz": r.notiz,
                "gekocht_count": r.gekocht_count,
                "bewertung": r.feedback,
                "bewertung_grund": r.feedback_grund,
                "geteilt": bool(r.share_token),
                "in_galerie": r.public_listed,
                "geloescht_am": _iso(r.deleted_at),
                "parameter": _loads(r.params_json),
                "rezept": _loads(r.recipe_json),
            }
            for r in recipes
        ],
        "einkaufsliste": [
            {
                "name": i.name,
                "menge": i.menge,
                "einheit": i.einheit,
                "erledigt": i.checked,
                "rezept_id": i.recipe_id,
                "erstellt_am": _iso(i.created_at),
            }
            for i in shopping
        ],
        "wochenplan": [
            {"datum": p.datum, "rezept_id": p.recipe_id, "erstellt_am": _iso(p.created_at)}
            for p in plan_rows
        ],
        "nutzung": [
            {
                "zeitpunkt": _iso(g.created_at),
                "modus": g.mode,
                "status": g.status,
                "aus_cache": g.cached,
                "dauer_ms": g.duration_ms,
                "modell": g.model,
            }
            for g in usage
        ],
    }
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="zauberkoch-export-{stamp}.json"'},
    )


class DeleteAccountBody(BaseModel):
    """`confirm` guards against a stray call; `password` re-authenticates
    accounts that have one (Google-only accounts have nothing to re-check)."""

    confirm: bool = False
    password: str | None = None


@router.delete("", dependencies=[Depends(require_csrf)])
def delete_account(
    body: DeleteAccountBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> Response:
    """Delete the account and everything attached to it (Art. 17).

    The FK cascade covers sessions, recipes (and with them favourites, planner
    entries and share links), shopping items and invite codes. Two things carry
    no foreign key and have to go by hand:

      * `rate_limits` rows scoped `user:<id>` — SQLite reuses the highest row
        id, so a leftover counter would otherwise be inherited by the next
        account created.
      * the `allowlist` entry for this address — it exists only to let this
        person in; keeping the address after they left is exactly what Art. 17
        forbids.

    `generations` are detached instead of deleted (see migration
    c3d4e5f6a7b8): the cost history stays, the personal link does not.
    """
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm_required")
    if user.password_hash and not verify_password(body.password or "", user.password_hash):
        raise HTTPException(status_code=403, detail="invalid_credentials")

    db.execute(sa_delete(RateLimit).where(RateLimit.scope == f"user:{user.id}"))
    db.execute(
        sa_delete(AllowlistEntry).where(func.lower(AllowlistEntry.email) == user.email.lower())
    )
    db.delete(user)
    db.commit()

    response = Response(status_code=204)
    clear_session_cookie(response)
    return response
