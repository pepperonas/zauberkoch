"""Admin panel API: usage/cost dashboard + allowlist management.

Gated by require_admin (email in ZK_ADMIN_EMAILS) — 404 for everyone else.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.core.config import get_settings
from app.core.security import require_admin, require_csrf
from app.db import get_db
from app.models import AllowlistEntry, Generation, RateLimit, Recipe, User
from app.services import ratelimit
from app.services.limits import get_limits, update_limits
from app.services.pricing import generation_cost

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


@router.get("/stats")
def stats(
    days: int = Query(default=30, ge=1, le=365),
    db: DbSession = Depends(get_db),
) -> dict:
    settings = get_settings()
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.execute(select(Generation).where(Generation.created_at >= since)).scalars().all()

    live = [r for r in rows if not r.cached]
    tokens_in = sum(r.input_tokens for r in live)
    tokens_out = sum(r.output_tokens for r in live)
    cache_read = sum(r.cache_read_tokens for r in live)
    cache_write = sum(r.cache_write_tokens for r in live)
    # Per row, not from the summed tokens: price depends on the row's model and
    # on the day it ran (Sonnet-5 intro pricing ends 2026-08-31).
    cost = sum(generation_cost(r) for r in live)
    durations = sorted(r.duration_ms for r in live if r.duration_ms)

    users = {u.id: u.email for u in db.execute(select(User)).scalars()}
    per_user_rows = db.execute(
        select(Generation.user_id, func.count())
        .where(Generation.created_at >= since)
        .group_by(Generation.user_id)
        .order_by(func.count().desc())
    ).all()

    # Daily time series for the trend sparklines (bucketed from the rows above,
    # no extra query). Day axis = the last `days` calendar days ending today.
    from collections import defaultdict

    today = datetime.now(timezone.utc).date()
    day_list = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    day_index = {d.isoformat(): i for i, d in enumerate(day_list)}
    gens_by_day = [0] * len(day_list)
    cost_by_day = [0.0] * len(day_list)
    user_series: dict[int, list[int]] = defaultdict(lambda: [0] * len(day_list))
    for r in rows:
        i = day_index.get(r.created_at.date().isoformat())
        if i is None:
            continue
        gens_by_day[i] += 1
        user_series[r.user_id][i] += 1
        cost_by_day[i] += generation_cost(r)
    daily = [
        {"day": d.isoformat(), "gens": gens_by_day[i], "cost_usd": round(cost_by_day[i], 3)}
        for i, d in enumerate(day_list)
    ]

    feedback_rows = db.execute(
        select(Recipe.prompt_version, Recipe.feedback, func.count())
        .where(Recipe.feedback.is_not(None))
        .group_by(Recipe.prompt_version, Recipe.feedback)
    ).all()
    feedback: dict[str, dict[str, int]] = {}
    for version, wert, n in feedback_rows:
        entry = feedback.setdefault(version, {"up": 0, "down": 0})
        entry["up" if wert == 1 else "down"] += n

    return {
        "days": days,
        "generations": {
            "total": len(rows),
            "live": len(live),
            "cached": sum(1 for r in rows if r.cached),
            "errors": sum(1 for r in rows if r.status == "error"),
        },
        "tokens": {"in": tokens_in, "out": tokens_out, "cache_read": cache_read, "cache_write": cache_write},
        "cache_hit_rate": (
            round(100 * sum(1 for r in live if r.cache_read_tokens > 0) / len(live)) if live else 0
        ),
        "cost_usd": round(cost, 2),
        "median_duration_ms": durations[len(durations) // 2] if durations else 0,
        "daily": daily,
        # uid is NULL for generations whose account was deleted — the usage
        # stays in the books, the person does not (see migration c3d4e5f6a7b8).
        "per_user": [
            {
                "email": "gelöschtes Konto" if uid is None else users.get(uid, f"#{uid}"),
                "count": n,
                "series": user_series[uid],
            }
            for uid, n in per_user_rows
        ],
        "feedback": feedback,
        "limits": {
            "per_user": get_limits(db).default_user_limit,
            "global": get_limits(db).global_daily_limit,
        },
    }


@router.get("/allowlist")
def list_allowlist(db: DbSession = Depends(get_db)) -> dict:
    entries = db.execute(select(AllowlistEntry).order_by(AllowlistEntry.email)).scalars().all()
    registered = {u.email for u in db.execute(select(User)).scalars()}
    return {
        "items": [
            {"email": e.email, "registered": e.email in registered, "created_at": e.created_at.isoformat()}
            for e in entries
        ]
    }


class AllowlistBody(BaseModel):
    email: EmailStr


@router.post("/allowlist", dependencies=[Depends(require_csrf)])
def add_allowlist(body: AllowlistBody, db: DbSession = Depends(get_db)) -> dict:
    email = body.email.lower()
    existing = db.execute(select(AllowlistEntry).where(AllowlistEntry.email == email)).scalar_one_or_none()
    if existing is None:
        db.add(AllowlistEntry(email=email))
        db.commit()
    return {"email": email}


@router.delete("/allowlist/{email}", dependencies=[Depends(require_csrf)])
def remove_allowlist(email: str, db: DbSession = Depends(get_db)) -> dict:
    entry = db.execute(select(AllowlistEntry).where(AllowlistEntry.email == email.lower())).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Eintrag nicht gefunden."})
    db.delete(entry)
    db.commit()
    return {"deleted": email.lower()}


# ── Users & per-user daily limits ─────────────────────────────────────────


@router.get("/users")
def list_users(db: DbSession = Depends(get_db)) -> dict:
    """Registered users with their effective daily cap + today's usage."""
    settings = get_settings()
    default = get_limits(db).default_user_limit
    admins = settings.admin_emails
    day = datetime.now(timezone.utc).date().isoformat()
    users = db.execute(select(User).order_by(User.created_at.desc())).scalars().all()

    counts = {
        r.scope: r.count
        for r in db.execute(select(RateLimit).where(RateLimit.day == day, RateLimit.scope.like("user:%"))).scalars()
    }
    return {
        "default_limit": default,
        "items": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "daily_limit": u.daily_limit,  # null = uses default
                "effective_limit": u.daily_limit if u.daily_limit is not None else default,
                "used_today": counts.get(f"user:{u.id}", 0),
                "is_admin": u.email.lower() in admins,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ],
    }


