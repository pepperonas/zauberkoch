"""Email/password auth endpoints. AI/SMTP mocked; mailer calls recorded."""

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.models import User
from app.services import auth_tokens, ratelimit_ip


@pytest.fixture(autouse=True)
def _reset_ip():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture(autouse=True)
def _open_signup(monkeypatch):
    # conftest closes signup (allowlist); these tests exercise the open path.
    monkeypatch.setattr(get_settings(), "open_signup", True)


@pytest.fixture()
def mails(monkeypatch):
    """Record every outbound mail instead of sending it."""
    from app.services import mailer

    rec = {"verify": [], "welcome": [], "reset": [], "admin": []}
    monkeypatch.setattr(mailer, "send_verification_email", lambda to, name, url: rec["verify"].append({"to": to, "url": url}) or True)
    monkeypatch.setattr(mailer, "send_welcome_email", lambda to, name, app_url, repo_url: rec["welcome"].append(to) or True)
    monkeypatch.setattr(mailer, "send_reset_email", lambda to, name, url, **k: rec["reset"].append({"to": to, "url": url}) or True)
    monkeypatch.setattr(mailer, "send_admin_signup_notification", lambda to, **k: rec["admin"].append({"to": to, **k}) or True)
    return rec


PW = "Sicher123!"


def _register(client, email=" Alice@Example.de ", password=PW, confirm=PW):
    return client.post("/api/v1/auth/register", json={"email": email, "password": password, "password_confirm": confirm})


def _token_from_url(url: str) -> str:
    return url.split("token=", 1)[1]


# ─────────────────────────── registration ───────────────────────────

def test_register_creates_inactive_user_and_sends_mails(client, db_session, mails):
    r = _register(client)
    assert r.status_code == 200 and r.json()["ok"] is True

    user = db_session.execute(select(User).where(User.email == "alice@example.de")).scalar_one()
    assert user.email == "alice@example.de"  # normalized (trim + lowercase)
    assert user.password_hash and user.password_hash.startswith("scrypt$")
    assert user.email_verified_at is None  # inactive until confirmed
    assert user.google_sub is None
    # verification + admin notification sent; no welcome yet
    assert mails["verify"][0]["to"] == "alice@example.de"
    assert mails["admin"][0]["to"] == "martin.pfeffer@celox.io"
    assert mails["admin"][0]["method"] == "E-Mail/Passwort"
    assert mails["welcome"] == []


def test_register_rejects_weak_password_and_mismatch(client, mails):
    assert _register(client, password="kurz", confirm="kurz").status_code == 400
    r = _register(client, password=PW, confirm="Anders123!")
    assert r.status_code == 400 and r.json()["error"]["code"] == "weak_password"
    assert mails["verify"] == []  # nothing sent on invalid input


def test_register_is_enumeration_safe_for_existing_account(client, db_session, mails):
    _register(client)  # first time
    mails["verify"].clear(); mails["admin"].clear()
    # verify it, making it active
    _verify_latest(client, db_session)

    r = _register(client)  # same email, already active
    assert r.status_code == 200 and r.json()["ok"] is True  # identical generic reply
    assert mails["verify"] == [] and mails["admin"] == []  # but nothing leaked/sent


def test_register_unverified_retry_resends_without_admin_notice(client, mails):
    _register(client)
    mails["admin"].clear()
    r = _register(client, password="Neues456!", confirm="Neues456!")
    assert r.status_code == 200
    assert len(mails["verify"]) == 2  # resent
    assert mails["admin"] == []  # no second admin notice


# ─────────────────────────── verification ───────────────────────────

def _verify_latest(client, db_session):
    user = db_session.execute(select(User).order_by(User.id.desc())).scalars().first()
    token = auth_tokens.make_verify_token(user)
    return client.post("/api/v1/auth/verify", json={"token": token})


def test_verify_activates_account_logs_in_and_welcomes(client, db_session, mails):
    _register(client)
    r = _verify_latest(client, db_session)
    assert r.status_code == 200 and r.json()["first_time"] is True
    assert client.cookies.get("zk_session")  # auto-logged-in
    user = db_session.execute(select(User).where(User.email == "alice@example.de")).scalar_one()
    assert user.email_verified_at is not None
    assert mails["welcome"] == ["alice@example.de"]


def test_verify_is_idempotent(client, db_session, mails):
    _register(client)
    _verify_latest(client, db_session)
    r = _verify_latest(client, db_session)  # click again
    assert r.status_code == 200 and r.json()["first_time"] is False
    assert len(mails["welcome"]) == 1  # welcome only once


