from types import SimpleNamespace
from unittest import TestCase

from app.services.finance import (
    AP_ACCOUNT_CODE,
    AR_ACCOUNT_CODE,
    INVENTORY_ACCOUNT_CODE,
    PROCESSING_FEES_ACCOUNT_CODE,
    PURCHASE_EXPENSE_ACCOUNT_CODE,
    RELATED_AP_ACCOUNT_CODE,
    REVENUE_ACCOUNT_CODE,
    ap_account_spec,
    is_related_party_supplier,
    receipt_debit_spec,
)
from app.services.item_types import DEFAULT_EXPENSE_ACCOUNT_CODE, DEFAULT_REVENUE_ACCOUNT_CODE


class GlAccountMappingTests(TestCase):
    def test_trade_ap_defaults_to_2171(self):
        code, name, kind = ap_account_spec(None)
        self.assertEqual(code, "2171")
        self.assertEqual(name, "Accounts Payable")
        self.assertEqual(kind, "Liability")
        self.assertEqual(AP_ACCOUNT_CODE, "2171")

    def test_related_party_ap_uses_2181(self):
        vendor = SimpleNamespace(
            notes="TIPTOP pmc17=P10; related_party=Y; short_name=GTT",
            ap_account_id=None,
        )
        self.assertTrue(is_related_party_supplier(vendor))
        code, name, _kind = ap_account_spec(vendor)
        self.assertEqual(code, RELATED_AP_ACCOUNT_CODE)
        self.assertEqual(code, "2181")
        self.assertEqual(name, "Accounts Payable - related parties")

    def test_unrelated_vendor_stays_on_trade_ap(self):
        vendor = SimpleNamespace(notes="TIPTOP pmc17=P02; short_name=Nex", ap_account_id=None)
        self.assertFalse(is_related_party_supplier(vendor))
        self.assertEqual(ap_account_spec(vendor)[0], "2171")

    def test_po_material_receipt_debits_half_finished_goods(self):
        item = SimpleNamespace(item_type="INVENTORY")
        code, name, kind = receipt_debit_spec("PURCHASE_ORDER", item)
        self.assertEqual(code, INVENTORY_ACCOUNT_CODE)
        self.assertEqual(code, "1313")
        self.assertEqual(name, "Half-finished Goods")
        self.assertEqual(kind, "Asset")

    def test_expense_receipt_debits_purchase_expenses(self):
        item = SimpleNamespace(item_type="SERVICE")
        code, name, kind = receipt_debit_spec("PURCHASE_ORDER", item)
        self.assertEqual(code, PURCHASE_EXPENSE_ACCOUNT_CODE)
        self.assertEqual(code, "5190")
        self.assertEqual(name, "Purchase Expenses")
        self.assertEqual(kind, "Expense")

    def test_subcontract_receipt_debits_processing_fees(self):
        item = SimpleNamespace(item_type="INVENTORY")
        code, name, kind = receipt_debit_spec("SUBCONTRACT_ORDER", item)
        self.assertEqual(code, PROCESSING_FEES_ACCOUNT_CODE)
        self.assertEqual(code, "5146")
        self.assertEqual(name, "Processing Fees")
        self.assertEqual(kind, "Expense")

    def test_trade_grni_uses_provisional_ap(self):
        from app.services.finance import grni_account_spec

        code, name, kind = grni_account_spec(None)
        self.assertEqual(code, "2172")
        self.assertEqual(kind, "Liability")
        related = SimpleNamespace(notes="related_party=Y", ap_account_id=None)
        self.assertEqual(grni_account_spec(related)[0], "2182")

    def test_cash_fallback_uses_cash_in_banks(self):
        from app.services.finance import CASH_ACCOUNT_CODE

        self.assertEqual(CASH_ACCOUNT_CODE, "1103")

    def test_ar_and_revenue_use_standard_sales_accounts(self):
        self.assertEqual(AR_ACCOUNT_CODE, "1172")
        self.assertEqual(REVENUE_ACCOUNT_CODE, "4110001")
        self.assertEqual(DEFAULT_REVENUE_ACCOUNT_CODE, "4110001")
        self.assertEqual(DEFAULT_EXPENSE_ACCOUNT_CODE, "5190")
