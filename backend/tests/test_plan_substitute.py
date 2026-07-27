"""Weekly meal planner + ingredient substitution."""

import pytest

from app.services import ratelimit_ip
from tests.test_generation import PARAMS, generate, logged_in, mock_ai  # noqa: F401


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


def test_plan_week_roundtrip(client, logged_in, mock_ai):  # noqa: F811
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]

    week = client.get("/api/v1/plan").json()
    assert len(week["days"]) == 7
    monday = week["start"]

    r = client.post("/api/v1/plan", json={"datum": monday, "recipe_id": recipe_id}, headers=logged_in)
    assert r.status_code == 200
    entry_id = r.json()["id"]

    # idempotent add
    assert client.post("/api/v1/plan", json={"datum": monday, "recipe_id": recipe_id}, headers=logged_in).json()["id"] == entry_id

    week = client.get(f"/api/v1/plan?start={monday}").json()
    assert week["days"][0]["entries"][0]["titel"] == "Pasta al Limone"

    # whole week -> shopping list (aggregated)
    r = client.post("/api/v1/plan/to-shopping", json={"start": monday}, headers=logged_in)
    assert r.json()["added_recipes"] == 1
    names = [i["name"] for i in r.json()["items"]]
    assert "Spaghetti" in names

    assert client.delete(f"/api/v1/plan/{entry_id}", headers=logged_in).status_code == 200
    assert client.get(f"/api/v1/plan?start={monday}").json()["days"][0]["entries"] == []


def test_plan_rejects_foreign_recipe_and_bad_date(client, logged_in, mock_ai):  # noqa: F811
    assert client.post("/api/v1/plan", json={"datum": "2026-07-13", "recipe_id": 999}, headers=logged_in).status_code == 404
    assert client.get("/api/v1/plan?start=nope").status_code == 422


def test_substitute_returns_alternatives(client, logged_in, mock_ai, monkeypatch):  # noqa: F811
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]

    from app.api.v1 import recipes as recipes_module

    async def fake_subst(recipe, zutat, api_key=None):
        assert zutat == "Parmesan"
        return {"alternativen": [{"name": "Pecorino", "hinweis": "1:1 ersetzen, etwas salziger."}]}

    monkeypatch.setattr(recipes_module.ai, "substitute_options", fake_subst)
    r = client.post(f"/api/v1/recipes/{recipe_id}/substitute", json={"zutat": "Parmesan"}, headers=logged_in)
    assert r.status_code == 200
    assert r.json()["alternativen"][0]["name"] == "Pecorino"


def test_fridge_scan_flow(client, logged_in, monkeypatch):  # noqa: F811
    from app.api.v1 import recipes as recipes_module
    from app.core.config import get_settings  # noqa: F401

    async def fake_scan(image, media_type, api_key=None):
        assert media_type == "image/jpeg"
        return {"zutaten": ["Eier", "Paprika", "Milch"]}

    monkeypatch.setattr(recipes_module.ai, "fridge_scan", fake_scan)
    img = "x" * 200
    r = client.post("/api/v1/recipes/fridge-scan", json={"image": img}, headers=logged_in)
    assert r.status_code == 200
    assert r.json()["zutaten"] == ["Eier", "Paprika", "Milch"]

    # persistent daily cap: 5 per user
    for _ in range(4):
        assert client.post("/api/v1/recipes/fridge-scan", json={"image": img}, headers=logged_in).status_code == 200
    r = client.post("/api/v1/recipes/fridge-scan", json={"image": img}, headers=logged_in)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "daily_limit_scoped"
