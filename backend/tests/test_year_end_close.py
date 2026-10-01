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
from app.services.year_end_close import (
    GENERATED_APPROVAL_STATUS,
    GENERATED_POSTING_STATUS,
    build_closing_lines,
    build_reverse_monthly_ni_lines,
    resolve_current_period_ni_ids,
    resolve_fiscal_year,
    resolve_retained_earnings,
    run_year_end_close,
    year_end_reference,
)


def _balance(code: str, name: str, kind: str, debit: str, credit: str) -> AccountBalance:
    return AccountBalance(
        account_id=uuid4(),
        account_code=code,
        account_name=name,
        account_type=kind,
        debit=Decimal(debit),
        credit=Decimal(credit),
    )


class YearEndCloseLogicTests(unittest.TestCase):
    def test_reference_and_default_year(self):
        self.assertEqual(year_end_reference(2026), "YEC-2026")
        self.assertEqual(resolve_fiscal_year(2026), 2026)
        with self.assertRaises(HTTPException) as ctx:
            resolve_fiscal_year(1800)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_prefers_account_3350_for_retained_earnings(self):
        other = SimpleNamespace(
            id=uuid4(),
            account_code="3310",
            account_name="Legal Surplus",
            account_type="Equity",
        )
        retained = SimpleNamespace(
            id=uuid4(),
            account_code="3350",
            account_name="Retained earnings-unappropriated (or accumulated deficit)",
            account_type="Equity",
        )
        current = SimpleNamespace(
            id=uuid4(),
            account_code="3353",
            account_name="Net income or loss for current period-BS",
            account_type="Equity",
        )
        chosen = resolve_retained_earnings([other, current, retained])
        self.assertEqual(chosen.account_code, "3350")

    def test_rejects_non_equity_override(self):
        revenue = SimpleNamespace(
            id=uuid4(),
            account_code="4110",
            account_name="Sales Revenue",
            account_type="Revenue",
        )
        with self.assertRaises(HTTPException) as ctx:
            resolve_retained_earnings([revenue], account_id=revenue.id)
        self.assertIn("Equity", str(ctx.exception.detail))

    def test_profit_closing_lines_credit_retained_earnings(self):
        re_acct = SimpleNamespace(
            id=uuid4(),
            account_code="3350",
            account_name="Retained earnings-unappropriated",
            account_type="Equity",
        )
        revenue = _balance("4110", "Sales Revenue", "Revenue", "0", "1000.00")
        expense = _balance("5111", "Cost of Sales", "Expense", "400.00", "0")
        lines, rev, exp, net = build_closing_lines([revenue, expense], re_acct, "FY 2026")
        self.assertEqual(rev, Decimal("1000.00"))
        self.assertEqual(exp, Decimal("400.00"))
        self.assertEqual(net, Decimal("600.00"))
        self.assertEqual(len(lines), 3)
        by_code = {line.account_code: line for line in lines}
        self.assertEqual(by_code["4110"].debit, Decimal("1000.00"))
        self.assertEqual(by_code["5111"].credit, Decimal("400.00"))
        self.assertEqual(by_code["3350"].credit, Decimal("600.00"))
        self.assertEqual(sum((line.debit for line in lines), ZERO), sum((line.credit for line in lines), ZERO))

    def test_loss_and_contra_revenue_are_balanced(self):
        re_acct = SimpleNamespace(
            id=uuid4(),
            account_code="3350",
            account_name="Retained earnings-unappropriated",
            account_type="Equity",
        )
        revenue = _balance("4110", "Sales Revenue", "Revenue", "0", "100.00")
        returns = _balance("4170", "Sales Return", "Revenue", "50.00", "0")
        expense = _balance("5111", "Cost of Sales", "Expense", "400.00", "0")
        lines, _rev, _exp, net = build_closing_lines([revenue, returns, expense], re_acct, "FY 2026")
        self.assertEqual(net, Decimal("-350.00"))
        re_line = next(line for line in lines if line.account_code == "3350")
        self.assertEqual(re_line.debit, Decimal("350.00"))
        self.assertEqual(sum((line.debit for line in lines), ZERO), sum((line.credit for line in lines), ZERO))

    def test_reverse_monthly_ni_does_not_hit_retained_earnings(self):
        ni_bs = SimpleNamespace(
            id=uuid4(),
            account_code="3353",
            account_name="Net income or loss for current period-BS",
            account_type="Equity",
        )
        ni_is = SimpleNamespace(
            id=uuid4(),
            account_code="3354",
            account_name="Net income or loss for current period-IS",
            account_type="Equity",
        )
        parked = AccountBalance(
            account_id=ni_bs.id,
            account_code="3353",
            account_name=ni_bs.account_name,
            account_type="Equity",
            debit=Decimal("0"),
            credit=Decimal("600.00"),
        )
        lines = build_reverse_monthly_ni_lines([parked], "FY 2026", ni_bs, ni_is)
        by_code = {line.account_code: line for line in lines}
        self.assertEqual(set(by_code), {"3353", "3354"})
        self.assertEqual(by_code["3353"].debit, Decimal("600.00"))
        self.assertEqual(by_code["3354"].credit, Decimal("600.00"))
        self.assertNotIn("3350", by_code)

    def test_generated_journal_stays_draft_for_approval(self):
        self.assertEqual(GENERATED_POSTING_STATUS, "Draft")
        self.assertEqual(GENERATED_APPROVAL_STATUS, "DRAFT")

    def test_ni_clear_ids_ignore_non_equity_pnl_debit(self):
        ni = SimpleNamespace(id=uuid4(), account_type="Equity")
        revenue = SimpleNamespace(id=uuid4(), account_type="Revenue")
        db = MagicMock()
        with patch(
            "app.services.year_end_close.resolve_posting_rule",
            return_value=(revenue, SimpleNamespace(id=uuid4()), None),
        ):
            self.assertEqual(resolve_current_period_ni_ids(db), set())
        with patch(
            "app.services.year_end_close.resolve_posting_rule",
            return_value=(ni, SimpleNamespace(id=uuid4()), None),
        ):
            self.assertEqual(resolve_current_period_ni_ids(db), {ni.id})


