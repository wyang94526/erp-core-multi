from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.subcontract import (
    assert_can_amend_cost_sheet,
    assert_sco_fulfillment_allowed,
    compute_charge_sheet,
    compute_cost_per_unit,
    previously_approved,
)


def test_minutes_times_sf_rate_over_sixty():
    assert compute_cost_per_unit(Decimal("4.5"), Decimal("100")) == Decimal("7.50")
    assert compute_cost_per_unit(Decimal("18"), Decimal("125")) == Decimal("37.50")
    assert compute_cost_per_unit(Decimal("6"), Decimal("125")) == Decimal("12.50")


def test_quote_rollup_matches_sample():
    sheet = compute_charge_sheet(
        [
            {"name": "Receiving, IQC and storage", "labor_minutes": 4.5, "sf_rate": 100},
            {"name": "Assembly Service", "labor_minutes": 18, "sf_rate": 125},
            {"name": "Inventory Management & Shipment", "labor_minutes": 6, "sf_rate": 125},
            {"name": "Admin & Documentation", "labor_minutes": 6, "sf_rate": 125},
            {"name": "Margin", "is_margin": True, "margin_percent": Decimal("5.7143"), "cost_per_unit": Decimal("4.00")},
        ],
        500,
    )
    assert sheet["cost_subtotal"] == Decimal("70.0000")
    assert sheet["margin_amount"] == Decimal("4.00")
    assert sheet["unit_price"] == Decimal("74.0000")
    assert sheet["line_total"] == Decimal("37000.00")


def test_amend_allowed_only_when_approved_and_open():
    assert_can_amend_cost_sheet(SimpleNamespace(status="PLANNED", approval_status="APPROVED"))
    with pytest.raises(HTTPException) as draft:
        assert_can_amend_cost_sheet(SimpleNamespace(status="PLANNED", approval_status="DRAFT"))
    assert draft.value.status_code == 400
    with pytest.raises(HTTPException) as closed:
        assert_can_amend_cost_sheet(SimpleNamespace(status="CANCELLED", approval_status="APPROVED"))
    assert closed.value.status_code == 400


def test_fulfillment_continues_during_cost_sheet_amendment():
    assert not previously_approved(SimpleNamespace(amendment_number=0))
    draft = SimpleNamespace(approval_status="DRAFT", amendment_number=0)
    with pytest.raises(HTTPException):
        assert_sco_fulfillment_allowed(draft, "issuing materials")
    amending = SimpleNamespace(approval_status="DRAFT", amendment_number=1)
    assert_sco_fulfillment_allowed(amending, "issuing materials")
    assert_sco_fulfillment_allowed(
        SimpleNamespace(approval_status="APPROVED", amendment_number=0),
        "issuing materials",
    )
