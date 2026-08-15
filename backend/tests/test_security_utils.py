"""Signed-payload helpers (OAuth state cookie) + cache key normalization."""

import time

import pytest

from app.core.security import sign_payload, unsign_payload
from app.schemas.recipe import GenerateParams
from app.services.cache import params_hash


def test_sign_unsign_roundtrip():
    data = {"state": "abc", "verifier": "xyz"}
    assert unsign_payload(sign_payload(data)) == data


def test_tampered_signature_rejected():
    token = sign_payload({"state": "abc"})
    body, sig = token.split(".", 1)
    assert unsign_payload(f"{body}.{'0' * len(sig)}") is None
    assert unsign_payload(f"{body}x.{sig}") is None
    assert unsign_payload("garbage") is None
    assert unsign_payload("") is None


def test_expired_payload_rejected(monkeypatch):
    token = sign_payload({"state": "abc"})
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() + 700)  # > 600s max_age
    assert unsign_payload(token) is None


def test_params_hash_is_order_and_case_invariant():
    a = GenerateParams(modus="kochen", kueche="Thai", geschmack=["scharf", "frisch"], vorhandene_zutaten=["Reis", "Ei"])
    b = GenerateParams(modus="kochen", kueche="  THAI ", geschmack=["Frisch", "SCHARF"], vorhandene_zutaten=["ei", " reis "])
    assert params_hash(a) == params_hash(b)


def test_params_hash_ignores_meta_but_not_content():
    base = GenerateParams(modus="kochen", kueche="Thai")
    assert params_hash(base) == params_hash(GenerateParams(modus="kochen", kueche="Thai", regenerate=True))
    # personen = pure scaling, never a new dish -> same cache key
    assert params_hash(base) == params_hash(GenerateParams(modus="kochen", kueche="Thai", personen=6))
    assert params_hash(base) != params_hash(GenerateParams(modus="kochen", kueche="Indisch"))
    assert params_hash(base) != params_hash(GenerateParams(modus="kochen", kueche="Thai", vegan=True))


# -- malformed tokens ------------------------------------------------------
# unsign_payload() guards the OAuth state cookie and both email-token flows.
# Every branch that returns None is a rejection an attacker gets to probe, so
# each one is asserted separately rather than as one "garbage is rejected".


@pytest.mark.parametrize(
    "token",
    [
        "",  # empty cookie
        "nodothere",  # no separator
        "onlybody.",  # empty signature
        ".onlysig",  # empty body
        "!!!.badbase64",  # signature mismatch first
    ],
    ids=["empty", "no-dot", "empty-sig", "empty-body", "junk"],
)
def test_malformed_tokens_are_rejected_without_raising(token):
    assert unsign_payload(token) is None


def test_a_correctly_signed_but_undecodable_body_is_rejected():
    """Signature valid, payload garbage — reached by anyone who obtains the
    signing secret's output for arbitrary bytes. Must not raise."""
    import hashlib
    import hmac

    from app.core.config import get_settings

    body = "!!!not-base64!!!"
    sig = hmac.new(get_settings().session_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    assert unsign_payload(f"{body}.{sig}") is None


def test_signature_is_compared_for_the_whole_body():
    """A prefix match would let a truncated body through."""
    token = sign_payload({"state": "abc"})
    body, sig = token.split(".", 1)
    assert unsign_payload(f"{body[:-4]}.{sig}") is None


def test_a_token_signed_with_another_secret_is_rejected(monkeypatch):
    """Rotating SESSION_SECRET must invalidate every outstanding link."""
    from app.core.config import get_settings

    token = sign_payload({"uid": 1})
    monkeypatch.setattr(get_settings(), "session_secret", "a-different-secret")
    assert unsign_payload(token) is None


def test_max_age_is_enforced_per_call(monkeypatch):
    """Verify links live 24 h, reset links 1 h — the same helper serves both,
    so the age must come from the caller and not from a shared default."""
    token = sign_payload({"uid": 1})

    half_an_hour_later = time.time() + 1800
    monkeypatch.setattr(time, "time", lambda: half_an_hour_later)

    assert unsign_payload(token, max_age_s=3600) == {"uid": 1}  # still inside 1 h
    assert unsign_payload(token, max_age_s=600) is None  # outside 10 min
