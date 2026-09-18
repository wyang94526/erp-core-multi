from datetime import date
from decimal import Decimal
import unittest

from fastapi import HTTPException

from app.services.accounting import (
    normalize_journal_period,
    period_from_date,
    resolve_posting_date,
    validate_posting_amounts,
    validate_posting_rows,
)


class ManualJournalValidationTests(unittest.TestCase):
    def test_period_normalization(self):
        self.assertEqual(period_from_date(date(2026, 9, 18)), "2026-09")
        self.assertEqual(normalize_journal_period(None, date(2026, 9, 1)), "2026-09")
        self.assertEqual(normalize_journal_period(" 2026-08 ", date(2026, 9, 1)), "2026-08")
        self.assertEqual(resolve_posting_date(date(2026, 1, 15)), date(2026, 1, 15))
        with self.assertRaises(HTTPException) as ctx:
            normalize_journal_period("2026-13", date(2026, 9, 1))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_posting_rows_require_balanced_debit_and_credit(self):
        debit = Decimal("250.00")
        credit = Decimal("250.00")
        account_a = "11111111-1111-1111-1111-111111111111"
        account_b = "22222222-2222-2222-2222-222222222222"
        total_debit, total_credit = validate_posting_rows(
            [
                {"account_id": account_a, "debit": debit, "credit": Decimal("0")},
                {"account_id": account_b, "debit": Decimal("0"), "credit": credit},
            ]
        )
        self.assertEqual(total_debit, debit)
        self.assertEqual(total_credit, credit)

        with self.assertRaises(HTTPException) as ctx:
            validate_posting_rows(
                [
                    {"account_id": account_a, "debit": debit, "credit": Decimal("0")},
                    {"account_id": account_b, "debit": Decimal("50"), "credit": Decimal("0")},
                ]
            )
        self.assertIn("debit line and one credit line", str(ctx.exception.detail))

        with self.assertRaises(HTTPException) as ctx:
            validate_posting_rows(
                [
                    {"account_id": account_a, "debit": debit, "credit": Decimal("0")},
                    {"account_id": account_b, "debit": Decimal("0"), "credit": Decimal("100")},
                ]
            )
        self.assertIn("not balanced", str(ctx.exception.detail))

        with self.assertRaises(HTTPException) as ctx:
            validate_posting_amounts(Decimal("10"), Decimal("5"))
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
