"""Share links, adopt, OG image, and shopping clear/replace (undo base)."""

import pytest

from app.services import ratelimit_ip
from tests.test_auth import add_to_allowlist, do_login_callback, fake_claims
from tests.test_generation import PARAMS, generate, logged_in, mock_ai  # noqa: F401 (fixtures)


@pytest.fixture(autouse=True)
def _reset_ip_limits():
    ratelimit_ip.reset()
    yield
    ratelimit_ip.reset()


def _shared_recipe(client, headers):
    recipe_id = generate(client, headers)[-1][1]["recipe_id"]
    r = client.post(f"/api/v1/recipes/{recipe_id}/share", headers=headers)
    assert r.status_code == 200
    return recipe_id, r.json()


# ---- share links ------------------------------------------------------------

def test_share_create_is_idempotent(client, logged_in, mock_ai):  # noqa: F811
    recipe_id, first = _shared_recipe(client, logged_in)
    second = client.post(f"/api/v1/recipes/{recipe_id}/share", headers=logged_in).json()
    assert first["share_token"] == second["share_token"]
    assert first["share_url"].endswith(f"/r/{first['share_token']}")


def test_public_share_needs_no_auth(client, logged_in, mock_ai):  # noqa: F811
    _, share = _shared_recipe(client, logged_in)
    fresh = client  # same client but endpoint requires no session/CSRF
    r = fresh.get(f"/api/v1/share/{share['share_token']}")
    assert r.status_code == 200
    body = r.json()
    assert body["recipe"]["titel"] == "Pasta al Limone"
    assert body["mode"] == "kochen"
    # the admin-configured intro animation rides along (public, no auth needed)
    assert body["intro"] in {"motif", "crt", "off"}


def test_revoke_kills_link(client, logged_in, mock_ai):  # noqa: F811
    recipe_id, share = _shared_recipe(client, logged_in)
    client.delete(f"/api/v1/recipes/{recipe_id}/share", headers=logged_in)
    assert client.get(f"/api/v1/share/{share['share_token']}").status_code == 404


def test_unknown_token_404(client):
    assert client.get("/api/v1/share/doesnotexist1").status_code == 404


