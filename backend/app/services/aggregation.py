"""Shopping-list aggregation: normalize units, merge equal ingredients."""

from dataclasses import dataclass

# unit (lowercased) -> (base unit, factor to base)
# Lookup keys are lower-case and WITHOUT trailing periods (see `_unit_key`):
# the merge key is (name, unit), so "2 Stk. Tomaten" and "1 Stück Tomate" would
# otherwise sit on the shopping list as two separate lines.
UNIT_MAP: dict[str, tuple[str, float]] = {
    "g": ("g", 1), "gr": ("g", 1), "gramm": ("g", 1), "kg": ("g", 1000),
    "ml": ("ml", 1), "l": ("ml", 1000), "liter": ("ml", 1000), "cl": ("ml", 10), "dl": ("ml", 100),
    "el": ("EL", 1), "esslöffel": ("EL", 1), "esslöffeln": ("EL", 1), "essloeffel": ("EL", 1),
    "tl": ("TL", 1), "teelöffel": ("TL", 1), "teelöffeln": ("TL", 1), "teeloeffel": ("TL", 1),
    "stück": ("Stück", 1), "stk": ("Stück", 1), "st": ("Stück", 1), "stueck": ("Stück", 1),
    "prise": ("Prise", 1), "prisen": ("Prise", 1),
    "msp": ("Messerspitze", 1), "messerspitze": ("Messerspitze", 1),
    "bund": ("Bund", 1), "bd": ("Bund", 1),
    "zehe": ("Zehe", 1), "zehen": ("Zehe", 1),
    "dose": ("Dose", 1), "dosen": ("Dose", 1),
    "packung": ("Packung", 1), "packungen": ("Packung", 1), "pck": ("Packung", 1),
    "päckchen": ("Päckchen", 1), "paeckchen": ("Päckchen", 1),
    "zweig": ("Zweig", 1), "zweige": ("Zweig", 1),
    "blatt": ("Blatt", 1), "blätter": ("Blatt", 1),
    "scheibe": ("Scheibe", 1), "scheiben": ("Scheibe", 1),
    "tasse": ("Tasse", 1), "tassen": ("Tasse", 1),
    "becher": ("Becher", 1),
    "kugel": ("Kugel", 1), "kugeln": ("Kugel", 1),
    "spritzer": ("Spritzer", 1), "schuss": ("Schuss", 1),
    "dash": ("Dash", 1), "dashes": ("Dash", 1), "barlöffel": ("Barlöffel", 1), "bl": ("Barlöffel", 1),
}


def _unit_key(einheit: str) -> str:
    """Lower-case, whitespace- and period-free lookup key. Abbreviations arrive
    both ways ("Stk" / "Stk."), and a trailing period used to create a whole
    separate unit."""
    return einheit.strip().rstrip(".").strip().lower()


@dataclass
class NormalizedIngredient:
    name_key: str  # merge key (lowercased, trimmed)
    name: str  # display name
    menge: float | None  # in base unit; None for "nach Geschmack" etc.
    einheit: str  # base unit ("" when menge is None)


def normalize(name: str, menge: float | str | None, einheit: str) -> NormalizedIngredient:
    display = name.strip()
    key = display.lower()
    if not isinstance(menge, (int, float)):
        return NormalizedIngredient(key, display, None, "")
    base, factor = UNIT_MAP.get(_unit_key(einheit), (einheit.strip(), 1))
    return NormalizedIngredient(key, display, float(menge) * factor, base)


def format_amount(menge: float, einheit: str) -> tuple[float, str]:
    """Render base units back to a friendly display unit."""
    if einheit == "g" and menge >= 1000:
        return round(menge / 1000, 2), "kg"
    if einheit == "ml" and menge >= 1000:
        return round(menge / 1000, 2), "l"
    return round(menge, 2), einheit


def scale(menge: float | str | None, factor: float) -> float | str | None:
    if isinstance(menge, (int, float)):
        return float(menge) * factor
    return menge


def merge_key(item: NormalizedIngredient) -> tuple[str, str]:
    return (item.name_key, item.einheit)
