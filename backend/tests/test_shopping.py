"""Aggregation service + shopping/favorites endpoints."""

import pytest

from app.services import aggregation, ratelimit_ip
from app.services.aggregation import format_amount, normalize
from tests.test_generation import PARAMS, generate, logged_in, mock_ai  # noqa: F401 (fixtures)


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


# --- aggregation unit tests -------------------------------------------------

def test_normalize_converts_to_base_units():
    assert normalize("Mehl", 1.5, "kg").menge == 1500
    assert normalize("Mehl", 1.5, "kg").einheit == "g"
    assert normalize("Rum", 4, "cl").menge == 40
    assert normalize("Rum", 4, "cl").einheit == "ml"
    assert normalize("Milch", 1, "l").menge == 1000


def test_normalize_handles_free_text_amounts():
    n = normalize("Salz", "nach Geschmack", "")
    assert n.menge is None
    assert n.einheit == ""


def test_normalize_unknown_unit_kept_verbatim():
    n = normalize("Basilikum", 2, "Töpfe")
    assert n.einheit == "Töpfe"
    assert n.menge == 2


def test_format_amount_upscales():
    assert format_amount(1500, "g") == (1.5, "kg")
    assert format_amount(2000, "ml") == (2.0, "l")
    assert format_amount(250, "g") == (250, "g")


# --- endpoints ---------------------------------------------------------------

def _generate_recipe(client, headers):
    events = generate(client, headers)
    return events[-1][1]["recipe_id"]


def test_favorite_toggle_and_filter(client, logged_in, mock_ai):  # noqa: F811
    recipe_id = _generate_recipe(client, logged_in)

    r = client.put(f"/api/v1/recipes/{recipe_id}/favorite", headers=logged_in)
    assert r.json()["is_favorite"] is True
    assert client.get("/api/v1/recipes?favorites_only=true").json()["items"][0]["id"] == recipe_id

    r = client.delete(f"/api/v1/recipes/{recipe_id}/favorite", headers=logged_in)
    assert r.json()["is_favorite"] is False
    assert client.get("/api/v1/recipes?favorites_only=true").json()["items"] == []


def test_shopping_from_recipe_aggregates_duplicates(client, logged_in, mock_ai):  # noqa: F811
    recipe_id = _generate_recipe(client, logged_in)

    r = client.post("/api/v1/shopping/from-recipe", json={"recipe_id": recipe_id}, headers=logged_in)
    items = {i["name"]: i for i in r.json()["items"]}
    assert items["Spaghetti"]["menge"] == 250

    # adding the same recipe again doubles the amounts instead of duplicating rows
    r = client.post("/api/v1/shopping/from-recipe", json={"recipe_id": recipe_id}, headers=logged_in)
    rows = r.json()["items"]
    spaghetti = [i for i in rows if i["name"] == "Spaghetti"]
    assert len(spaghetti) == 1
    assert spaghetti[0]["menge"] == 500


def test_shopping_from_recipe_scales_portions(client, logged_in, mock_ai):  # noqa: F811
    recipe_id = _generate_recipe(client, logged_in)  # recipe has 2 portions, 250 g spaghetti
    r = client.post(
        "/api/v1/shopping/from-recipe", json={"recipe_id": recipe_id, "portionen": 4}, headers=logged_in
    )
    items = {i["name"]: i for i in r.json()["items"]}
    assert items["Spaghetti"]["menge"] == 500


def test_shopping_check_reorder_and_clear(client, logged_in, mock_ai):  # noqa: F811
    a = client.post("/api/v1/shopping/items", json={"name": "Zitronen", "menge": 3, "einheit": "Stück"}, headers=logged_in).json()
    b = client.post("/api/v1/shopping/items", json={"name": "Olivenöl"}, headers=logged_in).json()

    r = client.post("/api/v1/shopping/reorder", json={"ids": [b["id"], a["id"]]}, headers=logged_in)
    assert [i["id"] for i in r.json()["items"]] == [b["id"], a["id"]]

    client.patch(f"/api/v1/shopping/items/{a['id']}", json={"checked": True}, headers=logged_in)
    r = client.delete("/api/v1/shopping/checked", headers=logged_in)
    remaining = r.json()["items"]
    assert [i["id"] for i in remaining] == [b["id"]]


def test_shopping_requires_csrf(client, logged_in, mock_ai):  # noqa: F811
    r = client.post("/api/v1/shopping/items", json={"name": "X"})
    assert r.status_code == 403


