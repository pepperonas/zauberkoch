"""Database models. Every schema change requires an Alembic migration."""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Google account id — NULL for email/password-only users. Unique allows
    # multiple NULLs in SQLite, which is exactly what we want here.
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    picture_url: Mapped[str] = mapped_column(String(1024), default="")
    # Email/password auth (both NULL for Google-only accounts). scrypt hash.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Set once the address is confirmed via double opt-in. A password account
    # stays inactive (login refused) until this is set; Google accounts are
    # created already-verified (Google vouches for the address).
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    adult_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    preferences_json: Mapped[str] = mapped_column(Text, default="{}")
    # Per-user daily generation cap. NULL = fall back to the global default
    # (daily_limit_per_user). New accounts are created with an explicit small value.
    daily_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(16))  # kochen | cocktail
    params_json: Mapped[str] = mapped_column(Text)  # normalized generation params
    recipe_json: Mapped[str] = mapped_column(Text)  # full recipe per schema
    titel: Mapped[str] = mapped_column(String(255), index=True)  # denormalized for search
    kueche: Mapped[str] = mapped_column(String(64), default="", index=True)
    gericht_typ: Mapped[str] = mapped_column(String(64), default="", server_default="", index=True)  # meal type (kochen)
    prompt_version: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    share_token: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    public_listed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")  # opt-in gallery
    feedback: Mapped[int | None] = mapped_column(Integer, nullable=True)  # +1 / -1
    feedback_grund: Mapped[str] = mapped_column(String(255), default="")
    notiz: Mapped[str] = mapped_column(Text, default="", server_default="")  # personal cooking note
    gekocht_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Soft delete: set when the user removes the recipe from their view. The row
    # (and its generation_cache entry) stays so the AI output can still be served
    # from cache for free; every user-facing query filters `deleted_at IS NULL`.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "recipe_id", name="uq_favorite_user_recipe"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    menge: Mapped[float | None] = mapped_column(Float, nullable=True)
    einheit: Mapped[str] = mapped_column(String(32), default="")
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    recipe_id: Mapped[int | None] = mapped_column(ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GenerationCache(Base):
    __tablename__ = "generation_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    params_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    recipe_json: Mapped[str] = mapped_column(Text)
    prompt_version: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Generation(Base):
    """Per-generation usage log: cost tracking, cache-hit rate, error rate."""

    __tablename__ = "generations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # SET NULL, not CASCADE: deleting an account removes the person, not the
    # books. Detached rows keep the cost/usage history intact (no longer
    # personal data — just "a generation happened, it cost this much").
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    mode: Mapped[str] = mapped_column(String(16))
    prompt_version: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    cached: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok | error
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AllowlistEntry(Base):
    __tablename__ = "allowlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Invite(Base):
    """Single-use signup codes — every user can hand out a few."""

    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    used_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MealPlanEntry(Base):
    """Weekly planner: a recipe assigned to a calendar day."""

    __tablename__ = "meal_plan"
    __table_args__ = (UniqueConstraint("user_id", "datum", "recipe_id", name="uq_mealplan_user_day_recipe"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    datum: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RateLimit(Base):
    __tablename__ = "rate_limits"
    __table_args__ = (UniqueConstraint("scope", "day", name="uq_ratelimit_scope_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(64), index=True)  # "user:<id>" | "global" | "registrations"
    day: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD (UTC)
    count: Mapped[int] = mapped_column(Integer, default=0)


class AppSettings(Base):
    """Runtime-editable system limits (singleton row, id=1). When absent the code
    falls back to config defaults — so this row only exists once an admin edits a
    value in the panel. See app/services/limits.py."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # always 1
    default_user_limit: Mapped[int] = mapped_column(Integer)  # per-user daily default (NULL users)
    global_daily_limit: Mapped[int] = mapped_column(Integer)  # total generations/day
    registration_daily_limit: Mapped[int] = mapped_column(Integer)  # new accounts/day
    anon_ip_limit: Mapped[int] = mapped_column(Integer)  # taster generations per IP/day
    anon_global_limit: Mapped[int] = mapped_column(Integer)  # taster generations total/day
    open_signup: Mapped[bool] = mapped_column(Boolean, server_default="1")  # self-service registration
    # Intro animation for shared-recipe links: "motif" | "crt" | "off"
    share_intro: Mapped[str] = mapped_column(String(16), server_default="motif")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
