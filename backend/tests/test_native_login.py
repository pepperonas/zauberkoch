"""The native login handoff.

Google refuses OAuth in an embedded WebView, so the app runs the flow in a
Custom Tab and the finished session has to cross back into the app. The
security of that crossing rests on ONE property, and it is the reason most of
these tests exist: an Android custom scheme is not exclusive, so the handoff
token must be worthless to whoever intercepts it.
"""

import time
from urllib.parse import parse_qs, urlparse

import pytest

from app.services import google_oauth, native_login, ratelimit_ip
from tests.test_auth import add_to_allowlist, fake_claims

VERIFIER = "v" * 43  # the app sends 32 random bytes, base64url


@pytest.fixture(autouse=True)
def _fresh_and_allowed(db_session):
    """The IP limiter is in-memory and process-wide, so a file that logs in
    twenty times would otherwise start 429-ing halfway through. And signup is
    closed in tests (OPEN_SIGNUP=false), so the account has to be on the
    allowlist or every run ends in `not_allowed` rather than a handoff."""
    ratelimit_ip.reset()
    add_to_allowlist(db_session, fake_claims()["email"])
    yield
    ratelimit_ip.reset()


def start_native(client, challenge):
    r = client.get(f"/api/v1/auth/login?native=1&cc={challenge}", follow_redirects=False)
    assert r.status_code == 307
    return parse_qs(urlparse(r.headers["location"]).query)["state"][0]


def finish(client, monkeypatch, state, claims=None):
    monkeypatch.setattr(google_oauth, "exchange_code", lambda code, verifier: {"id_token": "fake"})
    monkeypatch.setattr(google_oauth, "parse_id_token", lambda tok: claims or fake_claims())
    return client.get(f"/api/v1/auth/callback?code=abc&state={state}", follow_redirects=False)


def native_login_run(client, monkeypatch, verifier=VERIFIER):
    """Full Custom-Tab login; returns the handoff token from the deep link."""
    challenge = native_login.challenge_for(verifier)
    state = start_native(client, challenge)
    r = finish(client, monkeypatch, state)
    assert r.status_code == 303
    link = urlparse(r.headers["location"])
    return parse_qs(link.query)["t"][0]


# -- the fingerprint ------------------------------------------------------


def test_the_challenge_is_an_unpadded_base64url_sha256():
    c = native_login.challenge_for("hello")
    assert c == "LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ"
    assert "=" not in c and "+" not in c and "/" not in c
    assert native_login.is_valid_challenge(c)


@pytest.mark.parametrize(
    "bad",
    ["", "short", "x" * 42, "x" * 44, "LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmC=", "a/b" + "x" * 40],
)
def test_junk_never_counts_as_a_challenge(bad):
    assert not native_login.is_valid_challenge(bad)


# -- the crossing ---------------------------------------------------------


def test_a_native_login_comes_back_over_the_app_scheme(client, monkeypatch):
    state = start_native(client, native_login.challenge_for(VERIFIER))
    r = finish(client, monkeypatch, state)
    assert r.status_code == 303
    link = urlparse(r.headers["location"])
    assert link.scheme == native_login.LOGIN_SCHEME
    assert link.hostname == "login"
    assert parse_qs(link.query)["t"][0]


def test_the_browser_is_left_without_a_session(client, monkeypatch):
    """The Custom Tab must not keep a logged-in surface behind on the device --
    and a cookie set there would be unreadable to the app anyway."""
    state = start_native(client, native_login.challenge_for(VERIFIER))
    r = finish(client, monkeypatch, state)
    assert "zk_session" not in r.cookies
    assert all("zk_session=" not in h for h in r.headers.get_list("set-cookie"))


def test_the_handoff_turns_into_a_session_for_the_app(client, monkeypatch):
    token = native_login_run(client, monkeypatch)
    r = client.post("/api/v1/auth/native/redeem", json={"t": token, "v": VERIFIER})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.cookies.get("zk_session")
    me = client.get("/api/v1/me").json()
    assert me["authenticated"] is True


# -- what an interceptor gets ---------------------------------------------


def test_the_token_alone_is_worthless(client, monkeypatch):
    """The whole point. Another app may register `zauberkoch://` and read the
    token out of the redirect; without the verifier it cannot spend it."""
    token = native_login_run(client, monkeypatch)
    for attempt in ["", "guess", "w" * 43, VERIFIER[:-1] + "x"]:
        r = client.post("/api/v1/auth/native/redeem", json={"t": token, "v": attempt})
        assert r.status_code == 400, attempt
        assert not client.cookies.get("zk_session")


def test_a_forged_token_is_rejected(client):
    forged = native_login.make_handoff_token(1, native_login.challenge_for(VERIFIER)) + "x"
    r = client.post("/api/v1/auth/native/redeem", json={"t": forged, "v": VERIFIER})
    assert r.status_code == 400