def test_adopt_copies_recipe(client, db_session, logged_in, mock_ai, monkeypatch):  # noqa: F811
    _, share = _shared_recipe(client, logged_in)

    # second user logs in and adopts
    add_to_allowlist(db_session, "bob@example.com")
    do_login_callback(client, monkeypatch, claims=fake_claims(email="bob@example.com", sub="sub-bob"))
    csrf = client.get("/api/v1/me").json()["csrf_token"]

    r = client.post(f"/api/v1/share/{share['share_token']}/adopt", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200
    new_id = r.json()["recipe_id"]

    detail = client.get(f"/api/v1/recipes/{new_id}").json()
    assert detail["recipe"]["titel"] == "Pasta al Limone"


def test_og_motif_assets_and_matcher():
    from app.services.og_image import MOTIF_DIR, MOTIF_VARIANTS, motif_for_recipe, variant_for

    # every declared motif variant must have an exported PNG
    for name, count in MOTIF_VARIANTS.items():
        for v in range(count):
            assert (MOTIF_DIR / f"{name}-v{v}.png").exists(), f"missing motif asset: {name}-v{v}"

    # hash parity constants — mirrored in frontend RecipeMotif.test.ts
    assert variant_for("Spaghetti alle Vongole", 3) == 0
    assert variant_for("Jungle Bird", 3) == 1
    assert variant_for("Tequila Sunrise", 3) == 2
    assert variant_for("Spaghetti alle Vongole", 2) == 1

    # semantic hints beat the hash (mirrored in RecipeMotif.test.ts)
    from app.services.og_image import variant_for_motif

    assert variant_for_motif("bowl", "Thailändisches Massaman-Curry mit Rindfleisch") == 1
    assert variant_for_motif("pasta", "Spaghetti Carbonara") == 2
    assert variant_for_motif("pasta", "Pasta al Pesto Genovese") == 1
    assert variant_for_motif("steak", "Wiener Schnitzel") == 1
    assert variant_for_motif("highball", "Mojito Royal") == 2
    assert variant_for_motif("pasta", "Spaghetti alle Vongole") == 2
    assert variant_for_motif("coupe", "Gin Sour Royal") == 2
    assert variant_for_motif("sushi", "California Maki") == 1
    assert variant_for_motif("sushi", "Lachs Nigiri") == 0
    assert variant_for_motif("spiess", "Garnelenspieß") == 1
    assert variant_for_motif("mug", "Irish Coffee") == 1
    assert variant_for_motif("shot", "B-52 Shot") == 1
    assert variant_for_motif("kuchen", "Schwarzwälder Torte") == 1

    assert motif_for_recipe({"titel": "Jungle Bird", "glas": "Tiki-Becher"}, "cocktail") == "tiki"
    assert motif_for_recipe({"titel": "Espresso Martini", "glas": "Cocktailschale"}, "cocktail") == "coupe"
    assert motif_for_recipe({"titel": "Gambas al Ajillo mit knusprigem Brot"}, "kochen") == "fisch"
    assert motif_for_recipe({"titel": "Spaghetti alle Vongole"}, "kochen") == "pasta"
    # new motifs (matcher order + reassignments)
    assert motif_for_recipe({"titel": "Frozen Margarita"}, "cocktail") == "margarita"
    assert motif_for_recipe({"titel": "Feuerzangenbowle"}, "cocktail") == "punch"
    assert motif_for_recipe({"titel": "Weizenbier"}, "cocktail") == "beer"
    assert motif_for_recipe({"titel": "Irish Coffee"}, "cocktail") == "mug"
    assert motif_for_recipe({"titel": "Glühwein"}, "cocktail") == "wine"
    assert motif_for_recipe({"titel": "Lachs Nigiri"}, "kochen") == "sushi"
    assert motif_for_recipe({"titel": "Chicken Burrito"}, "kochen") == "wrap"
    assert motif_for_recipe({"titel": "Gyoza mit Ponzu"}, "kochen") == "dumpling"
    assert motif_for_recipe({"titel": "Käsekuchen"}, "kochen") == "kuchen"
    assert motif_for_recipe({"titel": "Hähnchenspieß"}, "kochen") == "spiess"
    assert motif_for_recipe({"titel": "Rustikales Sauerteigbrot"}, "kochen") == "brot"
    assert motif_for_recipe({"titel": "Irgendwas"}, "kochen") == "bowl"


def test_og_wrap_respects_line_budget():
    """max_lines=1 used to leak ALL lines (break condition never fired)."""
    from PIL import Image, ImageDraw

    from app.services.og_image import _font, _wrap

    d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    f = _font("Inter.ttf", 33, 400)
    long = "Klassiker aus Neapel mit Muscheln Weißwein Knoblauch und ganz viel Petersilie obendrauf"
    assert len(_wrap(d, long, f, 300, 1)) == 1
    assert _wrap(d, long, f, 300, 1)[0].endswith("…")
    assert len(_wrap(d, long, f, 300, 2)) == 2
    assert _wrap(d, long, f, 300, 0) == []


def test_og_png_renders(client, logged_in, mock_ai):  # noqa: F811
    _, share = _shared_recipe(client, logged_in)
    r = client.get(f"/api/v1/share/{share['share_token']}/og.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    from PIL import Image
    from io import BytesIO

    img = Image.open(BytesIO(r.content))
    assert img.size == (1200, 630)


def test_share_html_page_has_og_meta(client, logged_in, mock_ai):  # noqa: F811
    _, share = _shared_recipe(client, logged_in)
    r = client.get(f"/r/{share['share_token']}")
    assert r.status_code == 200
    assert 'og:title' in r.text
    assert 'Pasta al Limone' in r.text
    assert f"/api/v1/share/{share['share_token']}/og.png" in r.text
    assert 'rel="canonical"' in r.text
    assert 'og:image:alt' in r.text


def test_share_page_replaces_root_meta_and_title(client, logged_in, mock_ai, monkeypatch, tmp_path):  # noqa: F811
    """The static root OG block must be stripped and <title> replaced — otherwise
    crawlers read the root tags (first in <head>) instead of the recipe's."""
    from app.api.v1 import share as share_module

    shell = tmp_path / "index.html"
    shell.write_text(
        "<!doctype html><html><head>"
        "<title>Zauberkoch — KI-Rezepte &amp; Cocktails</title>"
        "<!-- zk:root-meta:start — stripped & replaced by share.py on /r/{token} pages -->"
        '<meta property="og:title" content="ROOT-OG-TITLE">'
        '<link rel="canonical" href="https://zauberkoch.de/">'
        "<!-- zk:root-meta:end -->"
        "</head><body></body></html>",
        encoding="utf-8",
    )
    monkeypatch.setattr(share_module, "WEBROOT_INDEX", shell)

    _, share = _shared_recipe(client, logged_in)
    r = client.get(f"/r/{share['share_token']}")
    assert r.status_code == 200
    assert "ROOT-OG-TITLE" not in r.text
    assert 'href="https://zauberkoch.de/"' not in r.text  # root canonical gone
    assert "<title>Pasta al Limone — Zauberkoch</title>" in r.text
    assert r.text.count("og:title") == 1  # exactly the recipe's


# ---- shopping clear-all + replace (undo base) --------------------------------

def test_shopping_clear_all_and_replace_restores(client, logged_in, mock_ai):  # noqa: F811
    client.post("/api/v1/shopping/items", json={"name": "Zitronen", "menge": 3, "einheit": "Stück"}, headers=logged_in)
    client.post("/api/v1/shopping/items", json={"name": "Olivenöl"}, headers=logged_in)

    snapshot = client.get("/api/v1/shopping").json()["items"]
    assert len(snapshot) == 2

    r = client.delete("/api/v1/shopping", headers=logged_in)
    assert r.json()["items"] == []

    restore = [{"name": i["name"], "menge": i["menge"], "einheit": i["einheit"], "checked": i["checked"]} for i in snapshot]
    r = client.post("/api/v1/shopping/replace", json={"items": restore}, headers=logged_in)
    names = [i["name"] for i in r.json()["items"]]
    assert names == ["Zitronen", "Olivenöl"]


# ---- gallery / discover / story / sitemap ------------------------------------

def test_public_gallery_flow(client, logged_in, mock_ai):  # noqa: F811
    recipe_id, share = _shared_recipe(client, logged_in)

    # not listed by default
    assert client.get("/api/v1/share/discover").json()["items"] == []

    # opt in -> appears in gallery, daily and sitemap
    r = client.patch(f"/api/v1/recipes/{recipe_id}/share", json={"public": True}, headers=logged_in)
    assert r.json() == {"public": True}
    items = client.get("/api/v1/share/discover").json()["items"]
    assert len(items) == 1 and items[0]["token"] == share["share_token"]
    assert client.get("/api/v1/share/daily").json()["item"]["titel"] == "Pasta al Limone"
    sitemap = client.get("/sitemap.xml").text
    assert f"/r/{share['share_token']}" in sitemap
    assert "<urlset" in sitemap

    # revoke kills listing too
    client.delete(f"/api/v1/recipes/{recipe_id}/share", headers=logged_in)
    assert client.get("/api/v1/share/discover").json()["items"] == []


def test_patch_share_requires_share(client, logged_in, mock_ai):  # noqa: F811
    from tests.test_generation import generate as gen

    recipe_id = gen(client, logged_in)[-1][1]["recipe_id"]
    r = client.patch(f"/api/v1/recipes/{recipe_id}/share", json={"public": True}, headers=logged_in)
    assert r.status_code == 409


def test_story_png_renders(client, logged_in, mock_ai):  # noqa: F811
    _, share = _shared_recipe(client, logged_in)
    r = client.get(f"/api/v1/share/{share['share_token']}/story.png")
    assert r.status_code == 200

    from io import BytesIO

    from PIL import Image

    assert Image.open(BytesIO(r.content)).size == (1080, 1920)
