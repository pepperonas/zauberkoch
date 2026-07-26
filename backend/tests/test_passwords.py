"""Password hashing + strength policy (services/passwords.py) — pure, no DB."""

import pytest

from app.services import auth_tokens
from app.services.passwords import (
    MIN_PASSWORD_LENGTH,
    PasswordError,
    hash_password,
    validate_password,
    verify_password,
)


def test_hash_roundtrip_and_uniqueness():
    a = hash_password("Sicher123!")
    b = hash_password("Sicher123!")
    assert a != b  # random per-hash salt
    assert a.startswith("scrypt$")
    assert verify_password("Sicher123!", a)
    assert verify_password("Sicher123!", b)
    assert not verify_password("Sicher123?", a)


def test_verify_missing_or_garbage_stored():
    assert not verify_password("whatever", None)  # no account -> False, still hashes
    assert not verify_password("whatever", "not-a-valid-format")
    assert not verify_password("whatever", "scrypt$bad")


def test_strength_policy():
    with pytest.raises(PasswordError, match="mindestens"):
        validate_password("Ab1!")  # too short
    with pytest.raises(PasswordError, match="mische"):
        validate_password("nurbuchstaben")  # single class
    with pytest.raises(PasswordError, match="E-Mail"):
        validate_password("alice12345", email="alice@example.com")  # contains local part
    validate_password("Sicher123!")  # ok
    validate_password("a" * (MIN_PASSWORD_LENGTH) + "1")  # letters+digits ok


class _FakeUser:
    def __init__(self, uid, pw_hash=None):
        self.id = uid
        self.password_hash = pw_hash


def test_verify_token_roundtrip_and_purpose_separation():
    user = _FakeUser(7)
    vt = auth_tokens.make_verify_token(user)
    assert auth_tokens.read_verify_token(vt) == 7
    # a reset token must NOT validate as a verify token
    rt = auth_tokens.make_reset_token(user)
    assert auth_tokens.read_verify_token(rt) is None
    assert auth_tokens.read_verify_token("garbage.sig") is None


def test_reset_token_dies_when_password_changes():
    user = _FakeUser(9, pw_hash=hash_password("OldPass1!"))
    token = auth_tokens.make_reset_token(user)
    lookup = lambda uid: user if uid == 9 else None  # noqa: E731
    assert auth_tokens.read_reset_token(token, lookup) is user
    # simulate the password having been changed -> old token no longer matches
    user.password_hash = hash_password("NewPass2!")
    assert auth_tokens.read_reset_token(token, lookup) is None
    # a verify token can't be used as a reset token
    assert auth_tokens.read_reset_token(auth_tokens.make_verify_token(user), lookup) is None
