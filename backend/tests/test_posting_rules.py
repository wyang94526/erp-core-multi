# @author: Wendy Yang
# @date: 2026-09-19

from types import SimpleNamespace
from unittest import TestCase

from app.services.posting_rules import (
    DEFAULT_RULES,
    EVENT_BANK_TRANSFER,
    EVENT_GOODS_RECEIPT,
    EVENT_MONTH_END_CLOSE,
    EVENT_SALES_INVOICE,
    EVENT_SUPPLIER_INVOICE,
    EVENT_YEAR_END_CLOSE,
    PARTY_ANY,
    PARTY_RELATED,
    PARTY_TRADE,
    VARIANT_ACCRUAL,
    VARIANT_CLOSE,
    VARIANT_DEPRECIATION,
    VARIANT_FX_REVAL,
    VARIANT_GRNI_ACCRUAL,
    VARIANT_GRNI_CLEAR,
    VARIANT_NI_CLEAR,
    VARIANT_PREPAY,
    VARIANT_MATERIALS,
    VARIANT_REVENUE,
    VARIANT_SUBCONTRACT,
    VARIANT_TRANSFER,
    catalog_account,
    find_default_rule,
    receipt_variant,
)


class PostingRuleCatalogTests(TestCase):
    def test_catalog_covers_unique_event_variant_party(self):
        keys = [(row["event_code"], row["variant"], row["party_scope"]) for row in DEFAULT_RULES]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertGreaterEqual(len(DEFAULT_RULES), 20)

    def test_goods_receipt_materials_is_inventory_to_grni(self):
        debit = catalog_account(EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, PARTY_TRADE, "debit")
        credit = catalog_account(EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, PARTY_TRADE, "credit")
        self.assertEqual(debit[0], "1313")
        self.assertEqual(credit[0], "2172")
        related = catalog_account(EVENT_GOODS_RECEIPT, VARIANT_MATERIALS, PARTY_RELATED, "credit")
        self.assertEqual(related[0], "2182")

    def test_subcontract_receipt_debits_processing_fees(self):
        item = SimpleNamespace(item_type="INVENTORY")
        self.assertEqual(receipt_variant("SUBCONTRACT_ORDER", item), VARIANT_SUBCONTRACT)
        code, _name, kind = catalog_account(
            EVENT_GOODS_RECEIPT, VARIANT_SUBCONTRACT, PARTY_TRADE, "debit"
        )
        self.assertEqual(code, "5146")
        self.assertEqual(kind, "Expense")

    def test_supplier_invoice_clears_grni_to_ap(self):
        trade = find_default_rule(EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, PARTY_TRADE)
        self.assertEqual(trade["debit_code"], "2172")
        self.assertEqual(trade["credit_code"], "2171")
        related = find_default_rule(EVENT_SUPPLIER_INVOICE, VARIANT_GRNI_CLEAR, PARTY_RELATED)
        self.assertEqual(related["debit_code"], "2182")
        self.assertEqual(related["credit_code"], "2181")

    def test_sales_invoice_is_ar_to_revenue(self):
        debit, _name, _kind = catalog_account(
            EVENT_SALES_INVOICE, VARIANT_REVENUE, "ANY", "debit"
        )
        credit, _cname, _ckind = catalog_account(
            EVENT_SALES_INVOICE, VARIANT_REVENUE, "ANY", "credit"
        )
        self.assertEqual(debit, "1172")
        self.assertEqual(credit, "4110001")

    def test_bank_transfer_is_in_catalog(self):
        rule = find_default_rule(EVENT_BANK_TRANSFER, VARIANT_TRANSFER, PARTY_ANY)
        self.assertIsNotNone(rule)
        self.assertEqual(rule["rule_code"], "BANK_TRANSFER")

    def test_month_end_rules_are_adjustments_only(self):
        month_rules = [row for row in DEFAULT_RULES if row["event_code"] == EVENT_MONTH_END_CLOSE]
        codes = {row["rule_code"] for row in month_rules}
        self.assertEqual(
            codes,
            {
                "MEC_GRNI_ACCRUAL_TRADE",
                "MEC_GRNI_ACCRUAL_RELATED",
                "MEC_PREPAY",
                "MEC_ACCRUAL",
                "MEC_DEPRECIATION",
                "MEC_FX_REVAL",
            },
        )
        for row in month_rules:
            self.assertNotEqual(row["variant"], VARIANT_CLOSE)
            self.assertNotEqual(row["credit_code"], "3353")
        self.assertEqual(
            catalog_account(EVENT_MONTH_END_CLOSE, VARIANT_GRNI_ACCRUAL, PARTY_TRADE, "credit")[0],
            "2172",
        )
        self.assertEqual(
            catalog_account(EVENT_MONTH_END_CLOSE, VARIANT_GRNI_ACCRUAL, PARTY_RELATED, "credit")[0],
            "2182",
        )
        self.assertEqual(
            catalog_account(EVENT_MONTH_END_CLOSE, VARIANT_PREPAY, PARTY_ANY, "credit")[0],
            "1251",
        )
        self.assertEqual(
            catalog_account(EVENT_MONTH_END_CLOSE, VARIANT_ACCRUAL, PARTY_ANY, "credit")[0],
            "2179",
        )
        self.assertEqual(
            catalog_account(EVENT_MONTH_END_CLOSE, VARIANT_DEPRECIATION, PARTY_ANY, "debit")[0],
            "5601",
        )
        self.assertEqual(
            catalog_account(EVENT_MONTH_END_CLOSE, VARIANT_FX_REVAL, PARTY_ANY, "debit")[0],
            "7181",
        )

    def test_year_end_close_moves_pnl_to_retained_earnings(self):
        yec_debit = catalog_account(EVENT_YEAR_END_CLOSE, VARIANT_CLOSE, PARTY_ANY, "debit")
        yec_credit = catalog_account(EVENT_YEAR_END_CLOSE, VARIANT_CLOSE, PARTY_ANY, "credit")
        self.assertEqual(yec_debit[0], "4110001")
        self.assertEqual(yec_credit[0], "3350")
        ni_debit = catalog_account(EVENT_YEAR_END_CLOSE, VARIANT_NI_CLEAR, PARTY_ANY, "debit")
        ni_credit = catalog_account(EVENT_YEAR_END_CLOSE, VARIANT_NI_CLEAR, PARTY_ANY, "credit")
        self.assertEqual(ni_debit[0], "3353")
        self.assertEqual(ni_credit[0], "3350")
