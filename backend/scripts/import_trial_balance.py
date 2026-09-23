#!/usr/bin/env python3
# @author: Wendy Yang
# @date: 2026-09-23

"""Import TIPTOP trial-balance ending balances for one accounting period.

Default file: 3-4.試算表 202607_20260917_July.csv
Default period: 2026-07 (July 2026)

Usage (from repo root, with venv active):

    python backend/scripts/import_trial_balance.py
    python backend/scripts/import_trial_balance.py --dry-run
    python backend/scripts/import_trial_balance.py --file path/to/3-4.試算表\\ 202607_20260917_July.csv
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from app.services.trial_balance_import import (  # noqa: E402
    DEFAULT_CURRENCY,
    DEFAULT_FILENAME,
    DEFAULT_PERIOD,
    normalize_period,
    parse_csv,
    period_from_filename,
    upsert_rows,
)


def resolve_csv(explicit: Path | None) -> Path:
    if explicit:
        path = explicit.expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        return path
    search_dirs = [
        ROOT / "backend" / "data" / "imports",
        ROOT,
        Path.cwd(),
        Path.cwd() / "backend" / "data" / "imports",
    ]
    for folder in search_dirs:
        candidate = folder / DEFAULT_FILENAME
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"Place {DEFAULT_FILENAME!r} in backend/data/imports or pass --file"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=None, help=f"CSV path (default {DEFAULT_FILENAME})")
    parser.add_argument(
        "--period",
        default=None,
        help="Accounting period YYYY-MM (default: first YYYYMM in the file name, else 2026-07)",
    )
    parser.add_argument("--currency", default=DEFAULT_CURRENCY)
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate only; do not write")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    csv_path = resolve_csv(args.file)
    period = (
        normalize_period(args.period, DEFAULT_PERIOD)
        if args.period
        else period_from_filename(csv_path.name)
    )
    logging.info("Reading %s for period %s (CSV has no period column)", csv_path, period)
    rows, parse_failures = parse_csv(csv_path, period)
    if not rows and parse_failures:
        logging.error("No valid rows. Check column headers.")
        return 1

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        result = upsert_rows(
            db,
            rows,
            source_file=csv_path.name,
            currency=args.currency.upper(),
        )
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    result.failed.extend(parse_failures)
    result.skipped += len(parse_failures)
    mode = "DRY RUN" if args.dry_run else "UPSERT"
    print(f"\n=== Trial balance {mode} {period} ===")
    print(f"  file     : {csv_path.name}")
    print(f"  valid    : {len(rows)}")
    print(f"  inserted : {result.inserted}")
    print(f"  updated  : {result.updated}")
    print(f"  skipped  : {result.skipped}")
    if result.failed:
        print(f"  failed   : {len(result.failed)}")
        for line in result.failed[:25]:
            print(f"    - {line}")
        if len(result.failed) > 25:
            print(f"    … {len(result.failed) - 25} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
