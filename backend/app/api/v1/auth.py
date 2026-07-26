"""Auth endpoints: Google OAuth, email/password (register/verify/login/
forgot/reset), logout. Email/password auth is layered on top of the existing
session machinery without touching the Google flow."""

import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.config import get_settings
from app.core.security import (
    STATE_COOKIE,
    clear_session_cookie,
    create_session,
    get_current_session,
    require_csrf,
    set_session_cookie,
    sign_payload,
    unsign_payload,
)
from app.db import get_db
from app.models import AllowlistEntry, Session as SessionModel, User
from app.schemas.auth import ForgotBody, LoginBody, PasswordError, RegisterBody, ResetBody, VerifyBody
from app.services import auth_tokens, google_oauth, mailer, ratelimit
from app.services.limits import get_limits
from app.services.passwords import hash_password, verify_password
from app.services.ratelimit_ip import check_ip_limit

logger = logging.getLogger("zauberkoch.auth")
router = APIRouter(prefix="/auth")


def _frontend_url(path: str = "/") -> str:
    return f"{get_settings().zk_base_url.rstrip('/')}{path}"


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _language(request: Request) -> str:
    """Coarse UI language from Accept-Language (data-minimal — no IP)."""
    raw = request.headers.get("accept-language", "")
    return raw.split(",")[0].split(";")[0].strip()[:16]


def _signup_allowed(db: DbSession, email: str) -> bool:
    """Same gate as the Google flow: open by default, allowlist when closed."""
    if get_limits(db).open_signup:
        return True
    return db.execute(select(AllowlistEntry).where(AllowlistEntry.email == email)).scalar_one_or_none() is not None


@router.get("/login")
def login(request: Request) -> Response:
    check_ip_limit(request, scope="auth", limit=20, window_s=60)
    state = secrets.token_urlsafe(24)
    verifier, challenge = google_oauth.make_pkce()
    response = RedirectResponse(google_oauth.build_auth_url(state, challenge), status_code=307)
    response.set_cookie(
        STATE_COOKIE,
        sign_payload({"state": state, "verifier": verifier}),
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=get_settings().is_prod,
        path="/api/v1/auth",
    )
    return response


@router.get("/callback")
def callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    db: DbSession = Depends(get_db),
) -> Response:
    check_ip_limit(request, scope="auth", limit=20, window_s=60)

    def fail(reason: str) -> Response:
        logger.info("oauth callback rejected: %s", reason)
        resp = RedirectResponse(_frontend_url(f"/?login_error={reason}"), status_code=303)
        resp.delete_cookie(STATE_COOKIE, path="/api/v1/auth")
        return resp

    if error or not code or not state:
        return fail("cancelled")

    stashed = unsign_payload(request.cookies.get(STATE_COOKIE, ""))
    if not stashed or stashed.get("state") != state:
        return fail("state_mismatch")

    try:
        tokens = google_oauth.exchange_code(code, stashed["verifier"])
    except Exception:
        logger.exception("token exchange failed")
        return fail("exchange_failed")

    claims = google_oauth.parse_id_token(tokens.get("id_token", ""))
    if claims is None:
        return fail("invalid_token")

    email = claims["email"].lower()
    user = db.execute(select(User).where(User.google_sub == claims["sub"])).scalar_one_or_none()

    if user is None:
        # No Google account yet. If an email/password account already owns this
        # (Google-verified) address, LINK Google to it rather than colliding on
        # the unique email — both sides are verified-email flows (per product
        # decision 2026-07-26). Otherwise it's a genuine new signup.
        existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing is not None:
            existing.google_sub = claims["sub"]
            if existing.email_verified_at is None:
                existing.email_verified_at = datetime.now(timezone.utc)
            user = existing
            logger.info("linked google to existing account user=%s", user.id)
        else:
            # New signup. Open by default; when the admin closes it, the
            # allowlist gates (runtime-editable, config fallback).
            if not _signup_allowed(db, email):
                return fail("not_allowed")
            try:
                ratelimit.consume_registration(db)
            except HTTPException:
                return fail("registration_full")
            # daily_limit stays NULL → account uses the system default limit.
            # Google accounts are created already email-verified.
            user = User(
                google_sub=claims["sub"],
                email=email,
                daily_limit=None,
                email_verified_at=datetime.now(timezone.utc),
            )
            db.add(user)
            db.flush()

    user.email = email
    user.name = claims.get("name", "") or user.name
    user.picture_url = claims.get("picture", "") or user.picture_url
    db.commit()

    session = create_session(db, user)
    response = RedirectResponse(_frontend_url("/"), status_code=303)
    response.delete_cookie(STATE_COOKIE, path="/api/v1/auth")
    set_session_cookie(response, session)
    logger.info("login ok user=%s", user.id)
    return response


