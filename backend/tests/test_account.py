"""Self-service data export (Art. 15/20) and account deletion (Art. 17).

The deletion tests deliberately check every table by hand instead of trusting
`ON DELETE CASCADE`: SQLite only enforces foreign keys while
`PRAGMA foreign_keys=ON` is set, so a future change to `db.py` could silently
turn "delete my account" into "leave everything lying around".
"""

import json

import pytest
from sqlalchemy import select

from app.models import (
    AllowlistEntry,
    Favorite,
    Generation,
    MealPlanEntry,
    RateLimit,
    Recipe,
    Session as SessionModel,
    ShoppingListItem,
    User,
)
from app.services import ratelimit_ip
from tests.test_auth import add_to_allowlist, do_login_callback  # noqa: F401
from tests.test_generation import PARAMS, generate, logged_in, mock_ai, parse_sse  # noqa: F401


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


def _export(client):
    r = client.get("/api/v1/me/export")
    assert r.status_code == 200, r.text
    return r


def _delete(client, headers, **body):
    return client.request("DELETE", "/api/v1/me", json={"confirm": True, **body}, headers=headers)


class TestExport:
    def test_export_is_a_download_with_the_account_in_it(self, client, logged_in):
        r = _export(client)
        assert "attachment" in r.headers["content-disposition"]
        assert "zauberkoch-export-" in r.headers["content-disposition"]
        data = r.json()
        assert data["konto"]["email"] == "alice@example.com"
        assert data["export_version"] == 1

    def test_export_contains_recipes_as_objects_not_json_strings(self, client, logged_in, mock_ai):
        generate(client, logged_in)
        data = _export(client).json()
        assert len(data["rezepte"]) == 1
        rezept = data["rezepte"][0]["rezept"]
        # Parsed, not a wall of escaped JSON — the point of the export is that
        # a human can read it.
        assert isinstance(rezept, dict)
        assert rezept.get("titel")
        assert isinstance(data["rezepte"][0]["parameter"], dict)

    def test_soft_deleted_recipes_are_included_and_flagged(self, client, logged_in, mock_ai):
        rid = generate(client, logged_in)[-1][1]["recipe_id"]
        client.delete(f"/api/v1/recipes/{rid}", headers=logged_in)
        data = _export(client).json()
        assert len(data["rezepte"]) == 1, "still stored, so it belongs in the export"
        assert data["rezepte"][0]["geloescht_am"] is not None

    def test_export_never_leaks_a_password_hash(self, client, logged_in):
        raw = json.dumps(_export(client).json())
        assert "password" not in raw.lower()
        assert "scrypt" not in raw

    def test_export_requires_a_session(self, client):
        assert client.get("/api/v1/me/export").status_code == 401


class TestDeleteAccount:
    def test_requires_csrf(self, client, logged_in):
        r = client.request("DELETE", "/api/v1/me", json={"confirm": True})
        assert r.status_code == 403

    def test_requires_the_confirm_flag(self, client, logged_in):
        r = client.request("DELETE", "/api/v1/me", json={"confirm": False}, headers=logged_in)
        assert r.status_code == 400

    def test_deletes_the_user_and_logs_them_out(self, client, logged_in, db_session):
        assert _delete(client, logged_in).status_code == 204
        assert db_session.execute(select(User)).scalars().all() == []
        # The session cookie is cleared, so /me is anonymous again.
        assert client.get("/api/v1/me").json() == {"authenticated": False}

    def test_removes_every_attached_row(self, client, logged_in, mock_ai, db_session):
        rid = generate(client, logged_in)[-1][1]["recipe_id"]
        client.put(f"/api/v1/recipes/{rid}/favorite", headers=logged_in)
        client.post("/api/v1/shopping/items", json={"name": "Salz"}, headers=logged_in)
        client.post(
            "/api/v1/plan", json={"datum": "2026-08-01", "recipe_id": rid}, headers=logged_in
        )
        for model in (Recipe, Favorite, ShoppingListItem, MealPlanEntry, SessionModel):
            assert db_session.execute(select(model)).scalars().all(), f"{model} not set up"

        assert _delete(client, logged_in).status_code == 204

        db_session.expire_all()
        for model in (Recipe, Favorite, ShoppingListItem, MealPlanEntry, SessionModel):
            left = db_session.execute(select(model)).scalars().all()
            assert left == [], f"{model.__name__} survived the account deletion"

    def test_drops_the_personal_rate_limit_counter(self, client, logged_in, mock_ai, db_session):
        generate(client, logged_in)
        user_id = db_session.execute(select(User)).scalar_one().id
        scope = f"user:{user_id}"
        assert db_session.execute(
            select(RateLimit).where(RateLimit.scope == scope)
        ).scalars().all()

        _delete(client, logged_in)

        db_session.expire_all()
        # Left behind, SQLite would hand the same id to the next account —
        # which would inherit a used-up daily quota.
        assert db_session.execute(
            select(RateLimit).where(RateLimit.scope == scope)
        ).scalars().all() == []

    def test_drops_the_allowlist_entry(self, client, logged_in, db_session):
        assert db_session.execute(select(AllowlistEntry)).scalars().all()
        _delete(client, logged_in)
        db_session.expire_all()
        assert db_session.execute(select(AllowlistEntry)).scalars().all() == []

    def test_usage_log_is_detached_not_deleted(self, client, logged_in, mock_ai, db_session):
        """The cost history must survive — otherwise past months would shrink
        retroactively in the admin dashboard."""
        generate(client, logged_in)
        assert len(db_session.execute(select(Generation)).scalars().all()) == 1

        _delete(client, logged_in)

        db_session.expire_all()
        rows = db_session.execute(select(Generation)).scalars().all()
        assert len(rows) == 1, "usage row was deleted with the account"
        assert rows[0].user_id is None, "usage row still points at the deleted user"


