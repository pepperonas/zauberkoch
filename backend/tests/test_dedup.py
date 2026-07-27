"""Duplicate-suppression across the generation endpoint.

The reported bug: two slightly different requests (e.g. tastes "sour, fresh"
vs "citrusy, refreshing") returned the same Daiquiri. These tests drive the
real router with a scriptable AI mock and assert the avoid list now spans
parameter variations and dedups by title identity.
"""

import json

import pytest

from app.api.v1 import recipes as recipes_module
from app.services import ratelimit_ip
from app.services.json_stream import replay_events
from tests.test_auth import add_to_allowlist, do_login_callback, fake_claims

BASE = {
    "titel": "Daiquiri",
    "teaser": "Rum, Limette, Zucker.",
    "kueche": "Kuba",
    "tags": ["klassiker"],
    "portionen": 2,
    "zeit_aktiv": 6,
    "zeit_gesamt": 6,
    "schwierigkeit": "einfach",
    "zutaten": [{"menge": 6, "einheit": "cl", "name": "Rum", "gruppe": ""}],
    "schritte": [{"nr": 1, "titel": "Shaken", "text": "Alles shaken.", "dauer_sek": 30}],
    "tipps": [],
    "naehrwerte": None,
    "glas": "Coupe",
    "garnitur": "Limette",
}


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture()
def scripted_ai(monkeypatch):
    """AI mock whose titles are a scripted queue; records every call's params."""
    state = {"titles": [], "calls": []}

    async def fake_events(params, api_key=None):
        state["calls"].append(params)
        titel = state["titles"].pop(0) if state["titles"] else BASE["titel"]
        for ev in replay_events({**BASE, "titel": titel}):
            yield ev
        yield ("usage", {"input_tokens": 10, "output_tokens": 5, "cache_read_tokens": 0, "cache_write_tokens": 0, "duration_ms": 1})

    monkeypatch.setattr(recipes_module.ai, "generate_recipe_events", fake_events)
    return state


def _login(client, db_session, monkeypatch, email, sub):
    add_to_allowlist(db_session, email)
    do_login_callback(client, monkeypatch, claims=fake_claims(email=email, sub=sub))
    csrf = client.get("/api/v1/me").json()["csrf_token"]
    client.post("/api/v1/me/confirm-adult", headers={"X-CSRF-Token": csrf})
    return {"X-CSRF-Token": csrf}


def _gen(client, auth, **params):
    body = {"modus": "cocktail", "geschmack": [], "personen": 2, **params}
    r = client.post("/api/v1/recipes/generate", json=body, headers=auth)
    assert r.status_code == 200, r.text
    events = {}
    for block in r.text.strip().split("\n\n"):
        lines = dict(ln.split(": ", 1) for ln in block.splitlines() if ": " in ln)
        if "event" in lines:
            events[lines["event"]] = json.loads(lines["data"])
    return events


def test_avoid_list_spans_parameter_variations(client, db_session, monkeypatch, scripted_ai):
    """The core fix: a DIFFERENT param set still avoids the earlier dish."""
    auth = _login(client, db_session, monkeypatch, "alice@example.com", "sub-a")
    scripted_ai["titles"] = ["Daiquiri", "Mojito"]

    _gen(client, auth, geschmack=["sauer"])
    _gen(client, auth, geschmack=["zitrus", "frisch"])  # different params_json

    # both live (different params = different cache key); the SECOND call
    # carried the first dish in its avoid list — impossible before the fix.
    assert len(scripted_ai["calls"]) == 2
    assert "Daiquiri" in scripted_ai["calls"][1].vermeiden_titel


def test_avoid_list_scoped_to_mode(client, db_session, monkeypatch, scripted_ai):
    """A cocktail generation is not steered away from cooking recipes."""
    auth = _login(client, db_session, monkeypatch, "alice@example.com", "sub-a")
    scripted_ai["titles"] = ["Spaghetti Carbonara", "Daiquiri"]

    r = client.post(
        "/api/v1/recipes/generate",
        json={"modus": "kochen", "kueche": "Italienisch", "geschmack": [], "personen": 2},
        headers=auth,
    )
    assert r.status_code == 200
    _gen(client, auth, geschmack=["sauer"])  # cocktail

    assert scripted_ai["calls"][1].vermeiden_titel == []  # no cross-mode bleed


def test_cached_dish_regenerates_when_title_reworded(client, db_session, monkeypatch, scripted_ai):
    """Cross-user cache path: if the cached dish is one this user already has
    under a REWORDED title, serve a variation, not the repeat."""
    # Bob fills the cache for params P (sauer) with "Daiquiri".
    bob = _login(client, db_session, monkeypatch, "bob@example.com", "sub-bob")
    scripted_ai["titles"] = ["Daiquiri"]
    _gen(client, bob, geschmack=["sauer"])

    # Alice already has a reworded Daiquiri (params Q), then hits params P whose
    # cache holds Bob's "Daiquiri" — the same dish under a different title.
    alice = _login(client, db_session, monkeypatch, "alice@example.com", "sub-a")
    scripted_ai["titles"] = ["Der klassische Daiquiri", "Mojito"]
    _gen(client, alice, geschmack=["zitrus"])  # history: reworded Daiquiri
    events = _gen(client, alice, geschmack=["sauer"])  # cache would repeat the dish

    assert events["saved"]["cached"] is False  # not served from cache
    assert events["meta"]["titel"] == "Mojito"  # regenerated to a different dish


def test_deleted_recipe_leaves_the_avoid_basis(client, db_session, monkeypatch, scripted_ai):
    """A soft-deleted dish must drop out of the avoid list, so the user can get
    it again (re-served free from cache — the documented cost behavior)."""
    auth = _login(client, db_session, monkeypatch, "alice@example.com", "sub-a")
    scripted_ai["titles"] = ["Daiquiri"]
    first = _gen(client, auth, geschmack=["sauer"])
    recipe_id = first["saved"]["recipe_id"]

    client.delete(f"/api/v1/recipes/{recipe_id}", headers=auth)

    # same params again: the deleted Daiquiri is neither avoided nor a repeat,
    # so it comes back straight from cache without a new live generation
    events = _gen(client, auth, geschmack=["sauer"])
    assert events["saved"]["cached"] is True
    assert events["meta"]["titel"] == "Daiquiri"
    assert len(scripted_ai["calls"]) == 1  # no second live call


def test_first_time_user_still_served_from_cache(client, db_session, monkeypatch, scripted_ai):
    """Cost guard intact: a dish new to the user is served free from cache."""
    bob = _login(client, db_session, monkeypatch, "bob@example.com", "sub-bob")
    scripted_ai["titles"] = ["Daiquiri"]
    _gen(client, bob, geschmack=["sauer"])
    assert len(scripted_ai["calls"]) == 1

    alice = _login(client, db_session, monkeypatch, "alice@example.com", "sub-a")
    events = _gen(client, alice, geschmack=["sauer"])  # same params, never seen it

    assert events["saved"]["cached"] is True  # free cache hit
    assert len(scripted_ai["calls"]) == 1  # no new live generation
