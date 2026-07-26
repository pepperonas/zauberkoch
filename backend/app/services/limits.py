"""Runtime-editable system limits.

Source of truth: the `app_settings` singleton row (id=1). Until an admin edits a
value in the panel that row doesn't exist, and we fall back to the config
defaults — so config remains the default and the DB row is the override. This
keeps tests that monkeypatch config working, while letting the admin change the
live limits without a redeploy.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session as DbSession

from app.core.config import get_settings
from app.models import AppSettings

SETTINGS_ID = 1

# app_settings column <-> config attribute the column defaults from. Mostly int
# daily caps; `open_signup` (bool) and `share_intro` (str) ride along —
# getattr/setattr are type-agnostic.
_FIELDS: dict[str, str] = {
    "default_user_limit": "daily_limit_per_user",
    "global_daily_limit": "daily_limit_global",
    "registration_daily_limit": "daily_registration_limit",
    "anon_ip_limit": "anon_ip_limit",
    "anon_global_limit": "daily_limit_anon",
    "open_signup": "open_signup",
    "share_intro": "share_intro",
}


@dataclass(frozen=True)
class Limits:
    default_user_limit: int
    global_daily_limit: int
    registration_daily_limit: int
    anon_ip_limit: int
    anon_global_limit: int
    open_signup: bool
    share_intro: str


def _from_config() -> Limits:
    s = get_settings()
    return Limits(**{col: getattr(s, attr) for col, attr in _FIELDS.items()})


def get_limits(db: DbSession) -> Limits:
    """Effective limits: the persisted row if present, else config defaults."""
    row = db.get(AppSettings, SETTINGS_ID)
    if row is None:
        return _from_config()
    return Limits(**{col: getattr(row, col) for col in _FIELDS})


def update_limits(db: DbSession, changes: dict[str, int | bool]) -> Limits:
    """Persist limit overrides (creating the singleton, seeded from config)."""
    row = db.get(AppSettings, SETTINGS_ID)
    if row is None:
        defaults = _from_config()
        row = AppSettings(id=SETTINGS_ID, **{col: getattr(defaults, col) for col in _FIELDS})
        db.add(row)
    for col, value in changes.items():
        if col in _FIELDS:
            setattr(row, col, value)
    db.commit()
    return get_limits(db)
