"""Incremental parser: token chunks in -> semantic events out."""

import json

from app.services.json_stream import RecipeStreamParser, replay_events

RECIPE = {
    "titel": "Pasta al Limone",
    "teaser": "Cremig-frische Zitronenpasta.",
    "kueche": "Italienisch",
    "tags": ["pasta", "schnell"],
    "portionen": 2,
    "zeit_aktiv": 15,
    "zeit_gesamt": 20,
    "schwierigkeit": "einfach",
    "zutaten": [
        {"menge": 250, "einheit": "g", "name": "Spaghetti", "gruppe": ""},
        {"menge": 1, "einheit": "Stück", "name": "Bio-Zitrone", "gruppe": ""},
        {"menge": 60, "einheit": "g", "name": "Parmesan", "gruppe": ""},
    ],
    "schritte": [
        {"nr": 1, "titel": "Kochen", "text": "Spaghetti in Salzwasser kochen.", "dauer_sek": 540},
        {"nr": 2, "titel": "Mischen", "text": "Mit Zitrone und Parmesan mischen.", "dauer_sek": None},
    ],
    "tipps": ["Pasta-Wasser aufheben — die Stärke bindet die Sauce."],
    "naehrwerte": {"kalorien_kcal": 560, "eiweiss_g": 21.0, "fett_g": 14.0, "kohlenhydrate_g": 86.0},
    "glas": None,
    "garnitur": None,
}


def stream_in_chunks(text: str, size: int):
    parser = RecipeStreamParser()
    events = []
    for i in range(0, len(text), size):
        events += parser.feed(text[i : i + size])
    events += parser.finish()
    return events


def test_full_stream_small_chunks():
    raw = json.dumps(RECIPE, ensure_ascii=False)
    events = stream_in_chunks(raw, 7)
    names = [n for n, _ in events]

    assert names.count("meta") == 1
    assert names.count("zutat") == 3
    assert names.count("schritt") == 2
    assert names.count("tipp") == 1
    assert names[-1] == "done"
    assert "error" not in names

    meta = dict(events)["meta"]
    assert meta["titel"] == "Pasta al Limone"
    assert meta["portionen"] == 2

    done = events[-1][1]
    assert done["zutaten"][2]["name"] == "Parmesan"


def test_meta_comes_before_first_zutat():
    raw = json.dumps(RECIPE, ensure_ascii=False)
    events = stream_in_chunks(raw, 3)
    names = [n for n, _ in events]
    assert names.index("meta") < names.index("zutat")


def test_events_identical_regardless_of_chunk_size():
    raw = json.dumps(RECIPE, ensure_ascii=False)
    a = stream_in_chunks(raw, 1)
    b = stream_in_chunks(raw, 500)
    assert [n for n, _ in a] == [n for n, _ in b]
    assert a[-1][1] == b[-1][1]


def test_markdown_fences_are_tolerated():
    raw = "```json\n" + json.dumps(RECIPE, ensure_ascii=False) + "\n```"
    events = stream_in_chunks(raw, 11)
    assert events[-1][0] == "done"


def test_invalid_json_yields_error():
    parser = RecipeStreamParser()
    parser.feed('{"titel": "kaputt", "zutaten": [')
    events = parser.finish()
    assert events[-1][0] == "error"


def test_incomplete_last_item_not_emitted_early():
    raw = json.dumps(RECIPE, ensure_ascii=False)
    cut = raw.find('"Parmesan"') + len('"Parmesan"')  # third ingredient still open
    parser = RecipeStreamParser()
    events = parser.feed(raw[:cut])
    assert [n for n, _ in events].count("zutat") == 2  # third is incomplete


def test_replay_matches_live_event_shape():
    live = stream_in_chunks(json.dumps(RECIPE, ensure_ascii=False), 9)
    replay = replay_events(RECIPE)
    assert [n for n, _ in live] == [n for n, _ in replay]


# -- repairing a half-written buffer --------------------------------------


def test_quote_inside_a_string_does_not_close_it_early():
    """A title like `Pasta "al dente"` contains escaped quotes. Treating the
    first one as the end of the string would corrupt every later bracket count
    and the stream would emit nothing at all."""
    recipe = dict(RECIPE, titel='Pasta \\"al dente\\" al Limone')
    raw = json.dumps(recipe, ensure_ascii=False)
    events = stream_in_chunks(raw, 5)
    assert events[-1][0] == "done"
    assert dict(events)["meta"]["titel"] == 'Pasta \\"al dente\\" al Limone'


def test_trailing_backslash_mid_escape_waits_instead_of_breaking():
    """The chunk boundary can land between a backslash and the character it
    escapes; closing the string there would produce invalid JSON."""
    parser = RecipeStreamParser()
    parser.feed('{"titel": "Sauce Beurre Blanc\\')
    events = parser.feed('u00e9", "zutaten": [')
    assert [n for n, _ in events] == ["meta"]


def test_a_number_being_typed_is_not_parsed_yet():
    """`"portionen": 1` could still become 12 — emitting meta at that moment
    would ship a wrong serving count that never gets corrected."""
    parser = RecipeStreamParser()
    assert parser.feed('{"titel": "X", "portionen": 1') == []


