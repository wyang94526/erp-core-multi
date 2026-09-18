# @author: Wendy Yang
# @date: 2026-09-19

from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas import SupplierInvoiceCreate
from app.services.p2p import validate_supplier_invoice_payload


def test_po_matched_requires_source_order_id():
    with pytest.raises(HTTPException) as exc:
        validate_supplier_invoice_payload(
            invoice_type="PO_MATCHED",
            source_type="PURCHASE_ORDER",
            source_order_id=None,
            vendor_id="V-1",
            distributions=None,
            lines=[{"quantity_billed": 1, "unit_price": 10}],
        )
    assert exc.value.status_code == 400
    assert "source_order_id" in str(exc.value.detail)


def test_po_matched_payload_is_accepted():
    resolved = validate_supplier_invoice_payload(
        invoice_type="PO_MATCHED",
        source_type="PURCHASE_ORDER",
        source_order_id="PU62-2609-0001",
        vendor_id=None,
        distributions=None,
        lines=[{"quantity_billed": 1, "unit_price": 10}],
    )
    assert resolved == ("PO_MATCHED", "PURCHASE_ORDER", "PU62-2609-0001")


def test_expense_invoice_requires_vendor_and_distributions():
    with pytest.raises(HTTPException) as exc:
        validate_supplier_invoice_payload(
            invoice_type="EXPENSE",
            source_type="NON_PO",
            source_order_id=None,
            vendor_id="V-1",
            distributions=None,
            lines=None,
        )
    assert exc.value.status_code == 400
    assert "distribution" in str(exc.value.detail).lower()

    with pytest.raises(HTTPException) as exc:
        validate_supplier_invoice_payload(
            invoice_type="EXPENSE",
            source_type=None,
            source_order_id=None,
            vendor_id=None,
            distributions=[{"gl_account_id": str(uuid4()), "amount": "25.00"}],
            lines=None,
        )
    assert exc.value.status_code == 400
    assert "vendor_id" in str(exc.value.detail)


def test_non_po_accepts_optional_po_without_switching_source():
    resolved = validate_supplier_invoice_payload(
        invoice_type="LANDED_COST",
        source_type=None,
        source_order_id="PU62-2609-0001",
        vendor_id="V-1",
        distributions=[{"gl_account_id": str(uuid4()), "amount": "80.00"}],
        lines=None,
    )
    assert resolved[0] == "LANDED_COST"
    assert resolved[1] == "NON_PO"
    assert resolved[2] == "PU62-2609-0001"


def test_expense_rejects_po_match_lines():
    with pytest.raises(HTTPException) as exc:
        validate_supplier_invoice_payload(
            invoice_type="EXPENSE",
            source_type="NON_PO",
            source_order_id=None,
            vendor_id="V-1",
            distributions=[{"gl_account_id": str(uuid4()), "amount": "100.00"}],
            lines=[{"quantity_billed": 1, "unit_price": 100}],
        )
    assert exc.value.status_code == 400
    assert "distributions" in str(exc.value.detail)


def test_schema_allows_non_po_without_po_id():
    payload = SupplierInvoiceCreate(
        invoice_type="EXPENSE",
        vendor_id="V-100",
        currency="USD",
        distributions=[
            {
                "gl_account_id": uuid4(),
                "amount": "150.00",
                "description": "Warehouse rent",
            }
        ],
    )
    assert payload.source_order_id is None
    assert payload.invoice_type == "EXPENSE"
    assert payload.distributions and len(payload.distributions) == 1


def test_schema_rejects_zero_distribution_amount():
    with pytest.raises(ValidationError):
        SupplierInvoiceCreate(
            invoice_type="LANDED_COST",
            vendor_id="V-100",
            distributions=[{"gl_account_id": uuid4(), "amount": "0.00"}],
        )