class YearEndCloseRunTests(unittest.TestCase):
    def test_run_rejects_when_preview_cannot_run(self):
        db = MagicMock()
        user = SimpleNamespace(id=uuid4())
        preview = {
            "can_run": False,
            "blockers": ["Run Month-End Close first."],
        }
        with patch("app.services.year_end_close.preview_year_end_close", return_value=preview):
            with self.assertRaises(HTTPException) as ctx:
                run_year_end_close(db, user, fiscal_year=2026)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Month-End Close", str(ctx.exception.detail))
        db.add.assert_not_called()

    def test_run_creates_draft_journal(self):
        db = MagicMock()
        user = SimpleNamespace(id=uuid4())
        re_id = uuid4()
        rev_id = uuid4()
        preview = {
            "can_run": True,
            "fiscal_year": 2026,
            "close_date": date(2026, 12, 31),
            "period": "2026-12",
            "lines": [
                {
                    "account_id": rev_id,
                    "account_code": "4110",
                    "account_name": "Sales Revenue",
                    "account_type": "Revenue",
                    "debit": Decimal("10.00"),
                    "credit": Decimal("0.00"),
                    "description": "Close FY 2026 Sales Revenue",
                },
                {
                    "account_id": re_id,
                    "account_code": "3350",
                    "account_name": "Retained earnings",
                    "account_type": "Equity",
                    "debit": Decimal("0.00"),
                    "credit": Decimal("10.00"),
                    "description": "Transfer FY 2026 net income",
                },
            ],
        }
        created = SimpleNamespace(id=uuid4(), posting_status="Draft", approval_status="DRAFT")
        close_rule = SimpleNamespace(id=uuid4())
        with patch("app.services.year_end_close.preview_year_end_close", return_value=preview):
            with patch("app.services.year_end_close.find_year_end_journal", return_value=created):
                with patch(
                    "app.services.year_end_close.resolve_close_rule",
                    return_value=(None, None, close_rule),
                ):
                    entry = run_year_end_close(db, user, fiscal_year=2026)
        db.add.assert_called_once()
        saved = db.add.call_args[0][0]
        self.assertEqual(saved.posting_status, "Draft")
        self.assertEqual(saved.approval_status, "DRAFT")
        self.assertEqual(saved.reference, "YEC-2026")
        self.assertEqual(saved.posting_date, date(2026, 12, 31))
        self.assertTrue(saved.is_system_generated)
        self.assertEqual(saved.source_document_type, "YEAR_END_CLOSE")
        self.assertEqual(saved.source_record_id, "2026")
        self.assertEqual(saved.posting_rule_id, close_rule.id)
        self.assertEqual(len(saved.postings), 2)
        self.assertEqual(entry.approval_status, "DRAFT")


if __name__ == "__main__":
    unittest.main()
