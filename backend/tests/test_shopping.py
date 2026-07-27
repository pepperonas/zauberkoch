"""Aggregation service + shopping/favorites endpoints."""

import pytest

from app.services import ratelimit_ip
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
