# @author: Wendy Yang
# @date: 2026-09-19

import unittest
from datetime import date
from decimal import Decimal

from fastapi import HTTPException

from app.services.financial_reports import (
    PNL_CLOSE_SOURCES,
    REPORT_CATALOG,
    REPORT_IDS,
    aging_bucket,
    classify_counter_account,
    is_cash_account,
    is_fixed_asset_account,
    period_bounds,
    pnl_operating_journal_filter,
    resolve_filters,
    signed_balance,
)


class FinancialReportHelperTests(unittest.TestCase):
    def test_catalog_covers_required_statements(self):
        required = {
            "balance-sheet",
            "income-statement",
            "cash-flow",
            "ar-aging",
            "ap-aging",
            "trial-balance",
            "fixed-asset-schedule",
            "cash-flow-forecast",
            "budget-vs-actual",
            "bank-reconciliation",
        }
        self.assertTrue(required.issubset(REPORT_IDS))
        self.assertEqual(len(REPORT_CATALOG), 10)

    def test_signed_balance_uses_normal_side(self):
        self.assertEqual(signed_balance("Asset", 100, 40), Decimal("60.00"))
        self.assertEqual(signed_balance("Revenue", 10, 90), Decimal("80.00"))
        self.assertEqual(signed_balance("Expense", 50, 5), Decimal("45.00"))

    def test_aging_buckets(self):
        self.assertEqual(aging_bucket(-3), "current")
        self.assertEqual(aging_bucket(0), "current")
        self.assertEqual(aging_bucket(12), "d1_30")
        self.assertEqual(aging_bucket(45), "d31_60")
        self.assertEqual(aging_bucket(80), "d61_90")
        self.assertEqual(aging_bucket(120), "d90")

    def test_period_bounds_and_filter_validation(self):
        start, end = period_bounds("2026-09")
        self.assertEqual(start, date(2026, 9, 1))
        self.assertEqual(end, date(2026, 9, 30))
        resolved = resolve_filters(period="2026-02", fiscal_year=2026, currency="usd")
        self.assertEqual(resolved["period"], "2026-02")
        self.assertEqual(resolved["date_from"], "2026-02-01")
        self.assertEqual(resolved["date_to"], "2026-02-28")
        self.assertEqual(resolved["currency"], "USD")
        with self.assertRaises(HTTPException):
            resolve_filters(date_from=date(2026, 3, 1), date_to=date(2026, 1, 1))

    def test_pnl_excludes_month_end_close_sources(self):
        self.assertEqual(PNL_CLOSE_SOURCES, ("MONTH_END_CLOSE", "YEAR_END_CLOSE"))
        clause = pnl_operating_journal_filter()
        self.assertIsNotNone(clause)

    def test_account_classification(self):
        self.assertTrue(is_cash_account("1000", "Cash", "Asset"))
        self.assertFalse(is_cash_account("1100", "Accounts Receivable", "Asset"))
        self.assertTrue(is_fixed_asset_account("1500", "Equipment", "Asset"))
        self.assertTrue(is_fixed_asset_account("1590", "Accumulated Depreciation", "Asset"))
        self.assertEqual(classify_counter_account("Revenue", "4000", "Sales"), "operating")
        self.assertEqual(classify_counter_account("Asset", "1500", "Equipment"), "investing")
        self.assertEqual(classify_counter_account("Equity", "3000", "Retained Earnings"), "financing")


if __name__ == "__main__":
    unittest.main()
