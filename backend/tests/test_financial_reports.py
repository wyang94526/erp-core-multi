# @author: Wendy Yang
# @date: 2026-09-19

import unittest
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException

from app.services.financial_reports import (
    PNL_CLOSE_SOURCES,
    REPORT_CATALOG,
    REPORT_IDS,
    AccountBalance,
    aging_bucket,
    classify_counter_account,
    is_cash_account,
    is_fixed_asset_account,
    merge_account_balances,
    normalize_account_type,
    period_bounds,
    pnl_operating_journal_filter,
    resolve_filters,
    select_imported_period,
    signed_balance,
    _append_pnl_account_rows,
    _pnl_year_start,
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
        self.assertEqual(
            signed_balance("Income", 1000, 9000, "4110001", "Sales Revenue"),
            Decimal("8000.00"),
        )
        self.assertEqual(
            signed_balance("", 1000, 9000, "4110001", "Sales Revenue"),
            Decimal("8000.00"),
        )

    def test_normalize_sales_account_as_revenue(self):
        self.assertEqual(normalize_account_type("Income"), "revenue")
        self.assertEqual(normalize_account_type(None, "4110001", "Sales Revenue"), "revenue")

    def test_pnl_rows_include_debit_credit_and_net(self):
        rows: list[dict] = []
        total, ytd_total = _append_pnl_account_rows(
            rows,
            "Revenue",
            [
                AccountBalance(
                    account_id=UUID("00000000-0000-0000-0000-000000000001"),
                    account_code="4110001",
                    account_name="Sales Revenue",
                    account_type="Revenue",
                    debit=Decimal("1000.00"),
                    credit=Decimal("9000.00"),
                )
            ],
            [
                AccountBalance(
                    account_id=UUID("00000000-0000-0000-0000-000000000001"),
                    account_code="4110001",
                    account_name="Sales Revenue",
                    account_type="Revenue",
                    debit=Decimal("1500.00"),
                    credit=Decimal("50000.00"),
                )
            ],
        )
        self.assertEqual(total, Decimal("8000.00"))
        self.assertEqual(ytd_total, Decimal("48500.00"))
        line = rows[1]["cells"]
        self.assertEqual(line["debit"], 1000.0)
        self.assertEqual(line["credit"], 9000.0)
        self.assertEqual(line["amount"], 8000.0)
        self.assertEqual(line["ytd_debit"], 1500.0)
        self.assertEqual(line["ytd_credit"], 50000.0)
        self.assertEqual(line["ytd_amount"], 48500.0)

    def test_pnl_includes_ytd_only_accounts(self):
        rows: list[dict] = []
        period_account = AccountBalance(
            account_id=UUID("00000000-0000-0000-0000-000000000001"),
            account_code="4110001",
            account_name="Sales Revenue",
            account_type="Revenue",
            debit=Decimal("0.00"),
            credit=Decimal("100.00"),
        )
        ytd_prior = AccountBalance(
            account_id=UUID("00000000-0000-0000-0000-000000000002"),
            account_code="4110002",
            account_name="Service Revenue",
            account_type="Revenue",
            debit=Decimal("0.00"),
            credit=Decimal("250.00"),
        )
        total, ytd_total = _append_pnl_account_rows(
            rows,
            "Revenue",
            [period_account],
            [period_account, ytd_prior],
        )
        self.assertEqual(total, Decimal("100.00"))
        self.assertEqual(ytd_total, Decimal("350.00"))
        labels = [row["cells"]["label"] for row in rows]
        self.assertTrue(any("4110002" in label for label in labels))

    def test_pnl_year_start_uses_fiscal_year(self):
        start = _pnl_year_start({"_year": 2026, "_to": date(2026, 9, 30)})
        self.assertEqual(start, date(2026, 1, 1))

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

    def test_imported_period_is_latest_month_end_on_or_before_as_of(self):
        periods = ["2026-07", "2026-08"]
        self.assertEqual(select_imported_period(periods, date(2026, 7, 31)), "2026-07")
        self.assertEqual(select_imported_period(periods, date(2026, 8, 15)), "2026-07")
        self.assertEqual(select_imported_period(periods, date(2026, 8, 31)), "2026-08")
        self.assertIsNone(select_imported_period(periods, date(2026, 6, 30)))

    def test_merge_adds_imported_and_later_journal_activity(self):
        cash_id = UUID("00000000-0000-0000-0000-000000000110")
        ap_id = UUID("00000000-0000-0000-0000-000000000217")
        imported = [
            AccountBalance(cash_id, "1103", "Cash", "Asset", Decimal("100.00"), Decimal("0")),
            AccountBalance(ap_id, "2171", "AP", "Liability", Decimal("0"), Decimal("100.00")),
        ]
        later = [
            AccountBalance(cash_id, "1103", "Cash", "Asset", Decimal("50.00"), Decimal("0")),
        ]
        merged = {row.account_id: row for row in merge_account_balances(imported, later)}
        self.assertEqual(merged[cash_id].debit, Decimal("150.00"))
        self.assertEqual(merged[ap_id].credit, Decimal("100.00"))


if __name__ == "__main__":
    unittest.main()