class TestPasswordAccounts:
    """A password account must re-authenticate before it can be deleted."""

    def _register_and_login(self, client, db_session, monkeypatch):
        from app.services import auth_tokens

        add_to_allowlist(db_session, "bob@example.com")
        monkeypatch.setattr("app.services.mailer.send_verification_email", lambda *a, **k: None)
        monkeypatch.setattr("app.services.mailer.send_welcome_email", lambda *a, **k: None)
        monkeypatch.setattr(
            "app.services.mailer.send_admin_signup_notification", lambda *a, **k: None
        )
        r = client.post(
            "/api/v1/auth/register",
            json={
                "email": "bob@example.com",
                "password": "Kochtopf-2026!",
                "password_confirm": "Kochtopf-2026!",
                "name": "Bob",
            },
        )
        assert r.status_code == 200, r.text
        user = db_session.execute(
            select(User).where(User.email == "bob@example.com")
        ).scalar_one()
        token = auth_tokens.make_verify_token(user)
        assert client.post("/api/v1/auth/verify", json={"token": token}).status_code == 200
        return {"X-CSRF-Token": client.get("/api/v1/me").json()["csrf_token"]}

    def test_wrong_password_is_refused(self, client, db_session, monkeypatch):
        headers = self._register_and_login(client, db_session, monkeypatch)
        r = _delete(client, headers, password="nope")
        assert r.status_code == 403
        assert db_session.execute(select(User)).scalars().all(), "account was deleted anyway"

    def test_missing_password_is_refused(self, client, db_session, monkeypatch):
        headers = self._register_and_login(client, db_session, monkeypatch)
        assert _delete(client, headers).status_code == 403

    def test_correct_password_deletes(self, client, db_session, monkeypatch):
        headers = self._register_and_login(client, db_session, monkeypatch)
        assert _delete(client, headers, password="Kochtopf-2026!").status_code == 204
        db_session.expire_all()
        assert db_session.execute(select(User)).scalars().all() == []


class TestExportRobustness:
    """The export must survive rows that are not pristine — it is the one
    endpoint a user reaches for when something already went wrong."""

    def test_corrupt_recipe_json_does_not_break_the_export(
        self, client, logged_in, mock_ai, db_session
    ):
        generate(client, logged_in)
        row = db_session.execute(select(Recipe)).scalars().all()[0]
        row.recipe_json = "{not json"
        db_session.commit()

        data = _export(client).json()
        # Unparseable content is handed back verbatim instead of exploding.
        assert data["rezepte"][0]["rezept"] == "{not json"

    def test_corrupt_preferences_fall_back_to_defaults(self, client, logged_in, db_session):
        user = db_session.execute(select(User)).scalar_one()
        user.preferences_json = "definitely not json"
        db_session.commit()

        assert client.get("/api/v1/me").status_code == 200
        data = _export(client).json()
        assert data["einstellungen"]["standard_personen"] >= 1

    def test_login_methods_are_listed(self, client, logged_in, db_session):
        """A Google account says google; adding a password adds passwort."""
        data = _export(client).json()
        assert data["konto"]["anmeldung"] == ["google"]

        user = db_session.execute(select(User)).scalar_one()
        user.password_hash = "scrypt$1$1$1$x$y"
        db_session.commit()
        assert _export(client).json()["konto"]["anmeldung"] == ["google", "passwort"]

    def test_empty_account_exports_cleanly(self, client, logged_in):
        data = _export(client).json()
        assert data["rezepte"] == []
        assert data["einkaufsliste"] == []
        assert data["wochenplan"] == []
        assert data["nutzung"] == []


class TestDeletionDuringGeneration:
    def test_a_generation_finishing_after_deletion_keeps_the_cache_entry(
        self, client, logged_in, db_session, monkeypatch
    ):
        """The finalizer runs in a worker thread AFTER the model call, so the
        account can be gone by the time it writes. Its rows carry a user_id
        foreign key: inserting them raises and takes the cache entry with them,
        throwing away a generation that was already paid for.

        Reproduced for real — the fake stream deletes the account between the
        last recipe event and the finalizer, which is exactly the race.
        """
        from app.api.v1 import recipes as recipes_module
        from app.db import SessionLocal
        from app.models import GenerationCache
        from app.services.json_stream import replay_events
        from tests.test_generation import RECIPE

        async def fake_events(params, api_key=None):
            for ev in replay_events(dict(RECIPE)):
                yield ev
            # …user hits "Konto löschen" right here.
            side = SessionLocal()
            try:
                side.delete(side.execute(select(User)).scalar_one())
                side.commit()
            finally:
                side.close()
            yield ("usage", {"input_tokens": 10, "output_tokens": 5,
                             "cache_read_tokens": 0, "cache_write_tokens": 0, "duration_ms": 1})

        monkeypatch.setattr(recipes_module.ai, "generate_recipe_events", fake_events)

        r = client.post("/api/v1/recipes/generate", json=PARAMS, headers=logged_in)
        assert r.status_code == 200, r.text
        events = parse_sse(r.text)
        assert "error" not in [name for name, _ in events], "the stream must not fail"

        db_session.expire_all()
        # Nothing owner-bound survives …
        assert db_session.execute(select(User)).scalars().all() == []
        assert db_session.execute(select(Recipe)).scalars().all() == []
        assert db_session.execute(select(Generation)).scalars().all() == []
        # … but the paid AI output is still in the shared cache.
        assert db_session.execute(select(GenerationCache)).scalars().all() != []
