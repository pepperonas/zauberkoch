"""Google OAuth helpers: PKCE, the authorization URL, ID-token validation.

The ID token arrives straight from Google's token endpoint over TLS, so we do
not verify its signature — which makes the *claim* checks the only thing
standing between a forged token and a session. Each rejection reason therefore
gets its own test: a regression that drops one `if` would otherwise stay
invisible behind the other four.
"""

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.core.config import get_settings
from app.services import google_oauth as oauth


def _id_token(**claims) -> str:
    """Build an unsigned JWT-shaped token with the given payload claims."""
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


def _valid_claims(**overrides) -> dict:
    claims = {
        "aud": get_settings().google_client_id,
        "iss": "https://accounts.google.com",
        "exp": int(time.time()) + 3600,
        "email": "koch@example.com",
        "email_verified": True,
        "sub": "google-user-1",
        "name": "Koch",
    }
    claims.update(overrides)
    return claims


# -- PKCE ------------------------------------------------------------------


def test_pkce_challenge_is_the_sha256_of_the_verifier():
    verifier, challenge = oauth.make_pkce()
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    assert challenge == expected


def test_pkce_challenge_is_base64url_without_padding():
    """'=' and '+/' would be re-encoded in the query string and break the check."""
    _, challenge = oauth.make_pkce()
    assert "=" not in challenge
    assert "+" not in challenge and "/" not in challenge


def test_pkce_verifier_is_fresh_every_time():
    verifiers = {oauth.make_pkce()[0] for _ in range(20)}
    assert len(verifiers) == 20


# -- authorization URL -----------------------------------------------------


def test_auth_url_carries_every_parameter_google_needs():
    url = oauth.build_auth_url("state-123", "challenge-abc")
    query = parse_qs(urlparse(url).query)

    assert url.startswith(oauth.AUTH_ENDPOINT + "?")
    assert query["response_type"] == ["code"]
    assert query["state"] == ["state-123"]
    assert query["code_challenge"] == ["challenge-abc"]
    assert query["code_challenge_method"] == ["S256"], "plain PKCE would defeat the point"
    assert query["client_id"] == [get_settings().google_client_id]
    assert query["redirect_uri"] == [get_settings().oauth_redirect_uri]
    assert set(query["scope"][0].split()) == {"openid", "email", "profile"}


# -- ID-token claim validation --------------------------------------------


def test_valid_id_token_is_accepted():
    claims = oauth.parse_id_token(_id_token(**_valid_claims()))
    assert claims is not None
    assert claims["email"] == "koch@example.com"
    assert claims["sub"] == "google-user-1"


def test_token_for_another_client_is_rejected():
    """A token minted for a different app must not open a session here."""
    assert oauth.parse_id_token(_id_token(**_valid_claims(aud="someone-elses-client"))) is None


@pytest.mark.parametrize("issuer", ["https://accounts.google.com", "accounts.google.com"])
def test_both_documented_issuers_are_accepted(issuer):
    assert oauth.parse_id_token(_id_token(**_valid_claims(iss=issuer))) is not None


def test_foreign_issuer_is_rejected():
    assert oauth.parse_id_token(_id_token(**_valid_claims(iss="https://evil.example"))) is None


def test_expired_token_is_rejected():
    assert oauth.parse_id_token(_id_token(**_valid_claims(exp=int(time.time()) - 1))) is None


def test_unverified_email_is_rejected():
    """Google will hand out tokens for unverified addresses; we must not accept
    them, or anyone could claim someone else's email."""
    assert oauth.parse_id_token(_id_token(**_valid_claims(email_verified=False))) is None


def test_missing_email_claim_is_rejected():
    claims = _valid_claims()
    del claims["email"]
    assert oauth.parse_id_token(_id_token(**claims)) is None


@pytest.mark.parametrize(
    "token",
    [
        "",  # empty
        "not-a-jwt",  # no dots at all
        "header.!!!not-base64!!!.sig",  # undecodable payload
        "header." + base64.urlsafe_b64encode(b"not json").decode().rstrip("=") + ".sig",
    ],
    ids=["empty", "no-dots", "bad-base64", "not-json"],
)
def test_malformed_tokens_return_none_instead_of_raising(token):
    assert oauth.parse_id_token(token) is None


# -- code exchange ---------------------------------------------------------


def test_exchange_code_posts_the_verifier_and_returns_the_token_response(monkeypatch):
    seen: dict = {}

    def fake_post(url, data=None, timeout=None):
        seen["url"] = url
        seen["data"] = data
        seen["timeout"] = timeout
        # a request must be attached, otherwise raise_for_status() cannot run
        return httpx.Response(
            200, json={"id_token": "abc", "access_token": "xyz"}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    assert oauth.exchange_code("the-code", "the-verifier") == {"id_token": "abc", "access_token": "xyz"}
    assert seen["url"] == oauth.TOKEN_ENDPOINT
    assert seen["data"]["code"] == "the-code"
    assert seen["data"]["code_verifier"] == "the-verifier"
    assert seen["data"]["grant_type"] == "authorization_code"
    assert seen["data"]["client_secret"] == get_settings().google_client_secret
    assert seen["timeout"], "a hanging token exchange would pin a worker"


def test_exchange_code_raises_on_a_google_error(monkeypatch):
    """A 4xx must not be mistaken for an empty-but-successful token response."""
    monkeypatch.setattr(
        oauth.httpx, "post",
        lambda url, data=None, timeout=None: httpx.Response(
            400, json={"error": "invalid_grant"}, request=httpx.Request("POST", url)
        ),
    )
    with pytest.raises(httpx.HTTPStatusError):
        oauth.exchange_code("stale-code", "verifier")
