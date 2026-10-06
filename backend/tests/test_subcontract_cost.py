# @author: Wendy Yang
# @date: 2026-09-19

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.subcontract import (
    SCO_KIT_MUST_BE_ISSUED_DETAIL,
    SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL,
    assert_can_amend_cost_sheet,
    assert_sco_fulfillment_allowed,
    assert_sco_kit_fully_issued,
    compute_charge_sheet,
    compute_cost_per_unit,
    previously_approved,
    sco_kit_is_fully_issued,
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


def test_fulfillment_requires_approval_to_issue():
    assert not previously_approved(SimpleNamespace(amendment_number=0, revision_number=0))
    draft = SimpleNamespace(approval_status="DRAFT", amendment_number=0, status="PLANNED")
    with pytest.raises(HTTPException) as blocked:
        assert_sco_fulfillment_allowed(draft, "issuing materials")
    assert blocked.value.status_code == 400
    assert blocked.value.detail == SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL
    amending = SimpleNamespace(approval_status="DRAFT", amendment_number=1, status="PLANNED")
    with pytest.raises(HTTPException) as amending_blocked:
        assert_sco_fulfillment_allowed(amending, "issuing materials")
    assert amending_blocked.value.detail == SCO_MUST_BE_APPROVED_TO_ISSUE_DETAIL
    assert_sco_fulfillment_allowed(
        SimpleNamespace(approval_status="APPROVED", amendment_number=0, status="PLANNED"),
        "issuing materials",
    )
    with pytest.raises(HTTPException) as closed:
        assert_sco_fulfillment_allowed(
            SimpleNamespace(approval_status="APPROVED", status="COMPLETED"),
            "issuing materials",
        )
    assert closed.value.status_code == 400


def test_empty_kit_is_not_fully_issued():
    open_kit = SimpleNamespace(
        components=[
            SimpleNamespace(quantity_required=Decimal("10"), quantity_issued=Decimal("4")),
            SimpleNamespace(quantity_required=Decimal("2"), quantity_issued=Decimal("2")),
        ]
    )
    assert sco_kit_is_fully_issued(open_kit) is False
    with pytest.raises(HTTPException) as blocked:
        assert_sco_kit_fully_issued(open_kit)
    assert blocked.value.status_code == 400
    assert blocked.value.detail == SCO_KIT_MUST_BE_ISSUED_DETAIL

    complete = SimpleNamespace(
        components=[
            SimpleNamespace(quantity_required=Decimal("10"), quantity_issued=Decimal("10")),
            SimpleNamespace(quantity_required=Decimal("2"), quantity_issued=Decimal("3")),
        ]
    )
    assert sco_kit_is_fully_issued(complete)
    assert_sco_kit_fully_issued(complete)
    assert sco_kit_is_fully_issued(SimpleNamespace(components=[])) is False
