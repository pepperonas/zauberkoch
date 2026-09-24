"""Handing a finished Google login from the system browser into the app.

Google refuses OAuth inside an embedded WebView (``disallowed_useragent``), so
the native shell opens the flow in a Custom Tab. The session cookie the
callback sets therefore lands in the BROWSER's cookie jar, which the app
cannot read. This module carries the finished session across that gap.

**The part that matters: an Android custom scheme is not exclusive.** Any app
may register ``zauberkoch://``, so the redirect carrying the handoff token can
be intercepted. The token alone is deliberately useless: the app invents a
random ``verifier`` *before* opening the browser and sends only its SHA-256
(the ``challenge``) into the flow. Redeeming requires the verifier, which
never leaves the app. That is the PKCE idea applied to our own handoff — the
same construction the Google leg already uses one layer down.

**Stateless by design** (house pattern, see ``auth_tokens.py``): an
HMAC-signed payload, so there is no token table to maintain or prune. Replay
is bounded three ways — a two-minute lifetime, the session still having to
exist (a logout deletes it), and the verifier an interceptor does not have.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from urllib.parse import urlencode

from app.core.security import sign_payload, unsign_payload

#: The app returns within seconds; anything longer is only replay surface.
HANDOFF_MAX_AGE_S = 120

#: Custom URL scheme the app registers. Three places must agree, and a test
#: pins all three: here, ``frontend/src/native/nativeRules.ts`` and the Android
#: ``custom_url_scheme`` string resource. A mismatch is invisible in the
#: browser and breaks login in the shipped app only.
LOGIN_SCHEME = "io.celox.zauberkoch"

_PURPOSE = "native"

#: base64url of a SHA-256 digest, unpadded — 43 chars, no '=' and no '+/'.
_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

#: A verifier shorter than this cannot carry meaningful entropy. The app sends
#: 32 random bytes; the floor only stops a caller from binding a handoff to a
#: guessable secret (e.g. the empty string).
MIN_VERIFIER_LEN = 32


def challenge_for(verifier: str) -> str:
    """Fingerprint of the app's secret. Must stay character-identical to
    ``challengeOf`` in the frontend's ``native/nativeRules.ts`` — otherwise the
    app can never prove ownership and every native login fails."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def is_valid_challenge(challenge: str) -> bool:
    """Reject anything that is not shaped like our own fingerprint, so junk
    never reaches the signed state cookie."""
    return bool(_CHALLENGE_RE.match(challenge))


def make_handoff_token(session_id: int, challenge: str) -> str:
    return sign_payload({"p": _PURPOSE, "sid": session_id, "ch": challenge})


def read_handoff_token(token: str, verifier: str) -> int | None:
    """Session id iff the token is ours, unexpired, and the caller can produce
    the secret behind the challenge it was minted with. Returns None otherwise
    — callers must not distinguish the reasons to a client."""
    if len(verifier) < MIN_VERIFIER_LEN:
        return None
    data = unsign_payload(token, max_age_s=HANDOFF_MAX_AGE_S)
    if not data or data.get("p") != _PURPOSE:
        return None
    challenge = data.get("ch")
    if not isinstance(challenge, str):
        return None
    # compare_digest, not ==: the challenge is a secret-derived value and the
    # comparison happens on every redeem attempt.
    if not hmac.compare_digest(challenge, challenge_for(verifier)):
        return None
    sid = data.get("sid")
    return sid if isinstance(sid, int) else None


def deep_link(*, token: str = "", error: str = "") -> str:
    """Where the OAuth callback sends a native run. Exactly one of token or
    error is carried; the app closes the Custom Tab either way, so the failure
    case needs its own link rather than the web error page (which would leave
    the browser sitting in front of the app)."""
    from urllib.parse import urlencode

    query = urlencode({"t": token} if token else {"error": error or "failed"})
    return f"{LOGIN_SCHEME}://login?{query}"
