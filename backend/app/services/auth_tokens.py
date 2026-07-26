"""Stateless email-verification & password-reset tokens.

Built on the existing HMAC ``sign_payload``/``unsign_payload`` helper, so there
is no token table to maintain. Security properties:

* **Signed + timestamped** — tampering or an expired link fails verification.
* **Purpose-bound** — a verify token can't be replayed as a reset token.
* **Single-use-ish reset** — the reset token embeds a fingerprint of the
  current password hash; the moment the password changes (i.e. the link is
  used, or any newer link is used) every older reset token stops matching.
* **Verify is idempotent** — safe to click twice; the endpoint no-ops once the
  address is already confirmed.
"""

from __future__ import annotations

import hashlib

from app.core.security import sign_payload, unsign_payload
from app.models import User

VERIFY_MAX_AGE_S = 24 * 3600
RESET_MAX_AGE_S = 3600  # 1 hour

_PURPOSE_VERIFY = "verify"
_PURPOSE_RESET = "reset"


def _password_fingerprint(user: User) -> str:
    """Short, non-reversible marker of the current password state. Changes
    whenever the password changes, which retires older reset links."""
    return hashlib.sha256((user.password_hash or "none").encode()).hexdigest()[:16]


def make_verify_token(user: User) -> str:
    return sign_payload({"uid": user.id, "p": _PURPOSE_VERIFY})


def make_reset_token(user: User) -> str:
    return sign_payload({"uid": user.id, "p": _PURPOSE_RESET, "fp": _password_fingerprint(user)})


def read_verify_token(token: str) -> int | None:
    data = unsign_payload(token, max_age_s=VERIFY_MAX_AGE_S)
    if not data or data.get("p") != _PURPOSE_VERIFY:
        return None
    uid = data.get("uid")
    return uid if isinstance(uid, int) else None


def read_reset_token(token: str, user_lookup) -> User | None:
    """Return the user iff the token is a valid, unexpired reset token whose
    fingerprint still matches the account's current password. `user_lookup`
    maps a user id -> User|None."""
    data = unsign_payload(token, max_age_s=RESET_MAX_AGE_S)
    if not data or data.get("p") != _PURPOSE_RESET:
        return None
    uid = data.get("uid")
    if not isinstance(uid, int):
        return None
    user = user_lookup(uid)
    if user is None or data.get("fp") != _password_fingerprint(user):
        return None
    return user