@router.get("/dev-login")
def dev_login(request: Request, db: DbSession = Depends(get_db)) -> Response:
    """Local development only: instant login without a Google client.
    Hard-refused unless ZK_DEV_LOGIN=true AND not running in prod."""
    settings = get_settings()
    if settings.is_prod or not settings.zk_dev_login:
        return Response(status_code=404)
    check_ip_limit(request, scope="auth", limit=20, window_s=60)
    email = "dev@zauberkoch.local"
    user = db.execute(select(User).where(User.google_sub == "dev-local")).scalar_one_or_none()
    if user is None:
        user = User(google_sub="dev-local", email=email, name="Dev-Koch")
        db.add(user)
        db.commit()
    session = create_session(db, user)
    response = RedirectResponse(_frontend_url("/"), status_code=303)
    set_session_cookie(response, session)
    logger.warning("DEV LOGIN used (ZK_DEV_LOGIN=true)")
    return response


# ─────────────────────────── email / password ───────────────────────────

# Generic response for register/forgot — identical whether or not the address
# exists, so an attacker can't enumerate accounts.
_GENERIC_EMAIL_SENT = {"ok": True, "message": "Wenn die Angaben stimmen, ist eine E-Mail unterwegs."}


def _notify_admin(background: BackgroundTasks, *, email: str, name: str, method: str, language: str) -> None:
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    background.add_task(
        mailer.send_admin_signup_notification,
        get_settings().admin_notify_email,
        email=email, name=name, method=method, language=language, when=when,
    )


@router.post("/register")
def register(
    body: RegisterBody,
    request: Request,
    background: BackgroundTasks,
    db: DbSession = Depends(get_db),
) -> dict:
    """Start an email/password registration (double opt-in). Enumeration-safe:
    always returns the same generic response. A confirmation mail is only sent
    when a new (or still-unverified) account results."""
    check_ip_limit(request, scope="register", limit=10, window_s=3600)
    try:
        body.check()  # password match + strength
    except PasswordError as e:
        raise _err(400, "weak_password", str(e)) from e

    email = body.email
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    if existing is None:
        if not _signup_allowed(db, email):
            # Same generic reply — don't reveal the gate to strangers.
            logger.info("register blocked (not allowed) email=%s", email)
            return _GENERIC_EMAIL_SENT
        try:
            ratelimit.consume_registration(db)
        except HTTPException:
            raise _err(429, "registration_full", "Heute sind keine Neuregistrierungen mehr möglich.") from None
        user = User(email=email, password_hash=hash_password(body.password), daily_limit=None)
        db.add(user)
        db.commit()
        token = auth_tokens.make_verify_token(user)
        background.add_task(mailer.send_verification_email, email, user.name, _frontend_url(f"/bestaetigen?token={token}"))
        _notify_admin(background, email=email, name=user.name, method="E-Mail/Passwort", language=_language(request))
        logger.info("register new user=%s", user.id)
    elif existing.email_verified_at is None and existing.password_hash is not None:
        # Unverified retry (maybe a typo'd password): update + resend, no cap,
        # no admin notice. Account stays inactive until confirmed.
        existing.password_hash = hash_password(body.password)
        db.commit()
        token = auth_tokens.make_verify_token(existing)
        background.add_task(mailer.send_verification_email, email, existing.name, _frontend_url(f"/bestaetigen?token={token}"))
        logger.info("register resend user=%s", existing.id)
    else:
        # Already active (email or Google). Silent — the owner uses login/reset.
        logger.info("register on existing active account email=%s", email)

    return _GENERIC_EMAIL_SENT


