"""Authenticated encryption for third-party secrets at rest (AES-256-GCM).

Used for user-supplied Anthropic API keys. Those are other people's money, so
the rules are stricter than for our own data:

* AEAD, not a home-made construction — a tampered ciphertext must fail loudly,
  not decrypt to garbage that we then send to Anthropic.
* Random 96-bit nonce per encryption; never reused, never derived from content.
* The wrapping key comes from `BYOK_SECRET` if set, otherwise it is derived
  from `SESSION_SECRET` via HKDF with its own info label — so the same bytes
  can never serve as both a session signer and a data key.
* Plaintext keys never reach a log, an API response or the data export.

Rotating the secret makes stored keys undecryptable; users then simply enter
their key again (`decrypt` returns None instead of raising, so the app treats
it as "no key stored").
"""

import base64
import logging
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings

logger = logging.getLogger("zauberkoch.secretbox")

_PREFIX = "v1"
_NONCE_BYTES = 12
_INFO = b"zauberkoch:byok:v1"


def _wrapping_key() -> bytes:
    settings = get_settings()
    base = (getattr(settings, "byok_secret", "") or settings.session_secret).encode()
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_INFO).derive(base)


def encrypt(plaintext: str) -> str:
    """-> "v1$<nonce-b64>$<ciphertext-b64>" (ciphertext includes the GCM tag)."""
    nonce = os.urandom(_NONCE_BYTES)
    ct = AESGCM(_wrapping_key()).encrypt(nonce, plaintext.encode(), None)
    return f"{_PREFIX}${base64.b64encode(nonce).decode()}${base64.b64encode(ct).decode()}"


def decrypt(token: str | None) -> str | None:
    """Plaintext, or None if the token is missing, malformed, tampered with, or
    was written under a different secret. Never raises — a stored key we cannot
    read is operationally the same as no stored key."""
    if not token:
        return None
    try:
        version, nonce_b64, ct_b64 = token.split("$", 2)
        if version != _PREFIX:
            return None
        plain = AESGCM(_wrapping_key()).decrypt(
            base64.b64decode(nonce_b64), base64.b64decode(ct_b64), None
        )
        return plain.decode()
    except (InvalidTag, ValueError, TypeError):
        # No key material, no ciphertext, no detail in the log.
        logger.warning("stored secret could not be decrypted (tampered or secret rotated)")
        return None
