"""Bring-your-own-key: encryption at rest, the "never leaves the server"
promise, and the unlimited path.

The security assertions here are the point of the file. A regression that
leaks a stored key or silently keeps charging our budget would be invisible in
normal use — these tests are what make it loud.
"""

import pytest
from sqlalchemy import select

from app.models import Generation, RateLimit, User
from app.services import byok, secretbox
from app.services import ratelimit_ip
from tests.test_auth import add_to_allowlist, do_login_callback  # noqa: F401
from tests.test_generation import PARAMS, generate, logged_in, mock_ai, parse_sse  # noqa: F401

KEY = "sk-ant-api03-" + "A" * 60
OTHER_KEY = "sk-ant-api03-" + "B" * 60


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture()
def accept_keys(monkeypatch):
    """Anthropic says yes — no network in tests."""
    async def ok(_key: str) -> bool:
        return True

    monkeypatch.setattr("app.api.v1.me.ai.verify_key", ok)


def _set_key(client, headers, key=KEY):
    return client.put("/api/v1/me/anthropic-key", json={"key": key}, headers=headers)


class TestSecretbox:
    def test_roundtrip(self):
        assert secretbox.decrypt(secretbox.encrypt(KEY)) == KEY

    def test_ciphertext_does_not_contain_the_plaintext(self):
        token = secretbox.encrypt(KEY)
        assert KEY not in token
        assert KEY[-10:] not in token

    def test_every_encryption_uses_a_fresh_nonce(self):
        """Same input twice must not produce the same ciphertext — otherwise
        the database would reveal which users share a key."""
        assert secretbox.encrypt(KEY) != secretbox.encrypt(KEY)

    def test_tampering_is_detected(self):
        token = secretbox.encrypt(KEY)
        version, nonce, ct = token.split("$", 2)
        flipped = ct[:-6] + ("A" if ct[-6] != "A" else "B") + ct[-5:]
        assert secretbox.decrypt(f"{version}${nonce}${flipped}") is None

    def test_garbage_and_empty_return_none_instead_of_raising(self):
        for bad in (None, "", "nonsense", "v1$$", "v2$abc$def"):
            assert secretbox.decrypt(bad) is None

    def test_rotated_secret_yields_none_not_a_wrong_key(self, monkeypatch):
        token = secretbox.encrypt(KEY)
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "byok_secret", "a-different-wrapping-secret")
        assert secretbox.decrypt(token) is None


class TestKeyFormat:
    @pytest.mark.parametrize("bad", ["", "hello", "sk-1234", "sk-ant-", "sk-ant-" + "x" * 300])
    def test_rejects_non_keys(self, bad):
        assert byok.looks_like_key(bad) is False

    def test_accepts_a_real_looking_key(self):
        assert byok.looks_like_key(KEY) is True

    def test_hint_is_only_the_last_four_characters(self):
        assert byok.hint_for(KEY) == KEY[-4:]
        assert len(byok.hint_for(KEY)) == 4


class TestEndpoints:
    def test_set_requires_csrf(self, client, logged_in, accept_keys):
        assert client.put("/api/v1/me/anthropic-key", json={"key": KEY}).status_code == 403

    def test_malformed_key_is_refused_without_calling_anthropic(self, client, logged_in, monkeypatch):
        called = {"n": 0}

        async def spy(_key):
            called["n"] += 1
            return True

        monkeypatch.setattr("app.api.v1.me.ai.verify_key", spy)
        assert _set_key(client, logged_in, "not-a-key").status_code == 422
        assert called["n"] == 0, "format check must come before the round trip"

    def test_key_anthropic_rejects_is_not_stored(self, client, logged_in, db_session, monkeypatch):
        async def nope(_key):
            return False

        monkeypatch.setattr("app.api.v1.me.ai.verify_key", nope)
        assert _set_key(client, logged_in).status_code == 422
        user = db_session.execute(select(User)).scalar_one()
        assert user.anthropic_key_enc is None

    def test_stored_key_is_encrypted_and_readable_back(self, client, logged_in, db_session, accept_keys):
        assert _set_key(client, logged_in).status_code == 200
        db_session.expire_all()
        user = db_session.execute(select(User)).scalar_one()
        assert user.anthropic_key_enc and KEY not in user.anthropic_key_enc
        assert byok.key_for(user) == KEY

    def test_me_exposes_status_but_never_the_key(self, client, logged_in, accept_keys):
        _set_key(client, logged_in)
        me = client.get("/api/v1/me").json()
        assert me["own_key"]["active"] is True
        assert me["own_key"]["hint"] == KEY[-4:]
        assert KEY not in str(me)

    def test_export_never_contains_the_key(self, client, logged_in, accept_keys):
        _set_key(client, logged_in)
        raw = client.get("/api/v1/me/export").text
        assert KEY not in raw
        assert "sk-ant-" not in raw
        assert '"aktiv": true' in raw.replace("'", '"')

    def test_delete_clears_it(self, client, logged_in, db_session, accept_keys):
        _set_key(client, logged_in)
        r = client.delete("/api/v1/me/anthropic-key", headers=logged_in)
        assert r.status_code == 200 and r.json()["active"] is False
        db_session.expire_all()
        user = db_session.execute(select(User)).scalar_one()
        assert user.anthropic_key_enc is None and user.anthropic_key_hint == ""

    def test_replacing_a_key_updates_the_hint(self, client, logged_in, accept_keys):
        _set_key(client, logged_in)
        _set_key(client, logged_in, OTHER_KEY)
        assert client.get("/api/v1/me").json()["own_key"]["hint"] == OTHER_KEY[-4:]


