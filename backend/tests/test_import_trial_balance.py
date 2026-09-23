# @author: Wendy Yang
# @date: 2026-09-23

from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from fastapi import HTTPException

from app.services.gtt_import import classify_filename, preview_gtt_import, require_ending_period
from app.services.trial_balance_import import map_row, parse_number, period_from_filename


class TrialBalanceImportTests(TestCase):
    def test_parses_chinese_ending_balance(self):
        row = map_row(
            {
                "科目代號": "1103",
                "科目名稱": "Cash in Banks",
                "期末餘額": "1,250.50",
            },
            "2026-07",
            2,
        )
        self.assertEqual(row.account_code, "1103")
        self.assertEqual(row.ending_balance, Decimal("1250.50"))
        self.assertEqual(row.ending_debit, Decimal("1250.50"))
        self.assertEqual(row.ending_credit, Decimal("0"))
        self.assertEqual(row.period, "2026-07")

    def test_parses_debit_and_credit_columns(self):
        row = map_row(
            {
                "aag01": "2171",
                "期末借方": "0",
                "期末貸方": "9,800.00",
            },
            "2026-07",
            3,
        )
        self.assertEqual(row.account_code, "2171")
        self.assertEqual(row.ending_debit, Decimal("0"))
        self.assertEqual(row.ending_credit, Decimal("9800.00"))
        self.assertEqual(row.ending_balance, Decimal("-9800.00"))

    def test_rejects_null_account(self):
        with self.assertRaisesRegex(ValueError, "account identifier"):
            map_row({"期末餘額": "10"}, "2026-07", 4)

    def test_rejects_non_numeric_balance(self):
        with self.assertRaisesRegex(ValueError, "no numeric"):
            map_row({"科目": "1103", "期末餘額": "n/a"}, "2026-07", 5)

    def test_rejects_other_period(self):
        with self.assertRaisesRegex(ValueError, "not 2026-07"):
            map_row({"科目代號": "1103", "年月": "202608", "期末餘額": "1"}, "2026-07", 6)

    def test_parenthetical_negative(self):
        self.assertEqual(parse_number("(12.5)"), Decimal("-12.5"))
        self.assertEqual(parse_number("12.5-"), Decimal("-12.5"))
        self.assertEqual(parse_number(" -   "), Decimal("0"))
        self.assertIsNone(parse_number("abc"))

    def test_maps_english_account_code_debit_credit_without_period(self):
        row = map_row(
            {
                "Account Code": "1103101",
                "Account": "Cash in Banks - CTBC - 2447",
                "Debit": "601,474.62",
                "Credit": " -   ",
            },
            "2026-07",
            2,
        )
        self.assertEqual(row.account_code, "1103101")
        self.assertEqual(row.account_name, "Cash in Banks - CTBC - 2447")
        self.assertEqual(row.ending_debit, Decimal("601474.62"))
        self.assertEqual(row.ending_credit, Decimal("0"))
        self.assertEqual(row.period, "2026-07")

    def test_period_comes_from_filename_when_csv_has_none(self):
        self.assertEqual(
            period_from_filename("3-4.試算表 202607_20260917_July.csv"),
            "2026-07",
        )

    def test_period_from_filename_can_return_none(self):
        self.assertIsNone(period_from_filename("trial_balance.csv", default=None))

    def test_classifies_trial_balance_and_coa(self):
        self.assertEqual(
            classify_filename("3-4.試算表 202607_20260917_July.csv"),
            "trial_balance",
        )
        self.assertEqual(classify_filename("trial_balance.csv"), "trial_balance")
        self.assertEqual(classify_filename("chartOfAccount.csv"), "accounts")
        self.assertEqual(classify_filename("科目.csv"), "accounts")

    def test_require_ending_period(self):
        self.assertEqual(require_ending_period("2026-07"), "2026-07")
        self.assertEqual(require_ending_period("202607"), "2026-07")
        with self.assertRaises(HTTPException):
            require_ending_period(None)
        with self.assertRaises(HTTPException):
            require_ending_period("July")

    def test_preview_trial_balance_without_masters(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "3-4.試算表 202607_20260917_July.csv"
            path.write_text(
                "Account Code,Account,Debit,Credit\n1103,Cash,100, -\n",
                encoding="utf-8",
            )
            result = preview_gtt_import(tmp)
            self.assertFalse(result["ready"])
            self.assertTrue(result["trial_balance_ready"])
            self.assertEqual(result["trial_balance_period"], "2026-07")
            self.assertEqual(result["counts"]["trial_balance"], 1)
            self.assertEqual(result["trial_balance"][0]["account_code"], "1103")
            self.assertEqual(result["trial_balance"][0]["ending_debit"], "100")