def test_stray_prose_before_the_json_is_dropped():
    raw = "Klar, hier ist dein Rezept:\n\n" + json.dumps(RECIPE, ensure_ascii=False)
    events = stream_in_chunks(raw, 13)
    assert events[-1][0] == "done"


def test_trailing_prose_after_the_json_is_dropped():
    """Models sometimes add a closing remark; the recipe must still validate."""
    raw = json.dumps(RECIPE, ensure_ascii=False) + "\n\nGuten Appetit!"
    events = stream_in_chunks(raw, 13)
    assert events[-1][0] == "done"
    assert events[-1][1]["titel"] == "Pasta al Limone"


def test_buffer_without_any_brace_produces_no_events():
    parser = RecipeStreamParser()
    assert parser.feed("Es tut mir leid, ich kann das nicht.") == []
    assert parser.finish()[-1][0] == "error"


def test_an_array_wrapper_is_skipped_and_the_first_object_is_read():
    """Prefix stripping starts at the first `{`, so a model that wraps the
    recipe in a list still streams. Pinned because it is the behaviour, not an
    accident: the alternative (bail out) would waste a paid generation."""
    parser = RecipeStreamParser()
    events = parser.feed('[{"titel": "X", "zutaten": [{"name": "a"}, {"name": "b"}]')
    assert [n for n, _ in events] == ["meta", "zutat"]
    assert dict(events)["meta"]["titel"] == "X"


# -- what counts as "complete" --------------------------------------------


def test_meta_waits_for_a_title():
    """Without a title there is nothing to show; emitting an empty hero card
    and filling it later would flicker."""
    parser = RecipeStreamParser()
    assert parser.feed('{"kueche": "Italienisch", "zutaten": [') == []


def test_last_tip_is_emitted_once_naehrwerte_proves_the_array_closed():
    """`tipps` has no successor of its own — the appearance of the next
    top-level key is the only proof that the last tip is finished."""
    raw = json.dumps(RECIPE, ensure_ascii=False)
    cut = raw.index("{", raw.find('"naehrwerte"')) + 1  # ..."naehrwerte": {
    parser = RecipeStreamParser()
    events = parser.feed(raw[:cut])
    assert [n for n, _ in events].count("tipp") == 1


def test_no_event_is_ever_emitted_twice_across_chunks():
    """Each array item is counted as sent; a reset of that counter would
    duplicate ingredients in the UI."""
    raw = json.dumps(RECIPE, ensure_ascii=False)
    events = stream_in_chunks(raw, 2)
    zutaten = [payload for name, payload in events if name == "zutat"]
    assert zutaten == RECIPE["zutaten"]


# -- lifecycle -------------------------------------------------------------


def test_feeding_after_finish_is_ignored():
    """A late chunk from an aborted stream must not resurrect the parser and
    push events after `done`."""
    parser = RecipeStreamParser()
    parser.feed(json.dumps(RECIPE, ensure_ascii=False))
    assert parser.finish()[-1][0] == "done"
    assert parser.feed('{"titel": "zu spät"}') == []
    assert parser.finish() == []


def test_finish_flushes_items_that_were_still_pending():
    """The final ingredient has no successor to prove it complete — only
    `finish()` can release it, and it must."""
    raw = json.dumps(RECIPE, ensure_ascii=False)
    # stop on the "]" that closes zutaten: the following ", " would make the
    # repaired buffer end in a trailing comma, which is not parseable at all.
    cut = raw.find('"schritte"') - len(", ")
    parser = RecipeStreamParser()
    during = parser.feed(raw[:cut])
    assert [n for n, _ in during].count("zutat") == 2
    rest = parser.feed(raw[cut:]) + parser.finish()
    assert [n for n, _ in rest].count("zutat") == 1


def test_a_schema_violation_is_reported_as_error_not_done():
    """Structured outputs make this unlikely, but the client trusts `done` to
    be a valid Recipe — a value outside the difficulty Literal must not slip
    through as success."""
    broken = dict(RECIPE, schwierigkeit="unmöglich")
    parser = RecipeStreamParser()
    parser.feed(json.dumps(broken, ensure_ascii=False))
    events = parser.finish()
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "invalid_recipe"


def test_error_payload_carries_no_internal_detail():
    """The message is a bare exception class name — never a stack trace or a
    fragment of the model output."""
    parser = RecipeStreamParser()
    parser.feed('{"titel": "kaputt", "zutaten": [')
    _, payload = parser.finish()[-1]
    assert set(payload) == {"code", "message"}
    assert "Traceback" not in payload["message"]
    assert "kaputt" not in payload["message"]


def test_replay_carries_the_same_payloads_not_just_the_same_names():
    """A cache hit has to be indistinguishable from a live generation."""
    live = stream_in_chunks(json.dumps(RECIPE, ensure_ascii=False), 9)
    replay = replay_events(RECIPE)
    assert [p for n, p in live if n == "zutat"] == [p for n, p in replay if n == "zutat"]
    assert dict(live)["meta"] == dict(replay)["meta"]


def test_replay_survives_a_recipe_without_optional_arrays():
    """Older cached rows predate `tipps`; replay must not raise on them."""
    minimal = {k: v for k, v in RECIPE.items() if k != "tipps"}
    names = [n for n, _ in replay_events(minimal)]
    assert names[0] == "meta" and names[-1] == "done"
    assert "tipp" not in names