class TestUnitSpellings:
    """The merge key is (name, unit), so a unit that normalizes differently
    splits one ingredient into two shopping-list lines. Abbreviations arrive
    from the model in every shape — they all have to land on one key."""

    def test_trailing_periods_do_not_create_their_own_unit(self):
        from app.services.aggregation import normalize

        for spelling in ("Stück", "Stk", "Stk.", "St.", "stk."):
            assert normalize("Tomate", 1, spelling).einheit == "Stück", spelling

    def test_spelled_out_spoons_match_their_abbreviation(self):
        from app.services.aggregation import normalize

        for spelling in ("EL", "el", "el.", "Esslöffel", "Essloeffel"):
            assert normalize("Öl", 1, spelling).einheit == "EL", spelling
        for spelling in ("TL", "tl.", "Teelöffel", "Teeloeffel"):
            assert normalize("Salz", 1, spelling).einheit == "TL", spelling

    def test_volume_and_weight_collapse_to_one_base_unit(self):
        from app.services.aggregation import normalize

        assert normalize("Milch", 1, "l").menge == 1000
        assert normalize("Milch", 1, "dl").menge == 100
        assert normalize("Gin", 5, "cl").menge == 50
        assert normalize("Mehl", 1, "kg").menge == 1000
        assert normalize("Mehl", 100, "gr").einheit == "g"

    def test_plurals_fold_to_the_singular(self):
        from app.services.aggregation import normalize

        for singular, plural in (("Scheibe", "Scheiben"), ("Zehe", "Zehen"), ("Dose", "Dosen"),
                                 ("Tasse", "Tassen"), ("Packung", "Packungen")):
            assert normalize("X", 1, plural).einheit == singular, plural

    def test_two_spellings_of_the_same_unit_merge_into_one_line(
        self, client, logged_in, mock_ai, db_session
    ):
        """End to end: the symptom this fixes is a duplicated line."""
        from app.models import ShoppingListItem

        client.post("/api/v1/shopping/items", json={"name": "Tomate", "menge": 2, "einheit": "Stk."},
                    headers=logged_in)
        client.post("/api/v1/shopping/items", json={"name": "Tomate", "menge": 1, "einheit": "Stück"},
                    headers=logged_in)
        items = client.get("/api/v1/shopping").json()["items"]
        tomaten = [i for i in items if i["name"].lower() == "tomate"]
        assert len(tomaten) == 1, f"split into {len(tomaten)} lines: {tomaten}"
        assert tomaten[0]["menge"] == 3

    def test_an_unknown_unit_is_kept_verbatim(self):
        from app.services.aggregation import normalize

        assert normalize("Sternanis", 2, "Sterne").einheit == "Sterne"

    def test_adding_the_same_thing_twice_by_hand_merges(self, client, logged_in):
        """The recipe path always merged; the manual one appended blindly, so
        typing "Tomate" twice left two identical lines."""
        client.post("/api/v1/shopping/items", json={"name": "Tomate"}, headers=logged_in)
        client.post("/api/v1/shopping/items", json={"name": "tomate"}, headers=logged_in)
        items = client.get("/api/v1/shopping").json()["items"]
        assert len([i for i in items if i["name"].lower() == "tomate"]) == 1

    def test_a_checked_line_is_not_merged_into(self, client, logged_in):
        """Something already ticked off is done — a new need starts a new line."""
        first = client.post("/api/v1/shopping/items", json={"name": "Butter", "menge": 100, "einheit": "g"},
                            headers=logged_in).json()
        client.patch(f"/api/v1/shopping/items/{first['id']}", json={"checked": True}, headers=logged_in)
        client.post("/api/v1/shopping/items", json={"name": "Butter", "menge": 50, "einheit": "g"},
                    headers=logged_in)
        items = client.get("/api/v1/shopping").json()["items"]
        assert len([i for i in items if i["name"] == "Butter"]) == 2


# -- merge-key helpers -----------------------------------------------------
# The spelling table itself is covered by TestUnitSpellings above; what is
# missing there is the *negative* side and the display/merge-key split.


def test_different_units_stay_apart():
    """Merging is only safe within a dimension — 2 Bund and 2 Zehen Knoblauch
    are not 4 of anything."""
    bund = aggregation.normalize("Knoblauch", 2, "Bund")
    zehen = aggregation.normalize("Knoblauch", 2, "Zehen")
    assert aggregation.merge_key(bund) != aggregation.merge_key(zehen)


def test_name_matching_ignores_case_and_padding_only():
    """Case and whitespace are noise; a different word is a different item."""
    assert aggregation.normalize("  Tomate ", 1, "Stk").name_key == aggregation.normalize("tomate", 1, "Stk").name_key
    assert aggregation.normalize("Tomate", 1, "Stk").name_key != aggregation.normalize("Tomaten", 1, "Stk").name_key


def test_display_name_keeps_the_original_spelling():
    """The merge key is lowercased, but the list must not shout back in
    lowercase — the shopper reads the display name."""
    item = aggregation.normalize("  Fior di Latte ", 250, "g")
    assert item.name == "Fior di Latte"
    assert item.name_key == "fior di latte"


# -- display formatting ----------------------------------------------------


