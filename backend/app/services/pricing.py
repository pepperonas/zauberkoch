"""Token pricing for the usage/cost dashboard — USD per 1M tokens.

Two things make a single pair of constants wrong, which is why this lives in
its own module:

1. **Prices change on a date.** Claude Sonnet 5 runs on introductory pricing
   ($2/$10) through 2026-08-31 and costs $3/$15 from 2026-09-01. The admin
   dashboard shows rolling windows (30/90 days), so a window will straddle
   that date — a flat constant would be wrong on one side of it no matter
   which value we pick. Every generation is therefore costed with the price
   that was in force on the day it ran.
2. **The model can change.** `ANTHROPIC_MODEL` is an env var (Opus is
   explicitly A/B-testable), and `generations.model` records what actually
   ran. Costing an Opus row at Sonnet rates would understate it 2.5×.

Source: https://platform.claude.com/docs/en/docs/about-claude/pricing
(checked 2026-07-26). Cache multipliers are relative to the base input price:
read = 0.1×, 5-minute write = 1.25×. ⚠️ The 1.25× assumes the 5-minute cache —
`ai.py` sends `cache_control: {"type": "ephemeral"}` without a `ttl`, which is
the 5-minute variant. If that ever becomes `"ttl": "1h"`, the write multiplier
here has to become 2.0.
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone

CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25


@dataclass(frozen=True)
class Price:
    """USD per 1M tokens for one model in one price period."""

    input: float
    output: float

    @property
    def cache_read(self) -> float:
        return self.input * CACHE_READ_MULTIPLIER

    @property
    def cache_write(self) -> float:
        return self.input * CACHE_WRITE_MULTIPLIER


# Model-family prefix → price periods, newest first. Matching is by prefix so
# dated model ids (`claude-sonnet-5-20260514`) and variants resolve too; the
# longest matching prefix wins, so a more specific family can be added later
# without disturbing the general one.
_SCHEDULE: dict[str, list[tuple[date, Price]]] = {
    "claude-sonnet-5": [
        (date(2026, 9, 1), Price(input=3.00, output=15.00)),
        (date.min, Price(input=2.00, output=10.00)),  # introductory
    ],
    "claude-sonnet-4": [(date.min, Price(input=3.00, output=15.00))],  # 4.5 / 4.6
    "claude-opus-5": [(date.min, Price(input=5.00, output=25.00))],
    "claude-opus-4": [(date.min, Price(input=5.00, output=25.00))],  # 4.5 and later
    "claude-haiku-4-5": [(date.min, Price(input=1.00, output=5.00))],
}

# Unknown model → current Sonnet standard rate. Deliberately not zero: an
# unpriced model should show a plausible cost rather than silently vanish from
# the dashboard. `is_priced()` tells the two callers whether it was a guess.
_FALLBACK = Price(input=3.00, output=15.00)


def _as_date(when: date | datetime | None) -> date:
    """Naive datetimes are treated as UTC — SQLite hands back naive values even
    for `DateTime(timezone=True)` columns."""
    if when is None:
        return datetime.now(timezone.utc).date()
    if isinstance(when, datetime):
        if when.tzinfo is None:
            return when.date()
        return when.astimezone(timezone.utc).date()
    return when


def is_priced(model: str) -> bool:
    """True if we have a real price table for this model (not the fallback)."""
    return _family(model) is not None


def _family(model: str) -> str | None:
    name = (model or "").strip().lower()
    matches = [k for k in _SCHEDULE if name.startswith(k)]
    return max(matches, key=len) if matches else None


def price_for(model: str, when: date | datetime | None = None) -> Price:
    """Price in force for `model` on the day `when` (default: today, UTC)."""
    family = _family(model)
    if family is None:
        return _FALLBACK
    day = _as_date(when)
    for effective_from, price in _SCHEDULE[family]:
        if day >= effective_from:
            return price
    return _FALLBACK


def cost_usd(
    model: str,
    when: date | datetime | None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    p = price_for(model, when)
    return (
        input_tokens / 1e6 * p.input
        + output_tokens / 1e6 * p.output
        + cache_read_tokens / 1e6 * p.cache_read
        + cache_write_tokens / 1e6 * p.cache_write
    )


def generation_cost(row) -> float:
    """Cost of one `Generation` row, from OUR point of view. Two kinds are
    free for us: cache hits (never reached the API) and BYOK runs (real tokens,
    paid by the user's own key)."""
    if row.cached or getattr(row, "byok", False):
        return 0.0
    return cost_usd(
        row.model,
        row.created_at,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        cache_read_tokens=row.cache_read_tokens,
        cache_write_tokens=row.cache_write_tokens,
    )
