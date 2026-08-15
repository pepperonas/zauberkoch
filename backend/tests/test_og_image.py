"""OG-card helpers: duration wording, motif choice, and the two fallbacks.

The share card is the only surface a stranger sees before deciding to click,
and it is rendered server-side with no browser to catch a mistake. These are
the pure pieces; `test_share.py` covers the endpoint that assembles them.

`_fmt_min` matters twice over: the card and the app must say the same thing
about the same recipe, and the frontend has its own implementation of exactly
this rule (`strings.units.duration`). The table below is the shared contract.
"""

import pytest

from app.services import og_image
from app.services.og_image import (
    MOTIF_VARIANTS,
    _fmt_min,
    _font,
    motif_for_recipe,
    variant_for,
    variant_for_motif,
)


# -- duration wording ------------------------------------------------------


@pytest.mark.parametrize(
    "minutes, expected",
    [
        (5, "5 Min."),
        (89, "89 Min."),  # last minute before the switch to hours
        (90, "1 h 30 Min."),
        (120, "2 h"),  # a whole number of hours drops the minutes
        (195, "3 h 15 Min."),
        (2879, "47 h 59 Min."),  # last minute before the switch to days
        (2880, "2 Tage"),
        (1440 * 3, "3 Tage"),
        (2160, "36 h"),  # 1.5 days still reads in hours — see below
        (1440 * 2 + 60, "2 Tage 1 h"),
    ],
)
def test_duration_wording(minutes, expected):
    assert _fmt_min(minutes) == expected


def test_days_only_start_at_48_hours():
    """A sourdough at 36 h reads better as "36 h" than as "1 Tag 12 h", so the
    day format waits until two full days. Side effect worth recording: the
    singular "1 Tag" in `_fmt_min` is therefore unreachable — it is kept as
    defensive wording in case the threshold is ever lowered."""
    assert _fmt_min(47 * 60 + 59).endswith("Min.")
    assert "Tag" not in _fmt_min(47 * 60 + 59)
    assert _fmt_min(48 * 60) == "2 Tage"


def test_a_rounding_edge_never_prints_24_hours():
    """`round(rest / 60)` can land on 24 — "3 Tage 24 h" would be nonsense, so
    it has to roll over into the next day."""
    # 3 days + 23h50m rounds to 24 h and must become 4 days.
    assert _fmt_min(1440 * 3 + 23 * 60 + 50) == "4 Tage"


def test_zero_minutes_is_still_a_sentence():
    assert _fmt_min(0) == "0 Min."


# -- variant selection -----------------------------------------------------


def test_a_single_variant_motif_always_picks_index_zero():
    """Asking for variant 1 of 1 would render a missing file."""
    assert variant_for("irgendein Titel", 1) == 0
    assert variant_for("irgendein Titel", 0) == 0


def test_single_variant_motifs_short_circuit_before_the_hints():
    single = [m for m, count in MOTIF_VARIANTS.items() if count == 1]
    assert single, "the fixture assumes at least one single-variant motif exists"
    for motif in single:
        assert variant_for_motif(motif, "Beliebiger Titel") == 0


def test_the_variant_is_stable_for_the_same_title():
    """The OG image is cached by URL — a title must not drift between renders."""
    for _ in range(5):
        assert variant_for("Pasta al Limone", 3) == variant_for("Pasta al Limone", 3)


def test_the_variant_stays_inside_the_available_range():
    for motif, count in MOTIF_VARIANTS.items():
        for title in ("Pasta al Limone", "Gin Sour", "Ärger mit Ümläuten", ""):
            assert 0 <= variant_for_motif(motif, title) < count


# -- motif matching --------------------------------------------------------


@pytest.mark.parametrize(
    "recipe, mode, expected",
    [
        ({"titel": "Spaghetti alle Vongole"}, "kochen", "pasta"),
        ({"titel": "Pizza Margherita"}, "kochen", "pizza"),
        ({"titel": "Ramen mit Chashu"}, "kochen", "suppe"),
        ({"titel": "Caesar Salad"}, "kochen", "salat"),
        ({"titel": "Etwas völlig Namenloses"}, "kochen", "bowl"),  # fallback
        ({"titel": "Mai Tai", "glas": "Tiki-Becher"}, "cocktail", "tiki"),
        ({"titel": "Paloma", "glas": "Highball"}, "cocktail", "highball"),
        ({"titel": "Namenloser Drink", "glas": ""}, "cocktail", "tumbler"),  # fallback
    ],
)
def test_motif_matching(recipe, mode, expected):
    assert motif_for_recipe(recipe, mode) == expected


def test_the_stated_glass_beats_a_word_in_the_title():
    """"Espresso Martini" served in a coupe is a coupe — the glass field is the
    more reliable signal and is checked first."""
    recipe = {"titel": "Espresso Martini", "glas": "Coupette"}
    assert motif_for_recipe(recipe, "cocktail") == "coupe"


def test_tags_and_cuisine_also_feed_the_match():
    recipe = {"titel": "Nonnas Sonntagsessen", "tags": ["pasta"], "kueche": "Italienisch"}
    assert motif_for_recipe(recipe, "kochen") == "pasta"


def test_a_recipe_without_any_text_still_gets_a_motif():
    """The renderer must never fail on a sparse row; every path ends in a
    fallback rather than a KeyError."""
    assert motif_for_recipe({}, "kochen") == "bowl"
    assert motif_for_recipe({}, "cocktail") == "tumbler"


# -- fallbacks -------------------------------------------------------------


def test_a_missing_font_falls_back_instead_of_crashing(caplog):
    """A share link must still render if the font files are not deployed —
    an unstyled card beats a 500 in someone's chat app."""
    font = _font("does-not-exist.ttf", 40, 700)
    assert font is not None
    assert "missing" in caplog.text


def test_a_static_font_without_weight_axes_is_accepted():
    """`set_variation_by_axes` raises on a non-variable font; that is expected,
    not fatal — the weight simply cannot be applied."""
    real = og_image.ImageFont.truetype

    class Static:
        def set_variation_by_axes(self, axes):
            raise OSError("not a variable font")

    og_image.ImageFont.truetype = lambda *a, **kw: Static()  # type: ignore[assignment]
    try:
        assert isinstance(_font("whatever.ttf", 40, 700), Static)
    finally:
        og_image.ImageFont.truetype = real  # type: ignore[assignment]


def test_a_missing_motif_asset_leaves_the_card_intact(monkeypatch, caplog):
    """The art is exported from the frontend; if that step is skipped, the card
    loses its illustration but keeps title, teaser and branding."""
    from pathlib import Path

    from PIL import Image

    monkeypatch.setattr(og_image, "_motif_path", lambda *a, **kw: Path("/nope/missing.png"))
    img = Image.new("RGB", (og_image.W, og_image.H), "white")
    before = img.tobytes()

    og_image._paste_motif(img, {"titel": "X"}, "kochen", og_image.PALETTES["kochen"])

    assert img.tobytes() == before, "nothing should have been drawn"
    assert "motif asset" in caplog.text