@pytest.mark.parametrize(
    "menge, einheit, expected",
    [
        (999, "g", (999, "g")),
        (1000, "g", (1.0, "kg")),  # boundary: exactly 1000 flips
        (1500, "g", (1.5, "kg")),
        (999, "ml", (999, "ml")),
        (1000, "ml", (1.0, "l")),
        (2, "Stück", (2, "Stück")),  # unrelated units are untouched
        (1000, "Stück", (1000, "Stück")),  # 1000 pieces are not 1 "kStück"
    ],
)
def test_format_amount_boundaries(menge, einheit, expected):
    assert aggregation.format_amount(menge, einheit) == expected


def test_format_amount_rounds_to_two_places():
    """Floating-point sums like 0.1+0.2 must not reach the user as 0.30000000004."""
    assert aggregation.format_amount(0.1 + 0.2, "kg") == (0.3, "kg")


# -- scaling ---------------------------------------------------------------


def test_scale_multiplies_numbers_and_passes_text_through():
    assert aggregation.scale(250, 2) == 500.0
    assert aggregation.scale("nach Geschmack", 3) == "nach Geschmack"
    assert aggregation.scale(None, 3) is None


def test_scale_by_one_is_lossless():
    """Serving-size scaling runs on every cache hit; factor 1 must be a no-op."""
    assert aggregation.scale(0.5, 1) == 0.5


# -- merge branches in "add a whole recipe" --------------------------------


def test_a_nameless_ingredient_is_skipped(client, db_session, logged_in, mock_ai):  # noqa: F811
    """A blank name would show up as an empty row nobody can act on."""
    import json

    from app.models import Recipe, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    recipe = Recipe(
        user_id=alice.id, mode="kochen", params_json="{}",
        recipe_json=json.dumps({
            "titel": "Lücke", "portionen": 2,
            "zutaten": [{"name": "   ", "menge": 1, "einheit": "Stück"},
                        {"name": "Salz", "menge": None, "einheit": ""}],
            "schritte": [],
        }),
        titel="Lücke", kueche="Test", prompt_version="v5", model="test",
    )
    db_session.add(recipe)
    db_session.commit()

    r = client.post("/api/v1/shopping/from-recipe", json={"recipe_id": recipe.id}, headers=logged_in)

    assert [i["name"] for i in r.json()["items"]] == ["Salz"]


def test_a_free_text_ingredient_already_on_the_list_is_not_duplicated(client, db_session, logged_in, mock_ai):  # noqa: F811
    """"Salz — nach Geschmack" has no amount to add up, so a second recipe
    calling for it must leave the single row alone."""
    import json

    from app.models import Recipe, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    body = json.dumps({
        "titel": "Salzig", "portionen": 2,
        "zutaten": [{"name": "Salz", "menge": "nach Geschmack", "einheit": ""}],
        "schritte": [],
    })
    for _ in range(2):
        recipe = Recipe(
            user_id=alice.id, mode="kochen", params_json="{}", recipe_json=body,
            titel="Salzig", kueche="Test", prompt_version="v5", model="test",
        )
        db_session.add(recipe)
        db_session.commit()
        r = client.post("/api/v1/shopping/from-recipe", json={"recipe_id": recipe.id}, headers=logged_in)

    salz = [i for i in r.json()["items"] if i["name"] == "Salz"]
    assert len(salz) == 1
    assert salz[0]["menge"] is None


def test_the_list_has_a_hard_ceiling(client, db_session, logged_in, mock_ai):  # noqa: F811
    """Bulk-adding a whole week of recipes must not grow the list without
    bound — the UI would become unusable long before the DB minded."""
    import json

    from app.api.v1.shopping import MAX_ITEMS
    from app.models import Recipe, ShoppingListItem, User

    alice = db_session.query(User).filter(User.email == "alice@example.com").one()
    for i in range(MAX_ITEMS):
        db_session.add(ShoppingListItem(user_id=alice.id, name=f"Ding {i}", menge=1, einheit="Stück", position=i))
    recipe = Recipe(
        user_id=alice.id, mode="kochen", params_json="{}",
        recipe_json=json.dumps({
            "titel": "Einer zu viel", "portionen": 2,
            "zutaten": [{"name": "Tropfen zuviel", "menge": 1, "einheit": "Stück"}],
            "schritte": [],
        }),
        titel="Einer zu viel", kueche="Test", prompt_version="v5", model="test",
    )
    db_session.add(recipe)
    db_session.commit()

    r = client.post("/api/v1/shopping/from-recipe", json={"recipe_id": recipe.id}, headers=logged_in)

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "list_full"


def test_deleting_an_item_removes_exactly_that_row(client, logged_in, mock_ai):  # noqa: F811
    a = client.post("/api/v1/shopping/items", json={"name": "Zitronen", "menge": 3, "einheit": "Stück"}, headers=logged_in).json()
    b = client.post("/api/v1/shopping/items", json={"name": "Olivenöl"}, headers=logged_in).json()

    r = client.delete(f"/api/v1/shopping/items/{a['id']}", headers=logged_in)

    assert r.json() == {"deleted": True}
    remaining = [i["id"] for i in client.get("/api/v1/shopping", headers=logged_in).json()["items"]]
    assert remaining == [b["id"]]
