# @author: Wendy Yang
# @date: 2026-09-24

from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4
import unittest

from fastapi import HTTPException

from app.services.month_end_close import (
    MONTH_END_NO_PNL_CLOSE,
    month_end_reference,
    period_bounds,
    resolve_current_period_ni,
    resolve_period,
    run_month_end_close,
)


class MonthEndCloseLogicTests(unittest.TestCase):
    def test_period_and_reference(self):
        self.assertEqual(resolve_period("2026-09"), "2026-09")
        self.assertEqual(month_end_reference("2026-09"), "MEC-2026-09")
        self.assertEqual(period_bounds("2026-09"), (date(2026, 9, 1), date(2026, 9, 30)))
        with self.assertRaises(HTTPException):
            resolve_period("2026-13")

    def test_prefers_account_3353_for_current_period_ni(self):
        retained = SimpleNamespace(
            id=uuid4(),
            account_code="3350",
            account_name="Retained earnings-unappropriated",
            account_type="Equity",
        )
        current_is = SimpleNamespace(
            id=uuid4(),
            account_code="3354",
            account_name="Net income or loss for current period-IS",
            account_type="Equity",
        )
        current_bs = SimpleNamespace(
            id=uuid4(),
            account_code="3353",
            account_name="Net income or loss for current period-BS",
            account_type="Equity",
        )
        chosen = resolve_current_period_ni([retained, current_is, current_bs])
        self.assertEqual(chosen.account_code, "3353")


class MonthEndCloseRunTests(unittest.TestCase):
    def test_run_does_not_generate_pnl_journal(self):
        db = MagicMock()
        with self.assertRaises(HTTPException) as ctx:
            run_month_end_close(db, SimpleNamespace(id=uuid4()), period="2026-09")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Year-End Close", str(ctx.exception.detail))
        self.assertIn("accumulate", str(ctx.exception.detail))
        self.assertEqual(str(ctx.exception.detail), MONTH_END_NO_PNL_CLOSE)
        db.add.assert_not_called()


if __name__ == "__main__":
    unittest.main()
