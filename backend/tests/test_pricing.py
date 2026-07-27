"""Token pricing: date-dependent rates, model lookup, cache multipliers.

The dashboard's whole job is to be right about money, and the one thing that
silently breaks it is a price change nobody re-checks — hence the boundary
tests around 2026-09-01.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.services import pricing


def _gen(**kw):
    """Minimal stand-in for a Generation row."""
    base = dict(
        model="claude-sonnet-5",
        created_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        cached=False,
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_write_tokens=0,
    )
    base.update(kw)
    return SimpleNamespace(**base)


class TestSonnet5PriceChange:
    def test_intro_pricing_before_september(self):
        p = pricing.price_for("claude-sonnet-5", date(2026, 8, 31))
        assert (p.input, p.output) == (2.00, 10.00)

    def test_standard_pricing_from_september_first(self):
        p = pricing.price_for("claude-sonnet-5", date(2026, 9, 1))
        assert (p.input, p.output) == (3.00, 15.00)

    def test_a_window_spanning_the_change_uses_both_rates(self):
        """The reason this module exists: one rolling window, two prices."""
        august = _gen(created_at=datetime(2026, 8, 20, tzinfo=timezone.utc), output_tokens=1_000_000)
        september = _gen(created_at=datetime(2026, 9, 20, tzinfo=timezone.utc), output_tokens=1_000_000)
        assert pricing.generation_cost(august) == 10.00
        assert pricing.generation_cost(september) == 15.00


class TestModelLookup:
    def test_dated_model_ids_resolve_via_prefix(self):
        p = pricing.price_for("claude-sonnet-5-20260514", date(2026, 7, 1))
        assert (p.input, p.output) == (2.00, 10.00)

    def test_opus_is_not_billed_at_sonnet_rates(self):
        p = pricing.price_for("claude-opus-5", date(2026, 7, 1))
        assert (p.input, p.output) == (5.00, 25.00)

    def test_haiku(self):
        p = pricing.price_for("claude-haiku-4-5-20251001", date(2026, 7, 1))
        assert (p.input, p.output) == (1.00, 5.00)

    def test_sonnet_4_and_5_do_not_collide(self):
        assert pricing.price_for("claude-sonnet-4-5", date(2026, 7, 1)).input == 3.00
        assert pricing.price_for("claude-sonnet-5", date(2026, 7, 1)).input == 2.00

    def test_unknown_model_falls_back_and_is_flagged(self):
        assert pricing.is_priced("claude-sonnet-5") is True
        assert pricing.is_priced("some-future-model") is False
        p = pricing.price_for("some-future-model", date(2026, 7, 1))
        assert (p.input, p.output) == (3.00, 15.00)

    def test_empty_model_does_not_crash(self):
        assert pricing.price_for("", date(2026, 7, 1)).input == 3.00


class TestCacheMultipliers:
    def test_read_is_a_tenth_write_is_1_25x(self):
        p = pricing.price_for("claude-sonnet-5", date(2026, 7, 1))
        assert p.cache_read == 0.20
        assert p.cache_write == 2.50

    def test_cost_sums_all_four_token_types(self):
        cost = pricing.cost_usd(
            "claude-sonnet-5",
            date(2026, 7, 1),
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            cache_read_tokens=1_000_000,
            cache_write_tokens=1_000_000,
        )
        assert cost == 2.00 + 10.00 + 0.20 + 2.50


class TestGenerationCost:
    def test_cache_hits_are_free(self):
        row = _gen(cached=True, input_tokens=999_999, output_tokens=999_999)
        assert pricing.generation_cost(row) == 0.0

    def test_naive_timestamps_are_treated_as_utc(self):
        """SQLite hands back naive datetimes even for tz-aware columns."""
        naive = _gen(created_at=datetime(2026, 9, 1), output_tokens=1_000_000)
        assert pricing.generation_cost(naive) == 15.00


class TestEdges:
    def test_no_date_means_today(self):
        """`price_for(model)` without a date must not crash — it prices at
        today's rate, which is what an ad-hoc estimate wants."""
        from datetime import date as _date

        today = _date.today()
        assert pricing.price_for("claude-sonnet-5") == pricing.price_for("claude-sonnet-5", today)

    def test_a_date_before_every_period_falls_back(self, monkeypatch):
        """A schedule whose earliest entry starts in the future must still
        return a price rather than raising — the dashboard shows a number, not
        a stack trace."""
        from datetime import date as _date

        monkeypatch.setitem(
            pricing._SCHEDULE, "future-model", [(_date(2099, 1, 1), pricing.Price(9.0, 9.0))]
        )
        p = pricing.price_for("future-model", _date(2026, 7, 1))
        assert (p.input, p.output) == (3.00, 15.00)  # _FALLBACK

    def test_offsets_are_converted_to_utc_not_truncated(self):
        """01:30 on Sep 1 in Berlin is still Aug 31 in UTC — and UTC is what
        decides, consistently with the daily limits and Anthropic's own
        accounting. Truncating the local date instead would charge the new
        price two hours early."""
        from datetime import datetime as _dt, timedelta, timezone as _tz

        berlin_just_after_midnight = _dt(2026, 9, 1, 1, 30, tzinfo=_tz(timedelta(hours=2)))
        p = pricing.price_for("claude-sonnet-5", berlin_just_after_midnight)
        assert (p.input, p.output) == (2.00, 10.00)
