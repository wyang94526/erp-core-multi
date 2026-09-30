# @author: Wendy Yang
# @date: 2026-09-19

from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.exc import IntegrityError

from app.schemas import SupplierInvoiceCreate
from app.services.p2p import (
    _assert_invoice_editable,
    reject_supplier_invoice,
    submit_supplier_invoice,
    validate_supplier_invoice_payload,
)


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


def test_schema_accepts_optional_reference_po_number():
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
    assert payload.reference_po_number == "PU62-26090001"
    assert payload.source_type == "NON_PO"
    assert payload.source_order_id is None


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


def test_draft_and_rejected_non_po_are_editable():
    draft = SimpleNamespace(status="DRAFT", invoice_type="EXPENSE")
    rejected = SimpleNamespace(status="REJECTED", invoice_type="LANDED_COST")
    _assert_invoice_editable(draft)
    _assert_invoice_editable(rejected)


def test_pending_or_po_matched_cannot_be_edited():
    with pytest.raises(HTTPException) as exc:
        _assert_invoice_editable(SimpleNamespace(status="PENDING_APPROVAL", invoice_type="EXPENSE"))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        _assert_invoice_editable(SimpleNamespace(status="DRAFT", invoice_type="PO_MATCHED"))
    assert "Non-PO" in str(exc.value.detail)


def test_reject_falls_back_to_draft_when_rejected_status_is_blocked():
    invoice = SimpleNamespace(status="PENDING_APPROVAL", id=9)
    db = MagicMock()
    db.begin_nested.return_value.__enter__.return_value = None
    db.begin_nested.return_value.__exit__.return_value = None
    db.flush.side_effect = [
        IntegrityError("flush", {}, Exception("chk_supplier_invoice_status")),
        None,
    ]
    with patch("app.services.p2p._load_invoice", return_value=invoice):
        with patch("app.services.p2p.serialize_supplier_invoice", return_value={"status": "DRAFT"}):
            result = reject_supplier_invoice(db, 9)
    assert invoice.status == "DRAFT"
    assert result["status"] == "DRAFT"


def test_reject_moves_pending_invoice_to_rejected():
    invoice = SimpleNamespace(status="PENDING_APPROVAL", id=9)
    db = MagicMock()
    with patch("app.services.p2p._load_invoice", return_value=invoice):
        with patch("app.services.p2p.serialize_supplier_invoice", return_value={"status": "REJECTED"}):
            result = reject_supplier_invoice(db, 9)
    assert invoice.status == "REJECTED"
    assert result["status"] == "REJECTED"


def test_submit_allows_rejected_invoice():
    invoice = SimpleNamespace(status="REJECTED", id=9)
    db = MagicMock()
    with patch("app.services.p2p._load_invoice", return_value=invoice):
        with patch("app.services.p2p.serialize_supplier_invoice", return_value={"status": "PENDING_APPROVAL"}):
            submit_supplier_invoice(db, 9)
    assert invoice.status == "PENDING_APPROVAL"


def test_schema_rejects_zero_distribution_amount():
    with pytest.raises(ValidationError):
        SupplierInvoiceCreate(
            invoice_type="LANDED_COST",
            vendor_id="V-100",
            distributions=[{"gl_account_id": uuid4(), "amount": "0.00"}],
        )