class TestUnlimitedGeneration:
    def test_own_key_is_passed_to_the_model_call(self, client, logged_in, mock_ai, accept_keys):
        _set_key(client, logged_in)
        generate(client, logged_in)
        assert mock_ai["last_api_key"] == KEY

    def test_without_a_key_the_project_key_is_used(self, client, logged_in, mock_ai):
        generate(client, logged_in)
        assert mock_ai["last_api_key"] is None

    def test_daily_limit_is_not_consumed(self, client, logged_in, mock_ai, db_session, accept_keys):
        _set_key(client, logged_in)
        generate(client, logged_in)
        db_session.expire_all()
        user_id = db_session.execute(select(User)).scalar_one().id
        # `registrations` is bumped by signup and is none of our business here.
        rows = db_session.execute(
            select(RateLimit).where(RateLimit.scope.in_([f"user:{user_id}", "global"]))
        ).scalars().all()
        assert all(r.count == 0 for r in rows), "own key must not spend our budget"

    def test_saved_event_reports_unlimited(self, client, logged_in, mock_ai, accept_keys):
        _set_key(client, logged_in)
        saved = generate(client, logged_in)[-1][1]
        assert saved["unlimited"] is True
        assert saved["remaining"] is None

    def test_without_a_key_the_countdown_still_works(self, client, logged_in, mock_ai):
        saved = generate(client, logged_in)[-1][1]
        assert saved["unlimited"] is False
        assert isinstance(saved["remaining"], int)

    def test_exhausted_limit_does_not_block_a_byok_user(
        self, client, logged_in, mock_ai, db_session, accept_keys, monkeypatch
    ):
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "daily_limit_per_user", 0)
        # Without a key this would be a 429 …
        assert client.post("/api/v1/recipes/generate", json=PARAMS, headers=logged_in).status_code == 429
        _set_key(client, logged_in)
        # … with one it just runs.
        assert generate(client, logged_in)[-1][1]["unlimited"] is True

    def test_generation_is_logged_as_byok_and_costs_us_nothing(
        self, client, logged_in, mock_ai, db_session, accept_keys
    ):
        from app.services.pricing import generation_cost

        _set_key(client, logged_in)
        generate(client, logged_in)
        db_session.expire_all()
        row = db_session.execute(
            select(Generation).where(Generation.cached.is_(False))
        ).scalars().all()[-1]
        assert row.byok is True
        assert generation_cost(row) == 0.0, "user-funded tokens must not show up as our cost"


