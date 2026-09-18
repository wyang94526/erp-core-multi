# @author: Wendy Yang
# @date: 2026-09-19

from datetime import date

from app.services.payment_terms import (
    canonical_code,
    compute_due_date,
    due_days_from_string,
    normalize_term_key,
)


def test_aliases_map_legacy_vendor_and_tiptop_codes():
    assert canonical_code("Net 30") == "NET30"
    assert canonical_code("NET30") == "NET30"
    assert canonical_code("T010") == "NET30"
    assert canonical_code("Due on Receipt") == "DUE_ON_RECEIPT"
    assert canonical_code("T000") == "DUE_ON_RECEIPT"
    assert canonical_code("P02") == "P02"
    assert canonical_code("P10") == "P10"
    assert canonical_code("ADVANCE") == "ADVANCE"


def test_due_date_is_invoice_date_plus_due_days():
    issue = date(2026, 9, 1)
    assert compute_due_date(issue, 30) == date(2026, 10, 1)
    assert compute_due_date(issue, 0) == issue
    assert compute_due_date(issue, 32) == date(2026, 10, 3)


def test_string_due_days_extracts_digits():
    assert due_days_from_string("Net 45") == 45
    assert due_days_from_string("P02") == 2
    assert due_days_from_string(None) == 30
    assert normalize_term_key("Net 30") == "NET30"
