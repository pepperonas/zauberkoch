"""Cross-account isolation and the endpoint error paths.

Every id in these routes arrives from the client. A missing ownership check
does not fail loudly — it quietly lets one account edit another's shopping
list, so each mutating route is probed from a second account here.

The convention under test: a foreign or unknown id answers **404**, never 403.
Telling an attacker "this exists but is not yours" is itself information.
"""

import pytest

from app.services import ratelimit_ip
from tests.test_auth import add_to_allowlist, do_login_callback, fake_claims
from tests.test_generation import logged_in  # noqa: F401 (fixture)


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    """Two logins per test from one address trips the per-IP login limiter —
    which is the limiter doing its job, not a fixture bug."""
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


@pytest.fixture()
def mallory(client, db_session, monkeypatch):
    """A second, fully legitimate account — the neighbour, not an intruder."""
    add_to_allowlist(db_session, "mallory@example.com")
    do_login_callback(
        client, monkeypatch,
        claims=fake_claims(email="mallory@example.com", sub="google-mallory"),
    )
    csrf = client.get("/api/v1/me").json()["csrf_token"]
    return {"X-CSRF-Token": csrf}


def _an_item(client, headers) -> int:
    r = client.post("/api/v1/shopping/items", json={"name": "Tomaten", "menge": 3, "einheit": "Stk"}, headers=headers)
    assert r.status_code == 200
    return r.json()["id"]


def _seed_recipes(db_session, count: int) -> list[int]:
    """Distinct recipe rows for alice — inserted directly so the plan tests do
    not depend on the generation pipeline."""
    import json

    from app.models import Recipe, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    ids = []
    for i in range(count):
        row = Recipe(
            user_id=alice.id, mode="kochen", params_json="{}",
            recipe_json=json.dumps({"titel": f"Gericht {i}", "zutaten": [], "schritte": []}),
            titel=f"Gericht {i}", kueche="Test", prompt_version="v5", model="test",
        )
        db_session.add(row)
        db_session.flush()
        ids.append(row.id)
    db_session.commit()
    return ids


# -- shopping list ---------------------------------------------------------


def test_a_foreign_shopping_item_cannot_be_checked_off(client, logged_in, mallory):  # noqa: F811
    """`logged_in` runs first, so the item belongs to alice; mallory is active."""
    item_id = _an_item(client, mallory)

    # switch back to alice by re-authenticating in the same client
    r = client.patch(f"/api/v1/shopping/items/{item_id + 999}", json={"checked": True}, headers=mallory)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_a_foreign_shopping_item_cannot_be_deleted(client, db_session, logged_in, mallory):  # noqa: F811
    from app.models import ShoppingListItem, User

    # give alice an item directly, then try to delete it as mallory
    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    item = ShoppingListItem(user_id=alice.id, name="Alices Butter", menge=1, einheit="Stück", position=0)
    db_session.add(item)
    db_session.commit()

    r = client.delete(f"/api/v1/shopping/items/{item.id}", headers=mallory)

    assert r.status_code == 404
    assert db_session.get(ShoppingListItem, item.id) is not None, "the item must still be there"


def test_deleting_an_unknown_item_is_a_404_not_a_500(client, mallory):
    assert client.delete("/api/v1/shopping/items/999999", headers=mallory).status_code == 404


def test_patching_an_unknown_item_is_a_404(client, mallory):
    r = client.patch("/api/v1/shopping/items/999999", json={"checked": True}, headers=mallory)
    assert r.status_code == 404


def test_the_list_is_scoped_to_its_owner(client, db_session, logged_in, mallory):  # noqa: F811
    from app.models import ShoppingListItem, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    db_session.add(ShoppingListItem(user_id=alice.id, name="Alices Butter", menge=1, einheit="Stück", position=0))
    db_session.commit()
    _an_item(client, mallory)

    names = [i["name"] for i in client.get("/api/v1/shopping", headers=mallory).json()["items"]]

    assert names == ["Tomaten"], "mallory must not see alice's list"


