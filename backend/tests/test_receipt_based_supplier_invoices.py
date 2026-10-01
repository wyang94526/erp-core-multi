# @author: Wendy Yang
# @date: 2026-10-01

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.services.p2p import (
    _grni_clear_groups,
    _receipt_billable_unit_cost,
    _receipt_billing_status,
    serialize_goods_receipt,
    validate_supplier_invoice_payload,
)


class ReceiptBasedSupplierInvoiceTests(TestCase):
    def test_billing_status_rollup(self):
        self.assertEqual(_receipt_billing_status(Decimal("10"), Decimal("0")), "UNBILLED")
        self.assertEqual(_receipt_billing_status(Decimal("10"), Decimal("4")), "PARTIALLY_BILLED")
        self.assertEqual(_receipt_billing_status(Decimal("10"), Decimal("10")), "FULLY_BILLED")

    def test_billable_cost_ignores_landed_overlay(self):
        line = SimpleNamespace(
            unit_cost=Decimal("12.5000"),
            allocated_landed_cost=Decimal("8.00"),
            actual_unit_cost=Decimal("14.5000"),
        )
        self.assertEqual(_receipt_billable_unit_cost(line), Decimal("12.5000"))

    def test_billable_cost_uses_actual_when_no_landed(self):
        line = SimpleNamespace(
            unit_cost=Decimal("12.5000"),
            allocated_landed_cost=Decimal("0"),
            actual_unit_cost=Decimal("12.5000"),
        )
        self.assertEqual(_receipt_billable_unit_cost(line), Decimal("12.5000"))

    def test_serialize_includes_receipt_billing_fields(self):
        row = SimpleNamespace(
            id=12,
            receipt_number="UP72-26090002",
            source_type="SUBCONTRACT_ORDER",
            source_order_id="UP23-26090001",
            vendor_id="A4052",
            vendor=SimpleNamespace(company_name="Acme"),
            receipt_date=date(2026, 9, 30),
            status="POSTED",
            notes=None,
            created_at=None,
            lines=[
                SimpleNamespace(
                    id=1,
                    receipt_id=12,
                    source_line_id=3,
                    item_id="FG-1",
                    description="Finished good",
                    quantity_received=Decimal("8"),
                    unit_cost=Decimal("10.0000"),
                    line_amount=Decimal("80.00"),
                    allocated_landed_cost=Decimal("0"),
                    actual_unit_cost=Decimal("10.0000"),
                    quantity_invoiced=Decimal("2"),
                    billing_status="PARTIALLY_BILLED",
                )
            ],
        )
        payload = serialize_goods_receipt(row)
        self.assertEqual(payload["receipt_number"], "UP72-26090002")
        self.assertEqual(payload["quantity_received"], Decimal("8"))
        self.assertEqual(payload["quantity_invoiced"], Decimal("2"))
        self.assertEqual(payload["quantity_unbilled"], Decimal("6"))
        self.assertEqual(payload["billing_status"], "PARTIALLY_BILLED")
        self.assertEqual(payload["lines"][0]["receipt_unit_cost"], Decimal("10.0000"))

    def test_grni_clear_uses_receipt_posting_date(self):
        receipt = SimpleNamespace(
            id=9,
            receipt_number="PU67-26090011",
            receipt_date=date(2026, 9, 30),
        )
        gr_line = SimpleNamespace(
            id=21,
            unit_cost=Decimal("5.0000"),
            receipt=receipt,
            receipt_id=9,
        )
        invoice = SimpleNamespace(
            invoice_number="UX13-26100001",
            invoice_date=date(2026, 10, 1),
            source_type="PURCHASE_ORDER",
            source_order_id="PU62-26090001",
            subtotal=Decimal("25.00"),
            lines=[
                SimpleNamespace(
                    goods_receipt_line_id=21,
                    goods_receipt_line=gr_line,
                    item_id="1001",
                    quantity_billed=Decimal("5"),
                    line_subtotal=Decimal("25.00"),
                )
            ],
        )
        db = MagicMock()
        with patch("app.services.p2p.catalog_item", return_value=None):
            groups = _grni_clear_groups(db, invoice)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["posting_date"], date(2026, 9, 30))
        self.assertEqual(groups[0]["clear_amount"], Decimal("25.00"))
        self.assertEqual(groups[0]["receipt_number"], "PU67-26090011")

    def test_validate_accepts_receipt_ids(self):
        resolved = validate_supplier_invoice_payload(
            invoice_type="PO_MATCHED",
            source_type="PURCHASE_ORDER",
            source_order_id=None,
            vendor_id=None,
            distributions=None,
            lines=None,
            receipt_ids=["PU67-26090011"],
        )
        self.assertEqual(resolved[0], "PO_MATCHED")
        self.assertEqual(resolved[1], "PURCHASE_ORDER")
