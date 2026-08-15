"""What the user sees when the model call goes wrong.

Every one of these paths ends in somebody staring at a spinner if it is not
handled, because the response is an already-open SSE stream: raising inside it
does not produce a clean 500, it just stops sending. So the contract is that a
failure arrives as a normal `error` event and the stream closes.

The three small endpoints (substitute, fridge scan) answer with 502 instead —
they are plain JSON, so an honest status code is available there.
"""

import pytest

from app.api.v1 import recipes as recipes_module
from app.services import ratelimit_ip
from tests.test_generation import PARAMS, generate, logged_in, mock_ai, parse_sse  # noqa: F401 (fixtures)


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


def _explode(monkeypatch, attr: str, message: str = "anthropic is down"):
    """Make one AI entry point raise on its first yielded event."""

    async def failing(*args, **kwargs):
        raise RuntimeError(message)
        yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr(getattr(recipes_module, "ai"), attr, failing)


# -- the main generation stream -------------------------------------------


def test_a_dead_model_call_arrives_as_an_error_event(client, logged_in, monkeypatch):  # noqa: F811
    _explode(monkeypatch, "generate_recipe_events")

    r = client.post("/api/v1/recipes/generate", json=PARAMS, headers=logged_in)

    assert r.status_code == 200, "the stream had already started — status is 200"
    events = parse_sse(r.text)
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "generation_failed"


def test_the_failure_message_carries_no_internal_detail(client, logged_in, monkeypatch):  # noqa: F811
    _explode(monkeypatch, "generate_recipe_events", message="sk-ant-secret-in-the-traceback")

    r = client.post("/api/v1/recipes/generate", json=PARAMS, headers=logged_in)

    assert "sk-ant-secret-in-the-traceback" not in r.text
    assert "Traceback" not in r.text


def test_a_failed_generation_is_not_saved(client, db_session, logged_in, monkeypatch):  # noqa: F811
    """A half-written recipe in the history would be worse than none."""
    from app.models import Recipe

    _explode(monkeypatch, "generate_recipe_events")
    client.post("/api/v1/recipes/generate", json=PARAMS, headers=logged_in)

    assert db_session.query(Recipe).count() == 0


def test_a_failed_generation_still_costs_a_daily_slot(client, db_session, logged_in, monkeypatch):  # noqa: F811
    """Documented as-is, deliberately: the quota is consumed before the call,
    because a retry loop against a failing model would otherwise be free and
    could burn the project budget. If that ever changes, this test should
    change with it — it is a decision, not an accident."""
    from app.models import RateLimit, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()

    def used() -> int:
        # read-only on purpose: get_usage() would INSERT and deadlock against
        # the request's own write transaction on SQLite
        db_session.expire_all()
        row = db_session.query(RateLimit).filter(RateLimit.scope == f"user:{alice.id}").one_or_none()
        return row.count if row else 0

    before = used()
    _explode(monkeypatch, "generate_recipe_events")

    client.post("/api/v1/recipes/generate", json=PARAMS, headers=logged_in)

    assert used() == before + 1


# -- the anonymous taster --------------------------------------------------


def test_the_taster_reports_a_failure_the_same_way(client, monkeypatch):
    _explode(monkeypatch, "generate_recipe_events")

    r = client.post("/api/v1/recipes/try", json=PARAMS)

    events = parse_sse(r.text)
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "generation_failed"


# -- adapt -----------------------------------------------------------------


def test_adapting_a_recipe_reports_a_failure_as_an_event(client, logged_in, mock_ai, monkeypatch):  # noqa: F811
    recipe_id = dict(generate(client, logged_in, PARAMS))["saved"]["recipe_id"]
    _explode(monkeypatch, "adapt_recipe_events")

    r = client.post(f"/api/v1/recipes/{recipe_id}/adapt", json={"anweisung": "schärfer"}, headers=logged_in)

    events = parse_sse(r.text)
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "generation_failed"


def test_adapting_an_unknown_recipe_is_a_404(client, logged_in):  # noqa: F811
    r = client.post("/api/v1/recipes/999999/adapt", json={"anweisung": "schärfer"}, headers=logged_in)
    assert r.status_code == 404


# -- the small AI calls ----------------------------------------------------


def test_a_failing_substitution_is_a_502_not_a_500(client, logged_in, mock_ai, monkeypatch):  # noqa: F811
    """502 says "the upstream is broken", which is both true and actionable —
    the user can simply try again."""
    recipe_id = dict(generate(client, logged_in, PARAMS))["saved"]["recipe_id"]

    async def boom(*a, **kw):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(recipes_module.ai, "substitute_options", boom)

    r = client.post(
        f"/api/v1/recipes/{recipe_id}/substitute", json={"zutat": "Parmesan"}, headers=logged_in
    )

    assert r.status_code == 502
    assert r.json()["error"]["code"] == "substitute_failed"
    assert "upstream down" not in r.text


def test_substituting_on_an_unknown_recipe_is_a_404(client, logged_in):  # noqa: F811
    r = client.post("/api/v1/recipes/999999/substitute", json={"zutat": "Parmesan"}, headers=logged_in)
    assert r.status_code == 404


def test_a_failing_fridge_scan_is_a_502(client, logged_in, monkeypatch):  # noqa: F811
    async def boom(*a, **kw):
        raise RuntimeError("vision down")

    monkeypatch.setattr(recipes_module.ai, "fridge_scan", boom)

    r = client.post(
        "/api/v1/recipes/fridge-scan", json={"image": "Q" * 200, "media_type": "image/jpeg"}, headers=logged_in
    )

    assert r.status_code == 502
    assert r.json()["error"]["code"] == "scan_failed"


# -- list filters ----------------------------------------------------------


def test_the_history_can_be_filtered_by_mode(client, db_session, logged_in):  # noqa: F811
    import json

    from app.models import Recipe, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    for mode, titel, kueche in [("kochen", "Pasta", "Italienisch"), ("cocktail", "Gin Sour", "Klassiker")]:
        db_session.add(Recipe(
            user_id=alice.id, mode=mode, params_json="{}",
            recipe_json=json.dumps({"titel": titel}), titel=titel, kueche=kueche,
            prompt_version="v5", model="test",
        ))
    db_session.commit()

    kochen = client.get("/api/v1/recipes?mode=kochen").json()["items"]
    cocktails = client.get("/api/v1/recipes?mode=cocktail").json()["items"]

    assert [i["titel"] for i in kochen] == ["Pasta"]
    assert [i["titel"] for i in cocktails] == ["Gin Sour"]


def test_the_history_can_be_filtered_by_cuisine(client, db_session, logged_in):  # noqa: F811
    import json

    from app.models import Recipe, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    for titel, kueche in [("Pasta", "Italienisch"), ("Curry", "Thailändisch")]:
        db_session.add(Recipe(
            user_id=alice.id, mode="kochen", params_json="{}",
            recipe_json=json.dumps({"titel": titel}), titel=titel, kueche=kueche,
            prompt_version="v5", model="test",
        ))
    db_session.commit()

    items = client.get("/api/v1/recipes?kueche=Thailändisch").json()["items"]

    assert [i["titel"] for i in items] == ["Curry"]
