"""Usage/cost report from the generations log.

Usage (from backend/, venv active):
    python -m scripts.stats [days]     # default: 30
"""

import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Generation
from app.services.pricing import generation_cost, is_priced


def main() -> int:
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    since = datetime.now(timezone.utc) - timedelta(days=days)
    db = SessionLocal()
    try:
        rows = db.execute(select(Generation).where(Generation.created_at >= since)).scalars().all()
        if not rows:
            print(f"no generations in the last {days} days")
            return 0

        live = [r for r in rows if not r.cached]
        cached = [r for r in rows if r.cached]
        errors = [r for r in rows if r.status == "error"]
        tokens_in = sum(r.input_tokens for r in live)
        tokens_out = sum(r.output_tokens for r in live)
        cache_read = sum(r.cache_read_tokens for r in live)
        cache_write = sum(r.cache_write_tokens for r in live)
        # Per row: the price depends on the model and on the day it ran.
        cost = sum(generation_cost(r) for r in live)
        unpriced = sorted({r.model for r in live if not is_priced(r.model)})
        durations = sorted(r.duration_ms for r in live if r.duration_ms)
        p50 = durations[len(durations) // 2] if durations else 0

        print(f"=== Zauberkoch usage, last {days} days ===")
        print(f"generations:     {len(rows)}  (live {len(live)}, cache-hits {len(cached)}, errors {len(errors)})")
        print(f"prompt-cache:    read {cache_read:,} tok / write {cache_write:,} tok "
              f"({0 if not live else round(100 * sum(1 for r in live if r.cache_read_tokens > 0) / len(live))}% of live calls hit)")
        print(f"tokens:          in {tokens_in:,} / out {tokens_out:,}")
        print(f"est. cost:       ${cost:.2f}")
        if unpriced:
            print(f"  ^ estimated at Sonnet standard rates, no price table for: {', '.join(unpriced)}")
        print(f"median duration: {p50/1000:.1f}s")

        by_user = db.execute(
            select(Generation.user_id, func.count())
            .where(Generation.created_at >= since)
            .group_by(Generation.user_id)
            .order_by(func.count().desc())
        ).all()
        # uid None = the account was deleted; the usage row stays detached.
        print(
            "per user:        "
            + ", ".join(f"{'deleted' if uid is None else f'#{uid}'}: {n}" for uid, n in by_user)
        )

        from app.models import Recipe

        fb = db.execute(
            select(Recipe.prompt_version, Recipe.feedback, func.count())
            .where(Recipe.feedback.is_not(None), Recipe.created_at >= since)
            .group_by(Recipe.prompt_version, Recipe.feedback)
        ).all()
        if fb:
            per_version: dict[str, dict[int, int]] = {}
            for version, wert, n in fb:
                per_version.setdefault(version, {})[wert] = n
            parts = [
                f"{v}: 👍{c.get(1, 0)}/👎{c.get(-1, 0)}" for v, c in sorted(per_version.items())
            ]
            print("feedback:        " + ", ".join(parts))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
