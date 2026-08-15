"""Auth paths that only run when something goes wrong.

These branches decide what a stranger learns about an account and what happens
when Google, the network or the user misbehaves. They are hard to reach by
hand and easy to regress, which is exactly the combination that earns a test.
"""

import pytest

from app.core.config import get_settings
from app.services import auth_tokens, google_oauth, mailer, ratelimit_ip
from tests.test_auth import add_to_allowlist, fake_claims


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture(autouse=True)
def _no_mail(monkeypatch):
    """Capture outgoing mail instead of letting the mailer log a warning."""
    sent: list[tuple] = []
    monkeypatch.setattr(mailer, "send_verification_email", lambda *a, **kw: sent.append(("verify", a)) or True)
    monkeypatch.setattr(mailer, "send_reset_email", lambda *a, **kw: sent.append(("reset", a)) or True)
    monkeypatch.setattr(mailer, "send_welcome_email", lambda *a, **kw: True)
    monkeypatch.setattr(mailer, "send_admin_signup_notification", lambda *a, **kw: True)
    return sent


def _start_login(client) -> str:
    """Begin the OAuth dance and return the state the server stashed."""
    from urllib.parse import parse_qs, urlparse

    r = client.get("/api/v1/auth/login", follow_redirects=False)
    return parse_qs(urlparse(r.headers["location"]).query)["state"][0]


def _login_error(response) -> str:
    from urllib.parse import parse_qs, urlparse

    return parse_qs(urlparse(response.headers["location"]).query).get("login_error", [""])[0]


# -- the OAuth callback, when it does not go to plan -----------------------


def test_a_cancelled_consent_screen_lands_on_a_readable_error(client):
    """Google sends the user back with ?error=access_denied when they hit
    "Abbrechen" — a common, entirely innocent path."""
    state = _start_login(client)
    r = client.get(f"/api/v1/auth/callback?error=access_denied&state={state}", follow_redirects=False)

    assert r.status_code == 303
    assert _login_error(r) == "cancelled"


def test_a_callback_without_a_code_is_rejected(client):
    state = _start_login(client)
    r = client.get(f"/api/v1/auth/callback?state={state}", follow_redirects=False)
    assert _login_error(r) == "cancelled"


def test_a_failing_token_exchange_does_not_leak_the_exception(client, monkeypatch):
    """If Google's token endpoint is down, the user sees a login error — not a
    stack trace and not a 500."""
    state = _start_login(client)

    def explode(code, verifier):
        raise RuntimeError("google is having a day")

    monkeypatch.setattr(google_oauth, "exchange_code", explode)

    r = client.get(f"/api/v1/auth/callback?code=abc&state={state}", follow_redirects=False)

    assert r.status_code == 303
    assert _login_error(r) == "exchange_failed"
    assert "google is having a day" not in r.text


def test_an_id_token_that_fails_validation_is_refused(client, monkeypatch):
    """parse_id_token returns None for a wrong audience, a bad issuer, an
    expired token or an unverified address — all of them end here."""
    state = _start_login(client)
    monkeypatch.setattr(google_oauth, "exchange_code", lambda c, v: {"id_token": "irgendwas"})
    monkeypatch.setattr(google_oauth, "parse_id_token", lambda tok: None)

    r = client.get(f"/api/v1/auth/callback?code=abc&state={state}", follow_redirects=False)

    assert _login_error(r) == "invalid_token"


def test_signing_in_with_google_verifies_a_pending_email_account(client, db_session, monkeypatch):
    """Someone registers with email/password, never clicks the link, then signs
    in with Google using the same address. Google has verified the address, so
    the account is linked *and* marked confirmed — otherwise they would own an
    account they can never log into with a password."""
    from app.models import User
    from app.services.passwords import hash_password

    pending = User(email="alice@example.com", password_hash=hash_password("Sicher123!"), email_verified_at=None)
    db_session.add(pending)
    db_session.commit()
    pending_id = pending.id

    state = _start_login(client)
    monkeypatch.setattr(google_oauth, "exchange_code", lambda c, v: {"id_token": "fake"})
    monkeypatch.setattr(google_oauth, "parse_id_token", lambda tok: fake_claims())

    client.get(f"/api/v1/auth/callback?code=abc&state={state}", follow_redirects=False)

    db_session.expire_all()
    linked = db_session.get(User, pending_id)
    assert linked.google_sub == "sub-123", "google was linked to the existing row"
    assert linked.email_verified_at is not None, "google's verification counts"
    assert db_session.query(User).count() == 1, "no duplicate account was created"


# -- registration ----------------------------------------------------------


def test_a_blocked_signup_is_indistinguishable_from_a_successful_one(client, monkeypatch, _no_mail):
    """With registration closed, the response for a stranger must look exactly
    like the response for an accepted address — otherwise the endpoint becomes
    an oracle for "is this address allowed here?"."""
    monkeypatch.setattr(get_settings(), "open_signup", False)

    blocked = client.post(
        "/api/v1/auth/register",
        json={"email": "fremde@example.com", "password": "Sicher123!", "password_confirm": "Sicher123!"},
    )

    assert blocked.status_code == 200
    assert blocked.json()["ok"] is True
    assert "nicht" not in blocked.json()["message"].lower(), "the reply must not hint at a rejection"
    assert _no_mail == [], "no mail may go out for a blocked address"


