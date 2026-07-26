"""Password hashing + strength validation.

Uses stdlib ``hashlib.scrypt`` (memory-hard KDF) with a per-hash random salt —
no third-party dependency. Stored format is self-describing so parameters can
be raised later without breaking existing hashes:

    scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

# Interactive-login parameters: ~64 MB, well under a second on the VPS.
_N = 2**15
_R = 8
_P = 1
_DKLEN = 32
_SALT_BYTES = 16

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128  # bound the scrypt input (DoS guard)


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=128 * 1024 * 1024)
    return f"scrypt${_N}${_R}${_P}${_b64e(salt)}${_b64e(dk)}"


def verify_password(password: str, stored: str | None) -> bool:
    """Timing-safe verification. Always runs a hash (even for a missing/garbage
    stored value) so a missing account can't be told apart by response time."""
    fallback = f"scrypt${_N}${_R}${_P}${_b64e(b'0' * _SALT_BYTES)}${_b64e(b'0' * _DKLEN)}"
    candidate = stored or fallback
    try:
        scheme, n, r, p, salt_b64, hash_b64 = candidate.split("$")
        if scheme != "scrypt":
            raise ValueError
        dk = hashlib.scrypt(
            password.encode(), salt=_b64d(salt_b64), n=int(n), r=int(r), p=int(p),
            dklen=len(_b64d(hash_b64)), maxmem=128 * 1024 * 1024,
        )
        ok = hmac.compare_digest(dk, _b64d(hash_b64))
    except (ValueError, TypeError):
        ok = False
    # Never validate against the fallback hash of a real password attempt.
    return ok and stored is not None


class PasswordError(ValueError):
    """Raised with a user-facing German message for a weak/invalid password."""


def validate_password(password: str, *, email: str = "") -> None:
    """Enforce a pragmatic strength policy. Raises PasswordError on failure."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordError(f"Das Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise PasswordError(f"Das Passwort darf höchstens {MAX_PASSWORD_LENGTH} Zeichen lang sein.")
    classes = sum(
        bool(match) for match in (
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() for c in password),
        )
    )
    if classes < 2:
        raise PasswordError("Bitte mische Buchstaben mit Zahlen oder Sonderzeichen.")
    local = email.split("@", 1)[0].lower().strip()
    if local and len(local) >= 3 and local in password.lower():
        raise PasswordError("Das Passwort darf nicht deine E-Mail-Adresse enthalten.")
