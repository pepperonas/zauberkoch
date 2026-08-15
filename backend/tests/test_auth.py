"""Auth flow tests — Google endpoints are mocked, no real network calls."""

import time
from urllib.parse import parse_qs, urlparse

import pytest

from app.core.config import get_settings
from app.services import google_oauth, ratelimit_ip


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


def fake_claims(email="alice@example.com", sub="sub-123"):
    return {
        "aud": get_settings().google_client_id,
        "iss": "https://accounts.google.com",
        "exp": time.time() + 3600,
        "sub": sub,
        "email": email,
        "email_verified": True,
        "name": "Alice",
        "picture": "https://example.com/p.png",
    }


def do_login_callback(client, monkeypatch, claims=None, invite=""):
    """Run the full login → callback flow with a mocked token exchange."""
    claims = claims or fake_claims()
    suffix = f"?invite={invite}" if invite else ""
    r = client.get(f"/api/v1/auth/login{suffix}", follow_redirects=False)
    assert r.status_code == 307
    query = parse_qs(urlparse(r.headers["location"]).query)
    state = query["state"][0]
    assert query["code_challenge_method"] == ["S256"]

    monkeypatch.setattr(google_oauth, "exchange_code", lambda code, verifier: {"id_token": "fake"})
    monkeypatch.setattr(google_oauth, "parse_id_token", lambda tok: claims)
    return client.get(f"/api/v1/auth/callback?code=abc&state={state}", follow_redirects=False)


def add_to_allowlist(db_session, email):
    from app.models import AllowlistEntry

    db_session.add(AllowlistEntry(email=email))
    db_session.commit()


def test_login_redirects_to_google(client):
    r = client.get("/api/v1/auth/login", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "zk_oauth" in r.cookies


def test_callback_rejects_unknown_email_when_signup_closed(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "open_signup", False)
    r = do_login_callback(client, monkeypatch)
    assert r.status_code == 303
    assert "login_error=not_allowed" in r.headers["location"]


def test_open_signup_creates_user_with_null_limit(client, db_session, monkeypatch):
    from app.core.config import get_settings
    from app.models import User

    settings = get_settings()
    # the test env pins OPEN_SIGNUP=false; enable it here to exercise open signup
    monkeypatch.setattr(settings, "open_signup", True)
    r = do_login_callback(client, monkeypatch, claims=fake_claims(email="newbie@example.com", sub="sub-new"))
    assert "login_error" not in r.headers["location"]

    user = db_session.query(User).filter_by(email="newbie@example.com").one()
    assert user.daily_limit is None  # NULL -> uses the system default
    usage = client.get("/api/v1/me").json()
    assert usage["email"] == "newbie@example.com"


def test_registration_daily_cap_blocks_new_signups(client, db_session, monkeypatch):
    """After the daily registration cap, new signups are rejected; the cap does
    NOT affect existing users logging in."""
    from app.core.config import get_settings
    from app.models import User

    settings = get_settings()
    monkeypatch.setattr(settings, "open_signup", True)
    monkeypatch.setattr(settings, "daily_registration_limit", 1)  # only 1 new account today

    r1 = do_login_callback(client, monkeypatch, claims=fake_claims(email="a@example.com", sub="sub-a"))
    assert "login_error" not in r1.headers["location"]

    r2 = do_login_callback(client, monkeypatch, claims=fake_claims(email="b@example.com", sub="sub-b"))
    assert "login_error=registration_full" in r2.headers["location"]
    assert db_session.query(User).filter_by(email="b@example.com").one_or_none() is None

    # The already-registered user can still log in (no new account created).
    r3 = do_login_callback(client, monkeypatch, claims=fake_claims(email="a@example.com", sub="sub-a"))
    assert "login_error" not in r3.headers["location"]


def test_callback_creates_user_from_allowlist(client, db_session, monkeypatch):
    add_to_allowlist(db_session, "alice@example.com")
    r = do_login_callback(client, monkeypatch)
    assert r.status_code == 303
    assert "login_error" not in r.headers["location"]

    me = client.get("/api/v1/me")
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "alice@example.com"
    assert body["adult_confirmed"] is False
    assert body["csrf_token"]


def test_existing_user_can_login_without_allowlist(client, db_session, monkeypatch):
    from app.models import User

    db_session.add(User(google_sub="sub-123", email="alice@example.com"))
    db_session.commit()
    r = do_login_callback(client, monkeypatch)
    assert "login_error" not in r.headers["location"]
    assert client.get("/api/v1/me").status_code == 200


def test_callback_rejects_state_mismatch(client, monkeypatch):
    client.get("/api/v1/auth/login", follow_redirects=False)
    monkeypatch.setattr(google_oauth, "exchange_code", lambda code, verifier: {"id_token": "fake"})
    r = client.get("/api/v1/auth/callback?code=abc&state=WRONG", follow_redirects=False)
    assert "login_error=state_mismatch" in r.headers["location"]


def test_me_anonymous_is_200_unauthenticated(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 200
    assert r.json() == {"authenticated": False}


def test_confirm_adult_requires_csrf(client, db_session, monkeypatch):
    add_to_allowlist(db_session, "alice@example.com")
    do_login_callback(client, monkeypatch)

    r = client.post("/api/v1/me/confirm-adult")
    assert r.status_code == 403

    csrf = client.get("/api/v1/me").json()["csrf_token"]
    r = client.post("/api/v1/me/confirm-adult", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200
    assert client.get("/api/v1/me").json()["adult_confirmed"] is True


def test_logout_clears_session(client, db_session, monkeypatch):
    add_to_allowlist(db_session, "alice@example.com")
    do_login_callback(client, monkeypatch)
    csrf = client.get("/api/v1/me").json()["csrf_token"]

    r = client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 204
    assert client.get("/api/v1/me").json()["authenticated"] is False


def test_auth_ip_rate_limit(client):
    for _ in range(20):
        client.get("/api/v1/auth/login", follow_redirects=False)
    r = client.get("/api/v1/auth/login", follow_redirects=False)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"


def test_expired_session_rejected(client, db_session, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app.models import Session as SessionModel

    add_to_allowlist(db_session, "alice@example.com")
    do_login_callback(client, monkeypatch)
    sess = db_session.query(SessionModel).first()
    sess.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.commit()

    assert client.get("/api/v1/me").json()["authenticated"] is False


def test_a_session_whose_user_row_is_gone_is_rejected(client):
    """The session table and the user table can disagree for a moment during
    account deletion. A dangling session must fail closed with 401 rather than
    let the request run with `user = None`.

    The state is injected through the dependency instead of being manufactured
    in the DB: a real dangling row cannot be created while the foreign key is
    enforced, and switching `PRAGMA foreign_keys` off is both a no-op inside a
    transaction and a way to poison a pooled connection for later tests.
    """
    from datetime import datetime, timedelta, timezone

    from app.core.security import get_current_session
    from app.models import Session as SessionModel

    ghost = SessionModel(
        token="ghost", csrf_token="ghost", user_id=999_999,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    client.app.dependency_overrides[get_current_session] = lambda: ghost
    try:
        r = client.get("/api/v1/shopping")
    finally:
        client.app.dependency_overrides.clear()

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"
