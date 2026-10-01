# @author: Wendy Yang
# @date: 2026-09-24

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4
import unittest

from fastapi import HTTPException

from app.services.financial_reports import ZERO
from app.services.month_end_close import (
    GENERATED_APPROVAL_STATUS,
    GENERATED_POSTING_STATUS,
    month_end_reference,
    period_bounds,
    resolve_current_period_ni,
    resolve_period,
    run_month_end_close,
)
from app.services.year_end_close import build_park_ni_lines


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

    def test_park_ni_income_debits_3354_credits_3353(self):
        ni_is = SimpleNamespace(
            id=uuid4(),
            account_code="3354",
            account_name="Net income or loss for current period-IS",
            account_type="Equity",
        )
        ni_bs = SimpleNamespace(
            id=uuid4(),
            account_code="3353",
            account_name="Net income or loss for current period-BS",
            account_type="Equity",
        )
        lines = build_park_ni_lines(Decimal("600.00"), ni_is, ni_bs, "2026-09")
        self.assertEqual(len(lines), 2)
        by_code = {line.account_code: line for line in lines}
        self.assertEqual(by_code["3354"].debit, Decimal("600.00"))
        self.assertEqual(by_code["3353"].credit, Decimal("600.00"))
        self.assertEqual(
            sum((line.debit for line in lines), ZERO),
            sum((line.credit for line in lines), ZERO),
        )

    def test_park_ni_loss_reverses_sides(self):
        ni_is = SimpleNamespace(
            id=uuid4(),
            account_code="3354",
            account_name="Net income or loss for current period-IS",
            account_type="Equity",
        )
        ni_bs = SimpleNamespace(
            id=uuid4(),
            account_code="3353",
            account_name="Net income or loss for current period-BS",
            account_type="Equity",
        )
        lines = build_park_ni_lines(Decimal("-200.00"), ni_is, ni_bs, "2026-09")
        by_code = {line.account_code: line for line in lines}
        self.assertEqual(by_code["3353"].debit, Decimal("200.00"))
        self.assertEqual(by_code["3354"].credit, Decimal("200.00"))


class MonthEndCloseRunTests(unittest.TestCase):
    def test_run_rejects_when_preview_cannot_run(self):
        db = MagicMock()
        with patch(
            "app.services.month_end_close.preview_month_end_close",
            return_value={"can_run": False, "blockers": ["No net income or loss to park for 2026-09."]},
        ):
            with self.assertRaises(HTTPException) as ctx:
                run_month_end_close(db, SimpleNamespace(id=uuid4()), period="2026-09")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("park", str(ctx.exception.detail))
        db.add.assert_not_called()

    def test_run_creates_draft_park_journal(self):
        db = MagicMock()
        user = SimpleNamespace(id=uuid4())
        is_id = uuid4()
        bs_id = uuid4()
        preview = {
            "can_run": True,
            "period": "2026-09",
            "close_date": date(2026, 9, 30),
            "lines": [
                {
                    "account_id": is_id,
                    "account_code": "3354",
                    "account_name": "Net income or loss for current period-IS",
                    "account_type": "Equity",
                    "debit": Decimal("10.00"),
                    "credit": Decimal("0.00"),
                    "description": "Park 2026-09 net income",
                },
                {
                    "account_id": bs_id,
                    "account_code": "3353",
                    "account_name": "Net income or loss for current period-BS",
                    "account_type": "Equity",
                    "debit": Decimal("0.00"),
                    "credit": Decimal("10.00"),
                    "description": "Park 2026-09 net income",
                },
            ],
        }
        created = SimpleNamespace(id=uuid4(), posting_status="Draft", approval_status="DRAFT")
        park_rule = SimpleNamespace(id=uuid4())
        with patch("app.services.month_end_close.preview_month_end_close", return_value=preview):
            with patch("app.services.month_end_close.find_month_end_journal", return_value=created):
                with patch(
                    "app.services.month_end_close.resolve_posting_rule",
                    return_value=(None, None, park_rule),
                ):
                    with patch(
                        "app.services.month_end_close.generate_document_number",
                        return_value="GJ-1",
                    ):
                        entry = run_month_end_close(db, user, period="2026-09")
        db.add.assert_called_once()
        saved = db.add.call_args[0][0]
        self.assertEqual(saved.posting_status, GENERATED_POSTING_STATUS)
        self.assertEqual(saved.approval_status, GENERATED_APPROVAL_STATUS)
        self.assertEqual(saved.reference, "MEC-2026-09")
        self.assertEqual(saved.posting_date, date(2026, 9, 30))
        self.assertTrue(saved.is_system_generated)
        self.assertEqual(saved.source_document_type, "MONTH_END_CLOSE")
        self.assertEqual(saved.source_record_id, "2026-09")
        self.assertEqual(saved.posting_rule_id, park_rule.id)
        self.assertEqual(len(saved.postings), 2)
        self.assertEqual(saved.postings[0].account_id, is_id)
        self.assertEqual(entry.approval_status, "DRAFT")


if __name__ == "__main__":
    unittest.main()