class UserLimitBody(BaseModel):
    daily_limit: int | None = None  # null = reset to the global default


@router.patch("/users/{user_id}", dependencies=[Depends(require_csrf)])
def set_user_limit(user_id: int, body: UserLimitBody, db: DbSession = Depends(get_db)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Nutzer nicht gefunden."})
    if body.daily_limit is not None and not (0 <= body.daily_limit <= 1000):
        raise HTTPException(status_code=422, detail={"code": "invalid", "message": "Limit 0–1000."})
    user.daily_limit = body.daily_limit
    db.commit()
    return {"id": user.id, "daily_limit": user.daily_limit}


# ── System-wide limits (runtime-editable) ─────────────────────────────────


def _limits_payload(db: DbSession) -> dict:
    lim = get_limits(db)
    return {
        "default_user_limit": lim.default_user_limit,
        "global_daily_limit": lim.global_daily_limit,
        "registration_daily_limit": lim.registration_daily_limit,
        "anon_ip_limit": lim.anon_ip_limit,
        "anon_global_limit": lim.anon_global_limit,
        "open_signup": lim.open_signup,
        "share_intro": lim.share_intro,
        "registrations_today": ratelimit.registrations_today(db),
    }


@router.get("/limits")
def get_system_limits(db: DbSession = Depends(get_db)) -> dict:
    return _limits_payload(db)


class LimitsBody(BaseModel):
    default_user_limit: int | None = Field(default=None, ge=0, le=10000)
    global_daily_limit: int | None = Field(default=None, ge=0, le=1000000)
    registration_daily_limit: int | None = Field(default=None, ge=0, le=100000)
    anon_ip_limit: int | None = Field(default=None, ge=0, le=10000)
    anon_global_limit: int | None = Field(default=None, ge=0, le=1000000)
    open_signup: bool | None = None
    # Intro animation on shared-recipe links (public setting, read by /share)
    share_intro: Literal["motif", "crt", "off"] | None = None


@router.patch("/limits", dependencies=[Depends(require_csrf)])
def set_system_limits(body: LimitsBody, db: DbSession = Depends(get_db)) -> dict:
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if changes:
        update_limits(db, changes)
    return _limits_payload(db)
