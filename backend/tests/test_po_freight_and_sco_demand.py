from decimal import Decimal
from types import SimpleNamespace

from app.services.po_sco_demand import _positive_cost
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
