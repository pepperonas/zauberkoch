"""Adapt-per-instruction, cooking notes, cooked counter, ingredient search."""

import pytest

from app.services import ratelimit_ip
from tests.test_generation import PARAMS, generate, logged_in, mock_ai, parse_sse  # noqa: F401
from tests.test_json_stream import RECIPE


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture()
def mock_adapt(monkeypatch):
    from app.api.v1 import recipes as recipes_module
    from app.services.json_stream import replay_events

    calls: dict = {}

    async def fake_adapt(recipe, anweisung, api_key=None):
        calls["recipe"] = recipe
        calls["anweisung"] = anweisung
        adapted = {**recipe, "titel": recipe["titel"] + " (scharf)"}
        for ev in replay_events(adapted):
            yield ev
        yield ("usage", {"input_tokens": 2000, "output_tokens": 800, "cache_read_tokens": 1800, "cache_write_tokens": 0, "duration_ms": 3000})

    monkeypatch.setattr(recipes_module.ai, "adapt_recipe_events", fake_adapt)
    return calls


def test_adapt_streams_and_persists_new_recipe(client, logged_in, mock_ai, mock_adapt):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]

    r = client.post(f"/api/v1/recipes/{recipe_id}/adapt", json={"anweisung": "mach es  schärfer"}, headers=logged_in)
    assert r.status_code == 200
    events = parse_sse(r.text)
    names = [n for n, _ in events]
    assert names[0] == "meta" and names[-1] == "saved"
    assert "usage" not in names

    new_id = events[-1][1]["recipe_id"]
    assert new_id != recipe_id
    detail = client.get(f"/api/v1/recipes/{new_id}").json()
    assert detail["recipe"]["titel"].endswith("(scharf)")
    assert mock_adapt["anweisung"] == "mach es schärfer"  # whitespace collapsed


def test_adapt_consumes_daily_limit(client, logged_in, mock_ai, mock_adapt):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]  # 1 consumed
    r = client.post(f"/api/v1/recipes/{recipe_id}/adapt", json={"anweisung": "milder"}, headers=logged_in)
    saved = parse_sse(r.text)[-1][1]
    assert saved["remaining"] == 18  # 2 of 20 consumed


def test_adapt_ownership_and_csrf(client, logged_in, mock_ai, mock_adapt):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]
    assert client.post(f"/api/v1/recipes/{recipe_id}/adapt", json={"anweisung": "x y"}).status_code == 403
    assert client.post("/api/v1/recipes/9999/adapt", json={"anweisung": "x y"}, headers=logged_in).status_code == 404


def test_notiz_and_gekocht_roundtrip(client, logged_in, mock_ai):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]

    r = client.patch(f"/api/v1/recipes/{recipe_id}/notiz", json={"notiz": " Nächstes Mal weniger Chili. "}, headers=logged_in)
    assert r.json() == {"notiz": "Nächstes Mal weniger Chili."}

    client.post(f"/api/v1/recipes/{recipe_id}/gekocht", headers=logged_in)
    r = client.post(f"/api/v1/recipes/{recipe_id}/gekocht", headers=logged_in)
    assert r.json() == {"gekocht_count": 2}

    detail = client.get(f"/api/v1/recipes/{recipe_id}").json()
    assert detail["notiz"] == "Nächstes Mal weniger Chili."
    assert detail["gekocht_count"] == 2


def test_search_finds_ingredients(client, logged_in, mock_ai):
    generate(client, logged_in)  # RECIPE contains Parmesan as ingredient
    assert RECIPE["zutaten"][2]["name"] == "Parmesan"
    items = client.get("/api/v1/recipes?q=parmesan").json()["items"]
    assert len(items) == 1
    assert client.get("/api/v1/recipes?q=steinpilz").json()["items"] == []
