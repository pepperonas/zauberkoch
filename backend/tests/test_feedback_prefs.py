"""Feedback loop, user preferences merge, JSON-LD on share pages."""

import pytest

from app.services import ratelimit_ip
from tests.test_generation import PARAMS, generate, logged_in, mock_ai, parse_sse  # noqa: F401


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


def test_feedback_roundtrip(client, logged_in, mock_ai):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]

    r = client.post(f"/api/v1/recipes/{recipe_id}/feedback", json={"wert": -1, "grund": "zu generisch"}, headers=logged_in)
    assert r.status_code == 200
    assert r.json() == {"feedback": -1, "grund": "zu generisch"}

    # thumbs up clears the reason
    r = client.post(f"/api/v1/recipes/{recipe_id}/feedback", json={"wert": 1}, headers=logged_in)
    assert r.json() == {"feedback": 1, "grund": ""}


def test_feedback_requires_csrf_and_ownership(client, logged_in, mock_ai):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]
    assert client.post(f"/api/v1/recipes/{recipe_id}/feedback", json={"wert": 1}).status_code == 403
    assert client.post("/api/v1/recipes/99999/feedback", json={"wert": 1}, headers=logged_in).status_code == 404


def test_preferences_roundtrip_and_merge(client, logged_in, mock_ai, monkeypatch):
    prefs = {"vegan": True, "vermeiden": ["Koriander", "Rosinen"], "standard_personen": 3}
    r = client.put("/api/v1/me/preferences", json=prefs, headers=logged_in)
    assert r.status_code == 200
    assert client.get("/api/v1/me").json()["preferences"]["vegan"] is True


    # capture the params that actually reach the AI service
    captured: dict = {}
    from app.api.v1 import recipes as recipes_module

    original = recipes_module.ai.generate_recipe_events

    def spy(params, api_key=None):
        captured["params"] = params
        return original(params, api_key=api_key)

    monkeypatch.setattr(recipes_module.ai, "generate_recipe_events", spy)
    generate(client, logged_in)

    merged = captured["params"]
    assert merged.vegan is True
    assert set(merged.vermeiden) == {"Koriander", "Rosinen"}


def test_preferences_custom_cuisines(client, logged_in):
    # dedupe (case-insensitive), whitespace collapse, order preserved
    prefs = {"kuechen": ["Sizilianisch", "  sizilianisch ", "Tex-Mex", "Ramen &  Nudelsuppen", ""]}
    r = client.put("/api/v1/me/preferences", json=prefs, headers=logged_in)
    assert r.status_code == 200
    assert r.json()["preferences"]["kuechen"] == ["Sizilianisch", "Tex-Mex", "Ramen & Nudelsuppen"]
    assert client.get("/api/v1/me").json()["preferences"]["kuechen"][0] == "Sizilianisch"

    # cap at 40 entries -> 422
    too_many = {"kuechen": [f"Küche {i}" for i in range(41)]}
    assert client.put("/api/v1/me/preferences", json=too_many, headers=logged_in).status_code == 422


def test_preferences_pantry(client, logged_in):
    prefs = {"vorraete": ["Zwiebeln", " zwiebeln", "Reis", "Olivenöl"]}
    r = client.put("/api/v1/me/preferences", json=prefs, headers=logged_in)
    assert r.status_code == 200
    assert r.json()["preferences"]["vorraete"] == ["Zwiebeln", "Reis", "Olivenöl"]
    assert client.get("/api/v1/me").json()["preferences"]["vorraete"] == ["Zwiebeln", "Reis", "Olivenöl"]


def test_preferences_affect_cache_key(client, logged_in, mock_ai):
    generate(client, logged_in)  # live #1 (no prefs)
    client.put("/api/v1/me/preferences", json={"vermeiden": ["Sellerie"]}, headers=logged_in)
    events = generate(client, logged_in)  # same wizard params, new prefs -> must NOT hit cache
    assert events[-1][1]["cached"] is False
    assert mock_ai["count"] == 2


def test_share_page_contains_recipe_jsonld(client, logged_in, mock_ai):
    recipe_id = generate(client, logged_in)[-1][1]["recipe_id"]
    token = client.post(f"/api/v1/recipes/{recipe_id}/share", headers=logged_in).json()["share_token"]
    page = client.get(f"/r/{token}").text
    assert 'application/ld+json' in page
    assert '"@type": "Recipe"' in page
    assert '"recipeIngredient"' in page
    assert '"HowToStep"' in page
    assert '"totalTime": "PT20M"' in page