def test_a_token_minted_for_another_challenge_is_rejected(client, monkeypatch):
    """Guards the binding itself: a valid signature over someone else's
    challenge must not let our verifier through."""
    native_login_run(client, monkeypatch)
    other = native_login.make_handoff_token(1, native_login.challenge_for("someone-else" * 4))
    r = client.post("/api/v1/auth/native/redeem", json={"t": other, "v": VERIFIER})
    assert r.status_code == 400


def test_an_expired_handoff_is_rejected(client, monkeypatch):
    token = native_login_run(client, monkeypatch)
    later = time.time() + native_login.HANDOFF_MAX_AGE_S + 1
    monkeypatch.setattr("app.core.security.time.time", lambda: later)
    r = client.post("/api/v1/auth/native/redeem", json={"t": token, "v": VERIFIER})
    assert r.status_code == 400


def test_a_handoff_dies_with_its_session(client, monkeypatch, db_session):
    """Logging out before redeeming must not leave a usable token behind."""
    from app.models import Session as SessionModel

    token = native_login_run(client, monkeypatch)
    db_session.query(SessionModel).delete()
    db_session.commit()
    r = client.post("/api/v1/auth/native/redeem", json={"t": token, "v": VERIFIER})
    assert r.status_code == 400


def test_every_rejection_reads_the_same(client, monkeypatch):
    """A caller must not be able to tell a forgery from an expiry, nor probe
    which session ids exist."""
    token = native_login_run(client, monkeypatch)
    bodies = [
        {"t": token, "v": "wrong"},
        {"t": token + "x", "v": VERIFIER},
        {"t": native_login.make_handoff_token(99999, native_login.challenge_for(VERIFIER)), "v": VERIFIER},
    ]
    seen = {client.post("/api/v1/auth/native/redeem", json=b).json()["error"]["code"] for b in bodies}
    assert seen == {"handoff_invalid"}


def test_a_token_of_another_purpose_never_redeems(client):
    """The other direction of the same binding, and the reason it needs a test
    at all: nothing else in this system currently carries BOTH a challenge and
    a session id, so the guard is invisible in practice. Without this pin, the
    next token type to grow those fields would silently become a valid
    handoff. (Found by mutation: removing the purpose check left the suite
    green.)"""
    from app.core.security import sign_payload

    look_alike = sign_payload({"p": "reset", "sid": 1, "ch": native_login.challenge_for(VERIFIER)})
    assert native_login.read_handoff_token(look_alike, VERIFIER) is None
    r = client.post("/api/v1/auth/native/redeem", json={"t": look_alike, "v": VERIFIER})
    assert r.status_code == 400


def test_a_handoff_token_is_not_a_verify_or_reset_token(client, monkeypatch):
    """Purpose binding, the same guarantee auth_tokens.py makes."""
    from app.services import auth_tokens

    token = native_login_run(client, monkeypatch)
    assert auth_tokens.read_verify_token(token) is None
    assert auth_tokens.read_reset_token(token, lambda uid: None) is None


# -- the browser must not notice ------------------------------------------


def test_a_plain_web_login_is_untouched(client, monkeypatch):
    r = client.get("/api/v1/auth/login", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    done = finish(client, monkeypatch, state)
    assert done.status_code == 303
    assert urlparse(done.headers["location"]).scheme in ("http", "https")
    assert client.cookies.get("zk_session")


def test_a_native_run_without_a_usable_challenge_stays_on_the_web(client, monkeypatch):
    """Degrade to the ordinary flow rather than mint a handoff nobody owns."""
    state = start_native(client, "not-a-challenge")
    done = finish(client, monkeypatch, state)
    assert urlparse(done.headers["location"]).scheme in ("http", "https")
    assert client.cookies.get("zk_session")


def test_a_failed_native_login_still_returns_to_the_app(client):
    """Otherwise the Custom Tab sits on a web error page in front of an app
    that never learns the attempt is over."""
    state = start_native(client, native_login.challenge_for(VERIFIER))
    r = client.get(f"/api/v1/auth/callback?error=access_denied&state={state}", follow_redirects=False)
    link = urlparse(r.headers["location"])
    assert link.scheme == native_login.LOGIN_SCHEME
    assert parse_qs(link.query)["error"] == ["cancelled"]


# -- the three places that must agree -------------------------------------


def test_the_scheme_is_the_same_in_all_three_layers():
    """The scheme lives in the backend, in the frontend's pure rules and in the
    Android string resource. A mismatch is invisible in the browser and breaks
    login in the shipped app only, so it gets a pin rather than a comment."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    rules = (root / "frontend/src/native/nativeRules.ts").read_text()
    strings = (root / "frontend/android/app/src/main/res/values/strings.xml").read_text()
    assert f"'{native_login.LOGIN_SCHEME}'" in rules
    assert f"<string name=\"custom_url_scheme\">{native_login.LOGIN_SCHEME}</string>" in strings