class TestKeyForGuards:
    """`key_for` is the single predicate for "unlimited" — it has to answer
    safely for every shape of user, or a limit check somewhere throws."""

    def test_none_user(self):
        assert byok.key_for(None) is None

    def test_user_without_a_key(self, client, logged_in, db_session):
        user = db_session.execute(select(User)).scalar_one()
        assert byok.key_for(user) is None

    def test_unreadable_ciphertext_counts_as_no_key(self, client, logged_in, db_session):
        """Secret rotated or row tampered with: fall back to our key and our
        limits rather than failing to cook."""
        user = db_session.execute(select(User)).scalar_one()
        user.anthropic_key_enc = "v1$not$decryptable"
        db_session.commit()
        assert byok.key_for(user) is None

    def test_status_of_an_unreadable_key_is_inactive(self, client, logged_in, db_session):
        user = db_session.execute(select(User)).scalar_one()
        user.anthropic_key_enc = "v1$not$decryptable"
        user.anthropic_key_hint = "AAAA"
        db_session.commit()
        status = byok.status_for(user)
        assert status["active"] is False
        assert status["hint"] == "", "a hint for a key we cannot use would be a lie"

    def test_an_unusable_stored_key_still_consumes_the_daily_limit(
        self, client, logged_in, mock_ai, db_session
    ):
        """The fallback must be complete: no key means our key AND our budget."""
        user = db_session.execute(select(User)).scalar_one()
        user.anthropic_key_enc = "v1$not$decryptable"
        db_session.commit()
        saved = generate(client, logged_in)[-1][1]
        assert saved["unlimited"] is False
        assert mock_ai["last_api_key"] is None


class TestClientLifecycle:
    """A per-request `AsyncAnthropic` owns an httpx connection pool. Leaking one
    per BYOK generation exhausts file descriptors in a process that runs for
    weeks — the kind of bug that only shows up in production, months in."""

    def test_byok_client_is_closed_after_use(self):
        import asyncio

        from app.services import ai

        async def run():
            async with ai.client_for("sk-ant-throwaway") as client:
                assert not client._client.is_closed
                return client

        client = asyncio.run(run())
        assert client._client.is_closed, "BYOK client was left open"

    def test_shared_client_survives_the_context(self):
        """Closing the project client would break every later call."""
        import asyncio

        from app.services import ai

        async def run():
            async with ai.client_for(None) as client:
                return client

        client = asyncio.run(run())
        assert client is ai.get_client()
        assert not client._client.is_closed

    def test_client_is_closed_even_when_the_call_raises(self):
        import asyncio

        from app.services import ai

        captured = {}

        async def run():
            try:
                async with ai.client_for("sk-ant-throwaway") as client:
                    captured["client"] = client
                    raise RuntimeError("stream died")
            except RuntimeError:
                pass

        asyncio.run(run())
        assert captured["client"]._client.is_closed

    def test_no_call_site_bypasses_the_context_manager(self):
        """Grep-as-a-test: a new `get_client(api_key)` outside `client_for`
        would silently reintroduce the leak."""
        import inspect

        from app.services import ai

        src = inspect.getsource(ai)
        # The only mentions may be the definition, the docstring and client_for.
        body = src.split("async def verify_key")[1]
        assert "get_client(api_key)" not in body


class TestKeyCheckIsNotAnOracle:
    """Storing a key costs an Anthropic round trip. Unthrottled, that turns the
    endpoint into a free "is this key valid?" service for stolen candidates —
    run through our IP and our identity."""

    def test_burst_is_capped_per_ip(self, client, logged_in, accept_keys):
        from app.api.v1.me import KEY_CHECKS_PER_MINUTE

        codes = [_set_key(client, logged_in).status_code for _ in range(KEY_CHECKS_PER_MINUTE + 2)]
        assert 429 in codes, "no burst limit on the key check"
        assert codes[0] == 200

    def test_daily_budget_is_capped_per_account(self, client, logged_in, accept_keys, monkeypatch):
        from app.api.v1 import me as me_module

        monkeypatch.setattr(me_module, "KEY_CHECKS_PER_DAY", 2)
        ratelimit_ip.reset()  # isolate from the burst limit
        seen = []
        for _ in range(4):
            seen.append(_set_key(client, logged_in).status_code)
            ratelimit_ip.reset()
        assert seen[:2] == [200, 200]
        assert seen[2] == 429

    def test_a_malformed_key_does_not_spend_the_daily_budget(
        self, client, logged_in, db_session, monkeypatch
    ):
        """Only checks that actually reach Anthropic count — a typo must not
        lock the owner out of storing their real key."""
        from sqlalchemy import select as _select

        from app.models import RateLimit as _RateLimit

        monkeypatch.setattr("app.api.v1.me.ai.verify_key", lambda _k: (_ for _ in ()).throw(AssertionError))
        assert _set_key(client, logged_in, "not-a-key").status_code == 422
        user_id = db_session.execute(_select(User)).scalar_one().id
        rows = db_session.execute(
            _select(_RateLimit).where(_RateLimit.scope == f"byokkey:{user_id}")
        ).scalars().all()
        assert rows == []
