# @author: Wendy Yang
# @date: 2026-09-19

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from app.services.p2p import receipt_status_label, serialize_goods_receipt


class GoodsReceiptDetailTests(TestCase):
    def test_receipt_status_label_maps_posted_draft_and_voided(self):
        self.assertEqual(receipt_status_label("POSTED"), "Posted")
        self.assertEqual(receipt_status_label("DRAFT"), "Draft")
        self.assertEqual(receipt_status_label("CANCELLED"), "Voided")
        self.assertEqual(receipt_status_label(None), "Posted")

    def test_serialize_goods_receipt_includes_header_fields(self):
        row = SimpleNamespace(
            id=12,
            receipt_number="GR-2026-0009",
            source_type="PURCHASE_ORDER",
            source_order_id="PU62-26090001",
            vendor_id="A4052",
            vendor=SimpleNamespace(company_name="Acme Cable"),
            receipt_date=date(2026, 9, 18),
            status="POSTED",
            notes="Dock 2",
            created_at=None,
            lines=[
                SimpleNamespace(
                    id=1,
                    receipt_id=12,
                    source_line_id=88,
                    item_id="1001G00001820",
                    description="Assembly",
                    quantity_received=Decimal("10"),
                    unit_cost=Decimal("2.5"),
                    line_amount=Decimal("25.00"),
                )
            ],
        )
        payload = serialize_goods_receipt(row)
        self.assertEqual(payload["receipt_number"], "GR-2026-0009")
        self.assertEqual(payload["vendor_name"], "Acme Cable")
        self.assertEqual(payload["status_label"], "Posted")
        self.assertEqual(payload["total_amount"], Decimal("25.00"))
        self.assertEqual(payload["lines"][0]["item_id"], "1001G00001820")
        self.assertEqual(payload["journals"], [])
        self.assertEqual(payload["related_invoices"], [])