@router.post("/verify")
def verify_email(
    body: VerifyBody,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: DbSession = Depends(get_db),
) -> dict:
    """Confirm an email address and log the user straight in (auto-login)."""
    check_ip_limit(request, scope="verify", limit=20, window_s=3600)
    uid = auth_tokens.read_verify_token(body.token)
    user = db.get(User, uid) if uid is not None else None
    if user is None:
        raise _err(400, "invalid_token", "Der Bestätigungslink ist ungültig oder abgelaufen.")

    first_time = user.email_verified_at is None
    if first_time:
        user.email_verified_at = datetime.now(timezone.utc)
        db.commit()
        background.add_task(
            mailer.send_welcome_email, user.email, user.name,
            _frontend_url("/"), "https://github.com/pepperonas/zauberkoch-pwa",
        )
        logger.info("email verified user=%s", user.id)

    session = create_session(db, user)
    set_session_cookie(response, session)
    return {"ok": True, "first_time": first_time}


@router.post("/login")
def login_password(
    body: LoginBody,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> dict:
    """Email/password login. Generic error (no enumeration); always hashes."""
    check_ip_limit(request, scope="login", limit=10, window_s=300)
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    if not verify_password(body.password, user.password_hash if user else None):
        logger.info("login failed email=%s", body.email)
        raise _err(401, "invalid_credentials", "E-Mail oder Passwort ist falsch.")
    assert user is not None  # verify_password is False for a missing user
    if user.email_verified_at is None:
        raise _err(403, "email_unverified", "Bitte bestätige zuerst deine E-Mail-Adresse.")
    session = create_session(db, user)
    set_session_cookie(response, session)
    logger.info("login ok user=%s (password)", user.id)
    return {"ok": True}


@router.post("/forgot")
def forgot_password(
    body: ForgotBody,
    request: Request,
    background: BackgroundTasks,
    db: DbSession = Depends(get_db),
) -> dict:
    """Request a reset link. Enumeration-safe: identical generic response."""
    check_ip_limit(request, scope="forgot", limit=5, window_s=3600)
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    if user is not None and user.password_hash is not None:
        token = auth_tokens.make_reset_token(user)
        background.add_task(
            mailer.send_reset_email, user.email, user.name,
            _frontend_url(f"/passwort-zuruecksetzen?token={token}"),
        )
        logger.info("reset requested user=%s", user.id)
    return _GENERIC_EMAIL_SENT


@router.post("/reset")
def reset_password(
    body: ResetBody,
    request: Request,
    db: DbSession = Depends(get_db),
) -> dict:
    """Set a new password from a valid reset token, then invalidate all
    existing sessions of that account."""
    check_ip_limit(request, scope="reset", limit=10, window_s=3600)
    try:
        body.check()
    except PasswordError as e:
        raise _err(400, "weak_password", str(e)) from e

    user = auth_tokens.read_reset_token(body.token, lambda uid: db.get(User, uid))
    if user is None:
        raise _err(400, "invalid_token", "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.")

    user.password_hash = hash_password(body.password)
    if user.email_verified_at is None:  # a successful reset also proves ownership
        user.email_verified_at = datetime.now(timezone.utc)
    # Revoke every existing session — a reset should log out other devices.
    for sess in db.execute(select(SessionModel).where(SessionModel.user_id == user.id)).scalars():
        db.delete(sess)
    db.commit()
    logger.info("password reset user=%s", user.id)
    return {"ok": True}


@router.post("/logout", dependencies=[Depends(require_csrf)])
def logout(
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> Response:
    db.delete(session)
    db.commit()
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


