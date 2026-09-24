"""Session handling, CSRF protection, signed short-lived payloads (OAuth state)."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.config import get_settings
from app.db import get_db
from app.models import Session as SessionModel
from app.models import User

SESSION_COOKIE = "zk_session"
STATE_COOKIE = "zk_oauth"
CSRF_HEADER = "X-CSRF-Token"


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_payload(data: dict) -> str:
    """HMAC-signed, timestamped payload (used for the OAuth state cookie)."""
    settings = get_settings()
    body = _b64e(json.dumps({"d": data, "t": int(time.time())}).encode())
    sig = hmac.new(settings.session_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def unsign_payload(token: str, max_age_s: int = 600) -> dict | None:
    settings = get_settings()
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = hmac.new(settings.session_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(time.time()) - payload.get("t", 0) > max_age_s:
        return None
    return payload.get("d")


def create_session(db: DbSession, user: User) -> SessionModel:
    settings = get_settings()
    session = SessionModel(
        token=secrets.token_urlsafe(32),
        csrf_token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    db.commit()
    return session


def set_session_cookie(response: Response, session: SessionModel) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        session.token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.is_prod,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def session_expired(session: SessionModel) -> bool:
    """Shared by the cookie path and the native handoff, so the two can never
    disagree about what counts as a live session."""
    expires = session.expires_at
    if expires.tzinfo is None:  # SQLite returns naive datetimes
        expires = expires.replace(tzinfo=timezone.utc)
    return expires < datetime.now(timezone.utc)


def _load_session(request: Request, db: DbSession) -> SessionModel | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.execute(select(SessionModel).where(SessionModel.token == token)).scalar_one_or_none()
    if session is None:
        return None
    if session_expired(session):
        db.delete(session)
        db.commit()
        return None
    return session


def get_current_session(request: Request, db: DbSession = Depends(get_db)) -> SessionModel:
    session = _load_session(request, db)
    if session is None:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Nicht angemeldet."})
    return session


def get_current_user(session: SessionModel = Depends(get_current_session), db: DbSession = Depends(get_db)) -> User:
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Nicht angemeldet."})
    return user


def require_csrf(request: Request, session: SessionModel = Depends(get_current_session)) -> None:
    """CSRF double-submit check for state-changing requests."""
    header = request.headers.get(CSRF_HEADER, "")
    if not header or not hmac.compare_digest(header, session.csrf_token):
        raise HTTPException(status_code=403, detail={"code": "csrf_invalid", "message": "Ungültiges CSRF-Token."})


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Admin gate — 404 (not 403) so the endpoint's existence isn't leaked."""
    if user.email.lower() not in get_settings().admin_emails:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Nicht gefunden."})
    return user
