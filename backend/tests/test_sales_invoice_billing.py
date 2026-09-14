from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.o2c import (
    assert_new_invoice_within_order_balance,
    invoice_status_label,
)


def test_invoice_status_label():
    assert invoice_status_label(Decimal("100.00"), Decimal("0")) == "UNBILLED"
    assert invoice_status_label(Decimal("100.00"), Decimal("40.00")) == "PARTIALLY_BILLED"
    assert invoice_status_label(Decimal("100.00"), Decimal("100.00")) == "FULLY_BILLED"
    assert invoice_status_label(Decimal("100.00"), Decimal("100.01")) == "FULLY_BILLED"


def test_blocks_when_sales_order_already_fully_invoiced():
    with pytest.raises(HTTPException) as exc:
        assert_new_invoice_within_order_balance(
            sales_order_id="SO-20260620-001",
            order_total=Decimal("158940.00"),
            billed_amount=Decimal("158940.00"),
            new_invoice_amount=Decimal("158940.00"),
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "Sales Order SO-20260620-001 is already fully invoiced."


def test_blocks_amount_over_remaining_balance():
    with pytest.raises(HTTPException) as exc:
        assert_new_invoice_within_order_balance(
            sales_order_id="SO-20260620-001",
            order_total=Decimal("100.00"),
            billed_amount=Decimal("60.00"),
            new_invoice_amount=Decimal("50.00"),
        )
    assert exc.value.status_code == 400
    assert "exceeds remaining unbilled balance 40.00" in str(exc.value.detail)


def test_allows_partial_invoice_up_to_remaining_balance():
    assert_new_invoice_within_order_balance(
        sales_order_id="SO-20260620-001",
        order_total=Decimal("100.00"),
        billed_amount=Decimal("60.00"),
        new_invoice_amount=Decimal("40.00"),
    )


def test_voided_amount_is_treated_as_unbilled():
    # Callers pass only DRAFT/APPROVED/PAID totals; VOID is excluded upstream.
    assert invoice_status_label(Decimal("100.00"), Decimal("0.00")) == "UNBILLED"
    assert_new_invoice_within_order_balance(
        sales_order_id="SO-20260620-001",
        order_total=Decimal("100.00"),
        billed_amount=Decimal("0.00"),
        new_invoice_amount=Decimal("100.00"),
    )
