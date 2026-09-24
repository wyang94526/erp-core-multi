# @author: Wendy Yang
# @date: 2026-09-24

from types import SimpleNamespace
from unittest import TestCase

from uuid import uuid4

from fastapi import HTTPException

from app.schemas import SupplierInvoiceCreate
from app.services.finance import resolve_ap_bill_po_number, serialize_ap_bill_row
from app.services.p2p import require_approved_reference_po


class FakeDb:
    def __init__(self, orders=None):
        self.orders = orders or {}

    def get(self, _model, key):
        return self.orders.get(key)


class ApBillPoLinkTests(TestCase):
    def test_uses_purchase_order_id_when_present(self):
        bill = SimpleNamespace(
            purchase_order_id="PU62-26090001",
            source_order_id=None,
            source_type="PURCHASE_ORDER",
        )
        self.assertEqual(resolve_ap_bill_po_number(FakeDb(), bill), "PU62-26090001")

    def test_resolves_landed_cost_non_po_to_linked_purchase_order(self):
        bill = SimpleNamespace(
            purchase_order_id=None,
            source_order_id="PU62-26090001",
            source_type="NON_PO",
        )
        db = FakeDb({"PU62-26090001": object()})
        self.assertEqual(resolve_ap_bill_po_number(db, bill), "PU62-26090001")

    def test_list_row_exposes_po_number_for_frontend_link(self):
        bill = SimpleNamespace(
            bill_id="VBILL-2026-0008",
            purchase_order_id=None,
            source_order_id="PU62-26090001",
            source_type="NON_PO",
            vendor_id="V-FREIGHT",
            supplier_invoice_id=8,
            amount=80,
            status="Unpaid",
            approval_status="APPROVED",
            current_approval_step=None,
            due_date=None,
            payment_term_id=None,
            created_at=None,
        )
        row = serialize_ap_bill_row(FakeDb({"PU62-26090001": object()}), bill)
        self.assertEqual(row["po_number"], "PU62-26090001")
        self.assertEqual(row["purchase_order_id"], "PU62-26090001")

    def test_create_schema_accepts_optional_reference_po(self):
        payload = SupplierInvoiceCreate(
            invoice_type="EXPENSE",
            source_type="NON_PO",
            vendor_id="V-100",
            reference_po_number="PU62-26090001",
            currency="USD",
            distributions=[
                {
                    "gl_account_id": uuid4(),
                    "amount": "40.00",
                    "description": "Import duty",
                }
            ],
        )
        self.assertEqual(payload.reference_po_number, "PU62-26090001")
        self.assertIsNone(payload.source_order_id)

    def test_resolves_reference_po_number_on_non_po_bill(self):
        bill = SimpleNamespace(
            purchase_order_id=None,
            reference_po_number="PU62-26090001",
            source_order_id=None,
            source_type="NON_PO",
        )
        self.assertEqual(resolve_ap_bill_po_number(FakeDb(), bill), "PU62-26090001")

    def test_reference_po_must_be_approved(self):
        draft = SimpleNamespace(po_number="PU62-DRAFT", approval_status="DRAFT")
        approved = SimpleNamespace(po_number="PU62-26090001", approval_status="APPROVED")
        with self.assertRaises(HTTPException) as missing:
            require_approved_reference_po(FakeDb(), "PU62-MISSING")
        self.assertEqual(missing.exception.status_code, 400)
        with self.assertRaises(HTTPException) as blocked:
            require_approved_reference_po(FakeDb({"PU62-DRAFT": draft}), "PU62-DRAFT")
        self.assertEqual(blocked.exception.status_code, 400)
        self.assertIn("APPROVED", str(blocked.exception.detail))
        self.assertEqual(
            require_approved_reference_po(FakeDb({"PU62-26090001": approved}), "PU62-26090001"),
            approved,
        )
