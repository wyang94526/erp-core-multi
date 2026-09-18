# @author: Wendy Yang
# @date: 2026-09-19

from app.services.finance import cash_type_label, instrument_display_number, mask_account_number


def test_mask_account_number():
    assert mask_account_number("0000008420") == "...8420"
    assert mask_account_number("420") == "...420"


def test_instrument_display_number():
    assert instrument_display_number("CHK-1042") == "1042"
    assert instrument_display_number("ACH-99102") == "99102"
    assert instrument_display_number("#880192") == "880192"
    assert instrument_display_number("WIRE-FED-99381") == "FED-99381"


def test_cash_type_label_includes_instrument_ref():
    assert (
        cash_type_label(txn_type="Check Issue", payment_method="CHECK", instrument_ref_no="CHK-1042")
        == "Check - Ref #1042"
    )
    assert (
        cash_type_label(txn_type="Check Deposit", payment_method="ACH", instrument_ref_no="ACH-99381")
        == "ACH - Ref #99381"
    )
    assert (
        cash_type_label(txn_type="Check Issue", payment_method="WIRE", instrument_ref_no="WIRE-880192")
        == "Wire - Ref #880192"
    )
    assert (
        cash_type_label(txn_type="Check Issue", payment_method="CARD", instrument_ref_no="CC-4412")
        == "Credit Card - Ref #4412"
    )
