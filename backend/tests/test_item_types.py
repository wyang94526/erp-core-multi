from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.item_types import (
    INVENTORY,
    NON_INVENTORY,
    SERVICE,
    is_stock_tracked,
    is_stock_type,
    normalize_item_fields,
    normalize_item_type,
    skip_inventory_movement,
    validate_item_master_fields,
    validate_line_quantity,
)
from app.services.po_totals import apply_line_totals, apply_po_totals


def test_normalize_item_type_aliases():
    assert normalize_item_type(None) == INVENTORY
    assert normalize_item_type("service") == SERVICE
    assert normalize_item_type("non-inventory") == NON_INVENTORY
    assert normalize_item_type("NONSTOCK") == NON_INVENTORY


def test_inventory_uom_defaults_to_each_when_blank():
    kind, uom = normalize_item_fields(item_type=INVENTORY, uom="  ")
    assert kind == INVENTORY
    assert uom == "Each"


def test_service_uom_may_be_blank():
    kind, uom = validate_item_master_fields(item_type=SERVICE, uom="")
    assert kind == SERVICE
    assert uom is None


def test_service_uom_na_is_preserved():
    kind, uom = validate_item_master_fields(item_type=SERVICE, uom="N/A")
    assert kind == SERVICE
    assert uom == "N/A"


def test_stock_movement_bypass_for_service_and_non_inventory():
    freight = SimpleNamespace(item_type=SERVICE)
    misc = SimpleNamespace(item_type=NON_INVENTORY)
    part = SimpleNamespace(item_type=INVENTORY)
    assert skip_inventory_movement(freight)
    assert skip_inventory_movement(misc)
    assert not skip_inventory_movement(part)
    assert is_stock_tracked(part)
    assert not is_stock_tracked(freight)
    assert is_stock_type(INVENTORY)
    assert not is_stock_type(SERVICE)


def test_inventory_line_rejects_zero_quantity():
    with pytest.raises(HTTPException) as err:
        validate_line_quantity(
            sku="PN-1",
            quantity=0,
            amount=0,
            item=SimpleNamespace(item_type=INVENTORY),
        )
    assert err.value.status_code == 400


def test_service_line_allows_zero_quantity_with_amount():
    qty = validate_line_quantity(
        sku="MISC",
        quantity=0,
        amount=Decimal("125.00"),
        item=SimpleNamespace(item_type=SERVICE),
    )
    assert qty == Decimal("0")


def test_service_line_rejects_zero_quantity_and_zero_amount():
    with pytest.raises(HTTPException):
        validate_line_quantity(
            sku="MISC",
            quantity=0,
            amount=0,
            item=SimpleNamespace(item_type=SERVICE),
        )


def test_amount_only_po_line_uses_line_subtotal_not_qty_times_price():
    line = SimpleNamespace(
        quantity=Decimal("0"),
        unit_price=Decimal("0"),
        tax_rate=Decimal("0"),
        line_subtotal=Decimal("85.50"),
        line_tax=Decimal("0"),
        line_total=Decimal("0"),
    )
    apply_line_totals(line)
    assert line.line_subtotal == Decimal("85.50")
    assert line.line_total == Decimal("85.50")


def test_amount_only_po_line_falls_back_to_unit_price_as_amount():
    line = SimpleNamespace(
        quantity=Decimal("0"),
        unit_price=Decimal("40.00"),
        tax_rate=Decimal("0"),
        line_subtotal=Decimal("0"),
        line_tax=Decimal("0"),
        line_total=Decimal("0"),
    )
    apply_line_totals(line)
    assert line.line_subtotal == Decimal("40.00")


def test_mixed_po_totals_include_amount_only_service_line():
    po = SimpleNamespace(
        items=[
            SimpleNamespace(
                quantity=Decimal("2"),
                unit_price=Decimal("10"),
                tax_rate=Decimal("0"),
                line_subtotal=Decimal("0"),
                line_tax=Decimal("0"),
                line_total=Decimal("0"),
            ),
            SimpleNamespace(
                quantity=Decimal("0"),
                unit_price=Decimal("0"),
                tax_rate=Decimal("0"),
                line_subtotal=Decimal("15.00"),
                line_tax=Decimal("0"),
                line_total=Decimal("0"),
            ),
        ],
        shipping_fee=Decimal("0"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms="PREPAID_ON_PO",
    )
    apply_po_totals(po)
    assert po.subtotal == Decimal("35.00")
    assert po.grand_total == Decimal("35.00")