def test_the_blocked_and_the_accepted_reply_are_byte_identical(client, db_session, monkeypatch, _no_mail):
    monkeypatch.setattr(get_settings(), "open_signup", False)
    add_to_allowlist(db_session, "eingeladen@example.com")

    blocked = client.post(
        "/api/v1/auth/register",
        json={"email": "fremde@example.com", "password": "Sicher123!", "password_confirm": "Sicher123!"},
    )
    accepted = client.post(
        "/api/v1/auth/register",
        json={"email": "eingeladen@example.com", "password": "Sicher123!", "password_confirm": "Sicher123!"},
    )

    assert blocked.json() == accepted.json()
    assert blocked.status_code == accepted.status_code
    assert [kind for kind, _ in _no_mail] == ["verify"], "only the allowed address gets mail"


def test_the_daily_registration_cap_is_enforced(client, db_session, monkeypatch, _no_mail):
    """The cap protects the project budget: every new account can generate."""
    monkeypatch.setattr(get_settings(), "open_signup", True)
    monkeypatch.setattr(get_settings(), "daily_registration_limit", 1)

    first = client.post(
        "/api/v1/auth/register",
        json={"email": "eins@example.com", "password": "Sicher123!", "password_confirm": "Sicher123!"},
    )
    second = client.post(
        "/api/v1/auth/register",
        json={"email": "zwei@example.com", "password": "Sicher123!", "password_confirm": "Sicher123!"},
    )

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "registration_full"


def test_a_weak_password_is_refused_before_anything_is_stored(client, db_session):
    from app.models import User

    r = client.post(
        "/api/v1/auth/register",
        json={"email": "neu@example.com", "password": "kurz", "password_confirm": "kurz"},
    )

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "weak_password"
    assert db_session.query(User).count() == 0


# -- password reset --------------------------------------------------------


def test_a_reset_refuses_a_weak_new_password(client, db_session):
    from app.models import User
    from app.services.passwords import hash_password

    user = User(email="alice@example.com", password_hash=hash_password("AltesPasswort1!"))
    db_session.add(user)
    db_session.commit()
    token = auth_tokens.make_reset_token(user)

    r = client.post("/api/v1/auth/reset", json={"token": token, "password": "kurz", "password_confirm": "kurz"})

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "weak_password"


def test_a_reset_refuses_a_mismatched_confirmation(client, db_session):
    from app.models import User
    from app.services.passwords import hash_password

    user = User(email="alice@example.com", password_hash=hash_password("AltesPasswort1!"))
    db_session.add(user)
    db_session.commit()
    token = auth_tokens.make_reset_token(user)

    r = client.post(
        "/api/v1/auth/reset",
        json={"token": token, "password": "Sicher123!", "password_confirm": "Sicher124!"},
    )

    assert r.status_code == 400


def test_a_completed_reset_also_confirms_the_address(client, db_session):
    """Receiving the mail proves the address belongs to them — asking them to
    click a second, older confirmation link would be pointless."""
    from app.models import User
    from app.services.passwords import hash_password

    user = User(email="alice@example.com", password_hash=hash_password("AltesPasswort1!"), email_verified_at=None)
    db_session.add(user)
    db_session.commit()
    user_id = user.id
    token = auth_tokens.make_reset_token(user)

    r = client.post(
        "/api/v1/auth/reset",
        json={"token": token, "password": "NeuesPasswort1!", "password_confirm": "NeuesPasswort1!"},
    )

    assert r.status_code == 200
    db_session.expire_all()
    assert db_session.get(User, user_id).email_verified_at is not None


def test_a_reset_logs_every_other_device_out(client, db_session):
    """If the reset was triggered because someone else had the password, the
    old sessions must not survive it."""
    from app.core.security import create_session
    from app.models import Session as SessionModel
    from app.models import User
    from app.services.passwords import hash_password

    user = User(email="alice@example.com", password_hash=hash_password("AltesPasswort1!"))
    db_session.add(user)
    db_session.commit()
    create_session(db_session, user)
    create_session(db_session, user)
    assert db_session.query(SessionModel).count() == 2

    token = auth_tokens.make_reset_token(user)
    client.post(
        "/api/v1/auth/reset",
        json={"token": token, "password": "NeuesPasswort1!", "password_confirm": "NeuesPasswort1!"},
    )

    assert db_session.query(SessionModel).count() == 0


def test_the_same_reset_link_cannot_be_used_twice(client, db_session):
    from app.models import User
    from app.services.passwords import hash_password

    user = User(email="alice@example.com", password_hash=hash_password("AltesPasswort1!"))
    db_session.add(user)
    db_session.commit()
    token = auth_tokens.make_reset_token(user)
    payload = {"token": token, "password": "NeuesPasswort1!", "password_confirm": "NeuesPasswort1!"}

    assert client.post("/api/v1/auth/reset", json=payload).status_code == 200
    second = client.post("/api/v1/auth/reset", json=payload)

    assert second.status_code == 400
    assert second.json()["error"]["code"] == "invalid_token"