def test_verify_rejects_bad_token(client):
    r = client.post("/api/v1/auth/verify", json={"token": "nope.sig"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_token"


# ─────────────────────────── login ───────────────────────────

def _activate(client, db_session):
    _register(client)
    _verify_latest(client, db_session)
    client.cookies.clear()  # start from logged-out


def test_login_requires_verified_account(client, db_session, mails):
    _register(client)  # unverified
    r = client.post("/api/v1/auth/login", json={"email": "alice@example.de", "password": PW})
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_unverified"


def test_login_success_and_wrong_password_generic(client, db_session, mails):
    _activate(client, db_session)
    ok = client.post("/api/v1/auth/login", json={"email": "alice@example.de", "password": PW})
    assert ok.status_code == 200 and client.cookies.get("zk_session")

    client.cookies.clear()
    bad = client.post("/api/v1/auth/login", json={"email": "alice@example.de", "password": "Falsch123!"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_credentials"
    # unknown email → identical generic error (no enumeration)
    unknown = client.post("/api/v1/auth/login", json={"email": "ghost@example.de", "password": PW})
    assert unknown.status_code == 401 and unknown.json()["error"]["code"] == "invalid_credentials"


# ─────────────────────────── forgot / reset ───────────────────────────

def test_forgot_is_enumeration_safe(client, db_session, mails):
    _activate(client, db_session)
    r1 = client.post("/api/v1/auth/forgot", json={"email": "alice@example.de"})
    r2 = client.post("/api/v1/auth/forgot", json={"email": "ghost@example.de"})
    assert r1.status_code == r2.status_code == 200
    assert r1.json() == r2.json()  # identical body
    assert len(mails["reset"]) == 1  # only the real account got a mail


def test_reset_sets_new_password_and_revokes_sessions(client, db_session, mails):
    _activate(client, db_session)
    # log in on this client (a session to be revoked)
    client.post("/api/v1/auth/login", json={"email": "alice@example.de", "password": PW})
    client.post("/api/v1/auth/forgot", json={"email": "alice@example.de"})
    token = _token_from_url(mails["reset"][-1]["url"])

    new_pw = "GanzNeu9!"
    r = client.post("/api/v1/auth/reset", json={"token": token, "password": new_pw, "password_confirm": new_pw})
    assert r.status_code == 200

    # old sessions revoked: /me is now unauthenticated
    assert client.get("/api/v1/me").json()["authenticated"] is False
    # new password works, old one doesn't
    client.cookies.clear()
    assert client.post("/api/v1/auth/login", json={"email": "alice@example.de", "password": new_pw}).status_code == 200
    client.cookies.clear()
    assert client.post("/api/v1/auth/login", json={"email": "alice@example.de", "password": PW}).status_code == 401


def test_reset_token_is_single_use(client, db_session, mails):
    _activate(client, db_session)
    client.post("/api/v1/auth/forgot", json={"email": "alice@example.de"})
    token = _token_from_url(mails["reset"][-1]["url"])
    body = {"token": token, "password": "GanzNeu9!", "password_confirm": "GanzNeu9!"}
    assert client.post("/api/v1/auth/reset", json=body).status_code == 200
    # reusing the same link fails (fingerprint no longer matches)
    again = client.post("/api/v1/auth/reset", json={"token": token, "password": "Wieder12!", "password_confirm": "Wieder12!"})
    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_token"


# ─────────────────────────── google auto-link ───────────────────────────

def test_google_links_to_existing_email_account(client, db_session, mails, monkeypatch):
    """A Google login for an email that already has a password account links
    the two instead of colliding on the unique email."""
    _activate(client, db_session)
    user_before = db_session.execute(select(User).where(User.email == "alice@example.de")).scalar_one()
    assert user_before.google_sub is None

    from tests.test_auth import do_login_callback, fake_claims

    client.cookies.clear()
    do_login_callback(client, monkeypatch, claims=fake_claims(email="alice@example.de", sub="google-alice"))
    db_session.expire_all()
    linked = db_session.execute(select(User).where(User.email == "alice@example.de")).scalar_one()
    assert linked.id == user_before.id  # same account
    assert linked.google_sub == "google-alice"  # google now attached
    # no duplicate account created
    assert db_session.execute(select(User).where(User.email == "alice@example.de")).scalars().all().__len__() == 1
