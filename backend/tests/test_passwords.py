"""Password hashing + strength policy (services/passwords.py) — pure, no DB."""

import pytest

from app.services import auth_tokens, passwords
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


# -- policy edges ----------------------------------------------------------


def test_overlong_password_is_refused_rather_than_hashed():
    """scrypt is memory-hard by design; an unbounded input is a cheap way to
    make the server do 64 MB of work per request."""
    with pytest.raises(passwords.PasswordError) as exc:
        passwords.validate_password("Aa1" + "x" * passwords.MAX_PASSWORD_LENGTH)
    assert str(passwords.MAX_PASSWORD_LENGTH) in str(exc.value)


@pytest.mark.parametrize(
    "password",
    ["nurkleinbuchstaben", "NURGROSSBUCHSTABEN", "1234567890", "!!!!!!!!!!"],
)
def test_a_single_character_class_is_refused(password):
    with pytest.raises(passwords.PasswordError):
        passwords.validate_password(password)


@pytest.mark.parametrize(
    "password",
    ["kleinundGROSS", "kleinund1234", "kleinund!!!!", "GROSSUND1234"],
)
def test_two_classes_are_enough(password):
    passwords.validate_password(password)  # must not raise


def test_password_may_not_contain_the_email_local_part():
    with pytest.raises(passwords.PasswordError):
        passwords.validate_password("martin1234!", email="martin@example.com")


def test_the_email_check_is_case_insensitive():
    with pytest.raises(passwords.PasswordError):
        passwords.validate_password("MARTIN1234!", email="martin@example.com")


def test_a_very_short_local_part_is_not_enforced():
    """Banning "ab" would reject a huge share of legitimate passwords for
    anyone whose address starts with two letters."""
    passwords.validate_password("abcdefgh1", email="ab@example.com")


def test_the_domain_is_not_part_of_the_rule():
    """Only the local part is personal; "example" is shared by thousands."""
    passwords.validate_password("example123", email="martin@example.com")


def test_minimum_length_is_a_boundary_not_a_range():
    with pytest.raises(passwords.PasswordError):
        passwords.validate_password("Ab1" + "x" * (passwords.MIN_PASSWORD_LENGTH - 4))
    passwords.validate_password("Ab1" + "x" * (passwords.MIN_PASSWORD_LENGTH - 3))


# -- verification against malformed stored values --------------------------


@pytest.mark.parametrize(
    "stored",
    [
        "bcrypt$1$2$3$c2FsdA$aGFzaA",  # a different scheme
        "scrypt$notanumber$8$1$c2FsdA$aGFzaA",  # unparseable parameters
        "scrypt$32768$8$1$c2FsdA",  # too few fields
        "",  # empty string, not None
    ],
    ids=["wrong-scheme", "bad-params", "short", "empty"],
)
def test_garbage_stored_values_verify_as_false_without_raising(stored):
    """A corrupted row must fail the login, not 500 the endpoint."""
    assert passwords.verify_password("irgendwas", stored) is False


def test_a_correct_password_still_fails_when_no_hash_is_stored():
    """Google-only accounts have password_hash = None. The fallback hash exists
    purely to burn the same CPU time; matching it must never authenticate."""
    assert passwords.verify_password("egal", None) is False


# -- stateless token edges -------------------------------------------------


class _TokenUser:
    """Minimal stand-in — auth_tokens only reads `id` and `password_hash`."""

    def __init__(self, uid=1, password_hash="scrypt$x"):
        self.id = uid
        self.password_hash = password_hash


def test_a_verify_token_cannot_be_replayed_as_a_reset_token():
    """Both are signed with the same secret; only the purpose claim separates
    them. Without that check, the (long-lived, emailed) verify link would be a
    password-reset link."""
    user = _TokenUser()
    verify = auth_tokens.make_verify_token(user)
    assert auth_tokens.read_reset_token(verify, lambda uid: user) is None


def test_a_reset_token_cannot_be_replayed_as_a_verify_token():
    user = _TokenUser()
    reset = auth_tokens.make_reset_token(user)
    assert auth_tokens.read_verify_token(reset) is None


def test_a_reset_token_for_a_deleted_account_resolves_to_nothing():
    user = _TokenUser()
    token = auth_tokens.make_reset_token(user)
    assert auth_tokens.read_reset_token(token, lambda uid: None) is None


def test_a_reset_link_dies_the_moment_the_password_changes():
    """This is what makes the link single-use: it embeds a fingerprint of the
    hash it was issued against."""
    user = _TokenUser(password_hash="scrypt$old")
    token = auth_tokens.make_reset_token(user)
    assert auth_tokens.read_reset_token(token, lambda uid: user) is user

    user.password_hash = "scrypt$new"
    assert auth_tokens.read_reset_token(token, lambda uid: user) is None


def test_a_reset_link_works_for_an_account_that_had_no_password():
    """Google-only accounts have password_hash = None — "forgot password" has
    to be able to set the first one."""
    user = _TokenUser(password_hash=None)
    token = auth_tokens.make_reset_token(user)
    assert auth_tokens.read_reset_token(token, lambda uid: user) is user


def test_garbage_tokens_resolve_to_nothing():
    for token in ("", "nonsense", "a.b"):
        assert auth_tokens.read_verify_token(token) is None
        assert auth_tokens.read_reset_token(token, lambda uid: _TokenUser()) is None


def test_reset_tokens_expire_sooner_than_verify_tokens():
    """A reset link is the more dangerous of the two and must not inherit the
    24-hour window."""
    assert auth_tokens.RESET_MAX_AGE_S < auth_tokens.VERIFY_MAX_AGE_S


# -- reset request body ----------------------------------------------------


def test_reset_body_rejects_mismatched_confirmation():
    from app.schemas.auth import ResetBody

    body = ResetBody(token="t", password="Sicher123!", password_confirm="Sicher123?")
    with pytest.raises(PasswordError):
        body.check()


def test_reset_body_still_applies_the_strength_policy():
    """Typing the same weak password twice must not pass."""
    from app.schemas.auth import ResetBody

    body = ResetBody(token="t", password="kurz", password_confirm="kurz")
    with pytest.raises(PasswordError):
        body.check()


def test_reset_body_accepts_a_matching_strong_pair():
    from app.schemas.auth import ResetBody

    ResetBody(token="t", password="Sicher123!", password_confirm="Sicher123!").check()


def test_a_forged_token_with_a_non_numeric_user_id_is_rejected():
    """`uid` is trusted enough to be looked up in the DB. A signed payload can
    only be produced with the server secret, but the type check is the last
    line of defence if that ever leaks — and it keeps a string from reaching
    the ORM."""
    from app.core.security import sign_payload

    forged_verify = sign_payload({"uid": "1 OR 1=1", "p": "verify"})
    forged_reset = sign_payload({"uid": ["1"], "p": "reset", "fp": "x"})

    assert auth_tokens.read_verify_token(forged_verify) is None
    assert auth_tokens.read_reset_token(forged_reset, lambda uid: _TokenUser()) is None
