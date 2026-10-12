# @author: Wendy Yang
# @date: 2026-10-12

"""Closed-loop rules for an inspection lot."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

QC_INSPECTOR_ROLES = frozenset({"ROLE-QC-INSP", "ROLE-QC-MGR"})
QC_MANAGER_ROLES = frozenset({"ROLE-QC-MGR"})
PLANT_LEADERSHIP_ROLE = "ROLE-MANAGER"
FINAL_INSPECTION_STATUSES = frozenset({"accepted", "rejected"})
TERMINAL_DISPOSITIONS = frozenset({"scrap", "rework"})
LEGACY_STOCK_OVERRIDE = "Legacy_Stock_Override"
EMERGENCY_OVERRIDE = "Emergency_Override"
MIN_OVERRIDE_JUSTIFICATION = 20


def receipt_is_closed(statuses: list[str]) -> bool:
    """A finalized lot cannot be opened again without an approved re-inspection."""
    return any(status in FINAL_INSPECTION_STATUSES for status in statuses)


def counts_as_available(stock_class: str | None) -> bool:
    """Quarantine, scrap, and rework stay on the books and out of usable stock."""
    return (stock_class or "unrestricted") == "unrestricted"


def disposition_is_terminal(disposition: str | None) -> bool:
    """Scrap and rework cannot return to unrestricted stock through a normal accept."""
    return (disposition or "") in TERMINAL_DISPOSITIONS


def legacy_stock_mismatch(inspection_status: str | None, stock_disposition: str | None) -> bool:
    """A pre-rule rejection left the quantity in unrestricted stock."""
    return inspection_status == "rejected" and stock_disposition == "unrestricted"


def override_block_reason(role_ids: set[str], justification: str | None) -> str | None:
    """An emergency bypass is an administrator action and must be justified."""
    if "ROLE-ADMIN" not in role_ids:
        return "Emergency override is limited to an administrator."
    if len((justification or "").strip()) < MIN_OVERRIDE_JUSTIFICATION:
        return f"Emergency override requires a justification of at least {MIN_OVERRIDE_JUSTIFICATION} characters."
    return None


def signoff_block_reason(role_ids: set[str], user_id, received_by) -> str | None:
    """Quality sign-off is a different role from the person who received the lot."""
    if not QC_INSPECTOR_ROLES.intersection(role_ids):
        return "Accept and Reject are limited to a Quality Inspector or Quality Manager."
    if received_by is not None and str(user_id) == str(received_by):
        return "The person who received this lot cannot sign off the inspection."
    return None


def reopen_block_reason(role_ids: set[str], approver_id, requester_id) -> str | None:
    if not QC_MANAGER_ROLES.intersection(role_ids):
        return "A Quality Manager must approve a re-inspection."
    if str(approver_id) == str(requester_id):
        return "The person who requested the re-inspection cannot approve it."
    return None


def measurement_passed(
    method: str,
    measured: str | None,
    min_value,
    max_value,
    pass_options: str | None,
) -> bool:
    """Numeric results must fall inside the plan limits. Attributes must be a passing value."""
    text = (measured or "").strip()
    if not text:
        raise ValueError("Enter a measured value")
    if method == "numeric":
        try:
            value = Decimal(text)
        except InvalidOperation as exc:
            raise ValueError("Measured value must be a number") from exc
        if min_value is not None and value < Decimal(str(min_value)):
            return False
        if max_value is not None and value > Decimal(str(max_value)):
            return False
        return True
    allowed = {part.strip() for part in (pass_options or "Pass").split(",") if part.strip()}
    return text in allowed


def plan_specification(method: str, min_value, max_value, unit: str | None, options: str | None) -> str:
    suffix = f" {unit}" if unit else ""
    if method == "numeric":
        low = "—" if min_value is None else str(min_value)
        high = "—" if max_value is None else str(max_value)
        return f"{low} to {high}{suffix}".strip()
    return options or "Pass / Fail"
