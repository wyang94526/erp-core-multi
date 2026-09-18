# @author: Wendy Yang
# @date: 2026-09-19

from datetime import date

from app.services.finance import ar_display_status


def test_ar_display_status():
    today = date(2026, 9, 14)
    assert ar_display_status(status="Paid", due_date=date(2026, 1, 1), today=today) == "Paid"
    assert ar_display_status(status="Partial", due_date=date(2026, 1, 1), today=today) == "Partial"
    assert ar_display_status(status="Unpaid", due_date=date(2026, 9, 1), today=today) == "Overdue"
    assert ar_display_status(status="Unpaid", due_date=date(2026, 12, 1), today=today) == "Open"
