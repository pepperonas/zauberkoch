"""Bring-your-own-key: a user may store their own Anthropic API key.

While a key is stored, that account generates on its own bill — and therefore
without our daily caps, because the caps exist only to bound OUR spending.

Handling rules (all enforced here so no caller has to remember them):
* The plaintext key exists in memory for the duration of one request. It is
  stored AES-256-GCM encrypted and never returned by any endpoint.
* Only a 4-character `hint` leaves the server, so the UI can show WHICH key is
  stored without being able to use it.
* A key that no longer decrypts (secret rotated, row tampered with) counts as
  "no key": the account falls back to our key and our limits rather than
  failing to cook.
"""

import re

from app.models import User
from app.services import secretbox

# Anthropic keys look like `sk-ant-api03-...`. Checked before we spend a round
# trip on validation, and to keep obvious typos out of the database.
_KEY_RE = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{20,250}$")

MIN_HINT_CHARS = 4


def looks_like_key(candidate: str) -> bool:
    return bool(_KEY_RE.match(candidate.strip()))


def hint_for(key: str) -> str:
    """Last 4 characters — enough to recognise a key, useless to abuse."""
    return key.strip()[-MIN_HINT_CHARS:]


def store_key(user: User, key: str, now) -> None:
    clean = key.strip()
    user.anthropic_key_enc = secretbox.encrypt(clean)
    user.anthropic_key_hint = hint_for(clean)
    user.anthropic_key_set_at = now


def clear_key(user: User) -> None:
    user.anthropic_key_enc = None
    user.anthropic_key_hint = ""
    user.anthropic_key_set_at = None


def key_for(user: User | None) -> str | None:
    """The user's usable plaintext key, or None. This is THE predicate for
    "unlimited": every limit check asks it, so the two can never drift apart."""
    if user is None:
        return None
    return secretbox.decrypt(user.anthropic_key_enc)


def status_for(user: User) -> dict:
    """Safe-to-serialise state for /me and the data export."""
    active = bool(secretbox.decrypt(user.anthropic_key_enc))
    return {
        "active": active,
        "hint": user.anthropic_key_hint if active else "",
        "since": user.anthropic_key_set_at.isoformat() if (active and user.anthropic_key_set_at) else None,
    }
