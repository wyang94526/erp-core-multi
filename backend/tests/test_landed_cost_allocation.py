# @author: Wendy Yang
# @date: 2026-09-23

from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from app.services.landed_cost import (
    allocate_amount_by_weights,
    allocation_weight,
    annotate_po_line,
    annotate_receipt_line,
    landed_unit_cost,
)


class LandedCostAllocationTests(TestCase):
    def test_allocates_by_line_subtotal(self):
        shares = allocate_amount_by_weights(
            [Decimal("100.00"), Decimal("300.00")],
            Decimal("80.00"),
        )
        self.assertEqual(shares, [Decimal("20.00"), Decimal("60.00")])

    def test_remainder_goes_to_last_positive_weight(self):
        shares = allocate_amount_by_weights(
            [Decimal("1.00"), Decimal("1.00"), Decimal("1.00")],
            Decimal("10.00"),
        )
        self.assertEqual(sum(shares, Decimal("0")), Decimal("10.00"))
        self.assertEqual(shares[0] + shares[1], Decimal("6.66"))
        self.assertEqual(shares[2], Decimal("3.34"))

    def test_skips_zero_weights(self):
        shares = allocate_amount_by_weights(
            [Decimal("0"), Decimal("50.00"), Decimal("0")],
            Decimal("25.00"),
        )
        self.assertEqual(shares, [Decimal("0.00"), Decimal("25.00"), Decimal("0.00")])

    def test_weight_prefers_line_amount_then_qty(self):
        self.assertEqual(allocation_weight(4, "12.50"), Decimal("12.50"))
        self.assertEqual(allocation_weight(4, 0), Decimal("4"))
        self.assertEqual(allocation_weight(0, 0), Decimal("0.00"))

    def test_landed_unit_cost_adds_allocated_per_unit(self):
        self.assertEqual(
            landed_unit_cost(Decimal("10.0000"), Decimal("4"), Decimal("8.00")),
            Decimal("12.0000"),
        )

    def test_annotate_receipt_and_po_lines(self):
        receipt_line = SimpleNamespace(quantity_received=Decimal("10"), unit_cost=Decimal("5.0000"))
        annotate_receipt_line(receipt_line, Decimal("20.00"))
        self.assertEqual(receipt_line.allocated_landed_amount, Decimal("20.00"))
        self.assertEqual(receipt_line.landed_unit_cost, Decimal("7.0000"))
        self.assertEqual(receipt_line.actual_unit_cost, Decimal("7.0000"))

        po_line = SimpleNamespace(
            quantity=Decimal("10"),
            unit_price=Decimal("5.0000"),
            allocated_landed_expense=Decimal("10.00"),
        )
        annotate_po_line(po_line, Decimal("20.00"))
        self.assertEqual(po_line.actual_allocated_landed_expense, Decimal("20.00"))
        self.assertEqual(po_line.allocated_landed_expense, Decimal("30.00"))
        self.assertEqual(po_line.actual_unit_cost, Decimal("7.0000"))
        self.assertEqual(po_line.estimated_landed_unit_cost, Decimal("1.0000"))

    def test_po_actual_matches_partial_receipt_landed_cost(self):
        po_line = SimpleNamespace(
            quantity=Decimal("100"),
            quantity_received=Decimal("40"),
            unit_price=Decimal("44.7200"),
            allocated_landed_expense=Decimal("0.00"),
        )
        annotate_po_line(po_line, Decimal("80.00"))
        self.assertEqual(po_line.actual_allocated_landed_expense, Decimal("80.00"))
        self.assertEqual(po_line.actual_unit_cost, Decimal("46.7200"))

    def test_po_actual_uses_explicit_received_qty(self):
        po_line = SimpleNamespace(
            quantity=Decimal("100"),
            quantity_received=Decimal("0"),
            unit_price=Decimal("44.7200"),
            allocated_landed_expense=Decimal("0.00"),
        )
        annotate_po_line(po_line, Decimal("80.00"), received_qty=Decimal("40"))
        self.assertEqual(po_line.actual_unit_cost, Decimal("46.7200"))
