"""Anthropic client lifecycle — the BYOK leak guard.

`client_for()` exists because a per-request `AsyncAnthropic` owns an httpx
connection pool: creating one per generation and never closing it exhausts the
process's file descriptors after a few weeks of uptime (found 2026-07-27, four
call sites were leaking). The two halves of the contract pull in opposite
directions and are easy to break in either direction:

  * a throwaway BYOK client MUST be closed,
  * the shared project client MUST NOT be — closing it breaks every later call.

Both are asserted here, plus the source-level rule that no new code may reach
for `get_client(api_key)` behind the context manager's back.

Async is driven with `asyncio.run` to match the house style (no pytest-asyncio).
"""

import asyncio
import subprocess
from pathlib import Path

import pytest

from app.services import ai

BACKEND_DIR = Path(__file__).resolve().parent.parent


class FakeClient:
    """Stands in for AsyncAnthropic — records construction and closing."""

    created: list["FakeClient"] = []
    list_error: Exception | None = None

    def __init__(self, api_key=None, max_retries=None):
        self.api_key = api_key
        self.max_retries = max_retries
        self.closed = False
        self.models = self._Models(self)
        FakeClient.created.append(self)

    async def close(self):
        self.closed = True

    class _Models:
        def __init__(self, owner):
            self.owner = owner

        async def list(self, limit=None):
            if type(self.owner).list_error:
                raise type(self.owner).list_error
            return {"data": []}


@pytest.fixture()
def fake_anthropic(monkeypatch):
    FakeClient.created = []
    FakeClient.list_error = None
    monkeypatch.setattr(ai, "AsyncAnthropic", FakeClient)
    monkeypatch.setattr(ai, "_client", None)  # no leakage between tests
    return FakeClient


def test_byok_client_is_closed_after_the_call(fake_anthropic):
    async def run():
        async with ai.client_for("sk-ant-user-key") as client:
            assert client.api_key == "sk-ant-user-key"
            assert client.closed is False
        return client

    client = asyncio.run(run())
    assert client.closed is True, "a leaked pool costs a file descriptor per generation"


def test_byok_client_is_closed_even_when_the_call_explodes(fake_anthropic):
    """A failed generation is exactly when a leak would go unnoticed."""

    async def run():
        holder = {}
        try:
            async with ai.client_for("sk-ant-user-key") as client:
                holder["client"] = client
                raise RuntimeError("stream died")
        except RuntimeError:
            pass
        return holder["client"]

    assert asyncio.run(run()).closed is True


def test_the_shared_client_is_never_closed(fake_anthropic):
    """Closing the pooled project client would break every subsequent request
    in the process — it is yielded untouched."""

    async def run():
        async with ai.client_for(None) as first:
            pass
        async with ai.client_for(None) as second:
            pass
        return first, second

    first, second = asyncio.run(run())
    assert first.closed is False
    assert second is first, "the project client is pooled, not rebuilt per call"


def test_a_byok_client_is_never_pooled(fake_anthropic):
    """Caching per key would keep other people's credentials in memory for the
    lifetime of the process."""

    async def run():
        async with ai.client_for("sk-ant-a") as a:
            pass
        async with ai.client_for("sk-ant-a") as b:
            pass
        return a, b

    a, b = asyncio.run(run())
    assert a is not b


def test_an_empty_key_falls_back_to_the_project_client(fake_anthropic):
    """`""` and `None` must behave the same: a user who cleared their key gets
    the project client and the normal daily limits, not a keyless client."""

    async def run():
        async with ai.client_for("") as client:
            pass
        return client

    client = asyncio.run(run())
    assert client.closed is False
    assert client is ai.get_client()


# -- key verification ------------------------------------------------------


def test_verify_key_accepts_a_working_key(fake_anthropic):
    assert asyncio.run(ai.verify_key("sk-ant-good")) is True
    assert fake_anthropic.created[-1].closed is True


def test_verify_key_rejects_anything_that_raises(fake_anthropic):
    """Any failure means "unusable" — we deliberately do not distinguish a
    revoked key from a network blip, because the user can only do one thing
    about it either way."""
    fake_anthropic.list_error = RuntimeError("401 invalid x-api-key")
    assert asyncio.run(ai.verify_key("sk-ant-bad")) is False
    assert fake_anthropic.created[-1].closed is True, "the probe client leaks too if unclosed"


def test_verify_key_disables_retries(fake_anthropic):
    """Validating a key is interactive: three silent retries against a dead key
    would leave the user staring at a spinner."""
    asyncio.run(ai.verify_key("sk-ant-good"))
    assert fake_anthropic.created[-1].max_retries == 0


def test_verify_key_never_touches_the_shared_client(fake_anthropic):
    """Probing a stranger's key must not disturb the project client."""

    async def run():
        async with ai.client_for(None) as project:
            pass
        await ai.verify_key("sk-ant-someone-else")
        return project

    assert asyncio.run(run()).closed is False


# -- source-level rule -----------------------------------------------------


def test_no_call_site_bypasses_the_context_manager():
    """`get_client(<key>)` builds a client nobody closes. The context manager is
    the only sanctioned way in; this is the guard that keeps it that way."""
    hits = subprocess.run(
        ["grep", "-rn", "--include=*.py", "get_client(", "app"],
        cwd=BACKEND_DIR, capture_output=True, text=True,
    ).stdout.splitlines()

    # Guard the guard: a wrong cwd or a renamed module would leave `hits` empty
    # and the assertion below would pass without having checked anything.
    assert any("def get_client(" in line for line in hits), "grep found nothing — the check is not running"

    offenders = [
        line for line in hits
        if not line.startswith("app/services/ai.py")  # the definition + its own use
        and "get_client()" not in line  # the no-argument form is fine
    ]
    assert offenders == [], f"use `async with ai.client_for(key)` instead: {offenders}"


def test_get_client_with_a_key_still_builds_an_unpooled_client(fake_anthropic):
    """The BYOK branch of `get_client` is kept as the primitive that
    `client_for` is built on. It hands back a client nobody has closed — which
    is precisely why the rule above forbids calling it directly."""
    a = ai.get_client("sk-ant-x")
    b = ai.get_client("sk-ant-x")
    assert a is not b
    assert a.api_key == "sk-ant-x"
    assert a.closed is False
    assert ai._client is None, "a BYOK client must never become the shared one"
