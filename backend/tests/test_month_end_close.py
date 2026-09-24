# @author: Wendy Yang
# @date: 2026-09-24

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4
import unittest

from fastapi import HTTPException

from app.services.financial_reports import AccountBalance, ZERO
from app.services.month_end_close import (
    month_end_reference,
    period_bounds,
    resolve_current_period_ni,
    resolve_period,
    run_month_end_close,
)
from app.services.year_end_close import (
    GENERATED_APPROVAL_STATUS,
    GENERATED_POSTING_STATUS,
    build_closing_lines,
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

    def test_monthly_close_targets_current_period_ni(self):
        target = SimpleNamespace(
            id=uuid4(),
            account_code="3353",
            account_name="Net income or loss for current period-BS",
            account_type="Equity",
        )
        revenue = AccountBalance(uuid4(), "4110", "Sales Revenue", "Revenue", Decimal("0"), Decimal("100"))
        expense = AccountBalance(uuid4(), "5111", "Cost of Sales", "Expense", Decimal("40"), Decimal("0"))
        lines, _rev, _exp, net = build_closing_lines([revenue, expense], target, "2026-09")
        self.assertEqual(net, Decimal("60.00"))
        by_code = {line.account_code: line for line in lines}
        self.assertEqual(by_code["3353"].credit, Decimal("60.00"))
        self.assertEqual(sum((line.debit for line in lines), ZERO), sum((line.credit for line in lines), ZERO))

    def test_generated_journal_stays_draft(self):
        self.assertEqual(GENERATED_POSTING_STATUS, "Draft")
        self.assertEqual(GENERATED_APPROVAL_STATUS, "DRAFT")


class MonthEndCloseRunTests(unittest.TestCase):
    def test_run_creates_draft_journal(self):
        db = MagicMock()
        user = SimpleNamespace(id=uuid4())
        preview = {
            "can_run": True,
            "period": "2026-09",
            "close_date": date(2026, 9, 30),
            "lines": [
                {
                    "account_id": uuid4(),
                    "debit": Decimal("10.00"),
                    "credit": Decimal("0.00"),
                    "description": "Close 2026-09 Sales",
                },
                {
                    "account_id": uuid4(),
                    "debit": Decimal("0.00"),
                    "credit": Decimal("10.00"),
                    "description": "Transfer 2026-09 net income",
                },
            ],
        }
        created = SimpleNamespace(id=uuid4(), posting_status="Draft", approval_status="DRAFT")
        with patch("app.services.month_end_close.preview_month_end_close", return_value=preview):
            with patch("app.services.month_end_close.find_month_end_journal", return_value=created):
                entry = run_month_end_close(db, user, period="2026-09")
        saved = db.add.call_args[0][0]
        self.assertEqual(saved.posting_status, "Draft")
        self.assertEqual(saved.approval_status, "DRAFT")
        self.assertEqual(saved.reference, "MEC-2026-09")
        self.assertEqual(saved.posting_date, date(2026, 9, 30))
        self.assertEqual(entry.approval_status, "DRAFT")

    def test_run_rejects_when_blocked(self):
        db = MagicMock()
        with patch(
            "app.services.month_end_close.preview_month_end_close",
            return_value={"can_run": False, "blockers": ["No posted P&L activity to close for 2026-09."]},
        ):
            with self.assertRaises(HTTPException) as ctx:
                run_month_end_close(db, SimpleNamespace(id=uuid4()), period="2026-09")
        self.assertEqual(ctx.exception.status_code, 400)
        db.add.assert_not_called()


if __name__ == "__main__":
    unittest.main()
