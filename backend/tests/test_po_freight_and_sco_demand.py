# @author: Wendy Yang
# @date: 2026-09-19

from decimal import Decimal
from types import SimpleNamespace

from app.services.po_sco_demand import _positive_cost, over_import_message, requested_qty_by_sco_component
from app.services.po_totals import (
    FREIGHT_PREPAID,
    FREIGHT_ROUTING,
    FREIGHT_THIRD_PARTY,
    apply_po_totals,
    invoice_freight_default,
    remaining_to_buy,
    requires_carrier_account,
    vendor_freight,
)


def _line(**kwargs):
    defaults = {
        "quantity": Decimal("2"),
        "unit_price": Decimal("10"),
        "tax_rate": Decimal("5"),
        "line_subtotal": Decimal("0"),
        "line_tax": Decimal("0"),
        "line_total": Decimal("0"),
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_prepaid_freight_is_in_grand_total():
    po = SimpleNamespace(
        items=[_line()],
        shipping_fee=Decimal("15.00"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms=FREIGHT_PREPAID,
    )
    apply_po_totals(po)
    assert po.subtotal == Decimal("20.00")
    assert po.total_tax == Decimal("1.00")
    assert po.grand_total == Decimal("36.00")
    assert invoice_freight_default(po.shipping_fee, po.freight_terms) == Decimal("15.00")


def test_third_party_freight_excluded_from_vendor_total():
    po = SimpleNamespace(
        items=[_line()],
        shipping_fee=Decimal("15.00"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms=FREIGHT_THIRD_PARTY,
    )
    apply_po_totals(po)
    assert po.shipping_fee == Decimal("15.00")
    assert po.grand_total == Decimal("21.00")
    assert vendor_freight(po.shipping_fee, po.freight_terms) == Decimal("0.00")
    assert invoice_freight_default(po.shipping_fee, po.freight_terms) == Decimal("0.00")


def test_routing_account_also_excludes_freight():
    assert vendor_freight(Decimal("9.50"), FREIGHT_ROUTING) == Decimal("0.00")
    assert requires_carrier_account(FREIGHT_ROUTING)
    assert requires_carrier_account(FREIGHT_THIRD_PARTY)
    assert not requires_carrier_account(FREIGHT_PREPAID)


def test_remaining_to_buy_floors_at_zero_and_counts_prior_pos():
    assert remaining_to_buy(Decimal("10"), Decimal("4")) == Decimal("6.0000")
    assert remaining_to_buy(Decimal("10"), Decimal("10")) == Decimal("0.0000")
    assert remaining_to_buy(Decimal("10"), Decimal("12")) == Decimal("0.0000")


def test_requested_qty_groups_imported_component_lines():
    requested = requested_qty_by_sco_component(
        [
            {"sco_component_id": 11, "quantity": Decimal("2")},
            {"sco_component_id": 11, "quantity": Decimal("3")},
            {"sco_component_id": None, "quantity": Decimal("9")},
        ]
    )
    assert requested[11] == Decimal("5")
    assert over_import_message(requested, {11: Decimal("5")}) is None
    assert over_import_message(requested, {11: Decimal("4")}) == (
        "Imported quantity cannot exceed remaining subcontract component demand"
    )


def test_percentage_discount_applies_to_goods_subtotal_not_freight():
    po = SimpleNamespace(
        items=[_line()],
        shipping_fee=Decimal("15.00"),
        discount_type="percentage",
        discount_value=Decimal("10"),
        freight_terms=FREIGHT_PREPAID,
    )
    apply_po_totals(po)
    assert po.discount_amount == Decimal("2.00")
    assert po.grand_total == Decimal("34.00")


def test_positive_cost_rejects_blank_and_zero():
    assert _positive_cost(None) is None
    assert _positive_cost(0) is None
    assert _positive_cost("0.00") is None
    assert _positive_cost("12.5000") == Decimal("12.5000")
    assert _positive_cost(44.72) == Decimal("44.72")


def test_landed_unit_cost_allocates_header_freight_by_line_value():
    cheap = _line(quantity=Decimal("10"), unit_price=Decimal("10"), tax_rate=Decimal("0"))
    dear = _line(quantity=Decimal("10"), unit_price=Decimal("30"), tax_rate=Decimal("0"))
    po = SimpleNamespace(
        items=[cheap, dear],
        shipping_fee=Decimal("40.00"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms=FREIGHT_THIRD_PARTY,
    )
    apply_po_totals(po)
    assert cheap.unit_price == Decimal("10")
    assert dear.unit_price == Decimal("30")
    assert cheap.estimated_landed_unit_cost == Decimal("11.0000")
    assert dear.estimated_landed_unit_cost == Decimal("33.0000")
    assert po.grand_total == Decimal("400.00")


def test_landed_unit_cost_spreads_expense_lines_onto_inventory():
    goods = _line(quantity=Decimal("5"), unit_price=Decimal("8"), sku="PART-A", tax_rate=Decimal("0"))
    freight = _line(
        quantity=Decimal("0"),
        unit_price=Decimal("25"),
        line_subtotal=Decimal("25"),
        sku="FREIGHT",
        tax_rate=Decimal("0"),
    )
    po = SimpleNamespace(
        items=[goods, freight],
        shipping_fee=Decimal("15.00"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms=FREIGHT_PREPAID,
    )
    apply_po_totals(po)
    assert goods.unit_price == Decimal("8")
    assert goods.estimated_landed_unit_cost == Decimal("16.0000")
    assert freight.estimated_landed_unit_cost == Decimal("25.0000")


def test_zero_quantity_landed_cost_falls_back_to_unit_price():
    line = _line(quantity=Decimal("0"), unit_price=Decimal("85.50"), line_subtotal=Decimal("85.50"), sku="MISC")
    po = SimpleNamespace(
        items=[line],
        shipping_fee=Decimal("10.00"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms=FREIGHT_PREPAID,
    )
    apply_po_totals(po)
    assert line.estimated_landed_unit_cost == Decimal("85.5000")


def test_missing_unit_price_and_zero_qty_landed_cost_is_zero():
    line = _line(quantity=Decimal("0"), unit_price=Decimal("0"), line_subtotal=Decimal("0"), sku="MISC")
    po = SimpleNamespace(
        items=[line],
        shipping_fee=Decimal("0"),
        discount_type="percentage",
        discount_value=Decimal("0"),
        freight_terms=FREIGHT_PREPAID,
    )
    apply_po_totals(po)
    assert line.estimated_landed_unit_cost == Decimal("0.00")