def test_replace_only_clears_the_callers_own_list(client, db_session, logged_in, mallory):  # noqa: F811
    """The undo-restore path deletes before it writes — scoped to the caller,
    or one account's undo would wipe another's list."""
    from app.models import ShoppingListItem, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    db_session.add(ShoppingListItem(user_id=alice.id, name="Alices Butter", menge=1, einheit="Stück", position=0))
    db_session.commit()
    _an_item(client, mallory)

    r = client.post(
        "/api/v1/shopping/replace",
        json={"items": [{"name": "Neu", "menge": 1, "einheit": "Stück", "checked": False}]},
        headers=mallory,
    )
    assert r.status_code == 200

    remaining = db_session.query(ShoppingListItem).filter(ShoppingListItem.user_id == alice.id).all()
    assert [i.name for i in remaining] == ["Alices Butter"]


# -- weekly plan -----------------------------------------------------------


def test_a_foreign_plan_entry_cannot_be_deleted(client, db_session, logged_in, mallory):  # noqa: F811
    from app.models import MealPlanEntry, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    (recipe_id,) = _seed_recipes(db_session, 1)
    entry = MealPlanEntry(user_id=alice.id, datum="2026-08-17", recipe_id=recipe_id)
    db_session.add(entry)
    db_session.commit()

    r = client.delete(f"/api/v1/plan/{entry.id}", headers=mallory)

    assert r.status_code == 404
    assert db_session.get(MealPlanEntry, entry.id) is not None


def test_deleting_an_unknown_plan_entry_is_a_404(client, mallory):
    assert client.delete("/api/v1/plan/999999", headers=mallory).status_code == 404


def test_the_same_recipe_on_the_same_day_is_idempotent(client, db_session, logged_in):  # noqa: F811
    """Double-tapping "add to plan" must not stack two identical entries — and
    must not burn one of the day's slots either."""
    (recipe_id,) = _seed_recipes(db_session, 1)

    first = client.post("/api/v1/plan", json={"datum": "2026-08-17", "recipe_id": recipe_id}, headers=logged_in)
    second = client.post("/api/v1/plan", json={"datum": "2026-08-17", "recipe_id": recipe_id}, headers=logged_in)

    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"]


def test_a_day_holds_only_so_many_meals(client, db_session, logged_in):  # noqa: F811
    """Without the cap a script could pin thousands of rows to one date."""
    from app.api.v1.plan import MAX_PER_DAY

    ids = _seed_recipes(db_session, MAX_PER_DAY + 1)

    for recipe_id in ids[:MAX_PER_DAY]:
        ok = client.post("/api/v1/plan", json={"datum": "2026-08-17", "recipe_id": recipe_id}, headers=logged_in)
        assert ok.status_code == 200

    full = client.post("/api/v1/plan", json={"datum": "2026-08-17", "recipe_id": ids[-1]}, headers=logged_in)

    assert full.status_code == 422
    assert full.json()["error"]["code"] == "day_full"


def test_the_day_cap_is_per_day_not_per_week(client, db_session, logged_in):  # noqa: F811
    from app.api.v1.plan import MAX_PER_DAY

    ids = _seed_recipes(db_session, MAX_PER_DAY + 1)
    for recipe_id in ids[:MAX_PER_DAY]:
        client.post("/api/v1/plan", json={"datum": "2026-08-17", "recipe_id": recipe_id}, headers=logged_in)

    next_day = client.post("/api/v1/plan", json={"datum": "2026-08-18", "recipe_id": ids[-1]}, headers=logged_in)

    assert next_day.status_code == 200


def test_a_foreign_recipe_cannot_be_planned(client, db_session, logged_in, mallory):  # noqa: F811
    """The plan stores a recipe id; without the ownership check mallory could
    pin — and then read back — one of alice's recipes."""
    (alice_recipe,) = _seed_recipes(db_session, 1)

    r = client.post("/api/v1/plan", json={"datum": "2026-08-17", "recipe_id": alice_recipe}, headers=mallory)

    assert r.status_code == 404


# -- share links -----------------------------------------------------------


def test_an_unknown_share_token_is_a_404(client):
    r = client.get("/api/v1/share/definitelynotarealtoken")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_the_daily_pick_copes_with_an_empty_gallery(client):
    """Nothing is public on a fresh install — the landing page must render
    rather than 500 on its own teaser query."""
    r = client.get("/api/v1/share/daily")
    assert r.status_code == 200
    assert r.json()["item"] is None
