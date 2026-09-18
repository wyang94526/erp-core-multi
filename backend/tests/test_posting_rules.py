from types import SimpleNamespace
from unittest import TestCase

from app.services.posting_rules import (
    DEFAULT_RULES,
    EVENT_GOODS_RECEIPT,
    EVENT_SALES_INVOICE,
    EVENT_SUPPLIER_INVOICE,
    PARTY_RELATED,
    PARTY_TRADE,
    VARIANT_GRNI_CLEAR,
    VARIANT_MATERIALS,
    VARIANT_REVENUE,
    VARIANT_SUBCONTRACT,
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
