# @author: Wendy Yang
# @date: 2026-10-02

"""Period close states: Open, Soft Close, and Hard Close."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.deps.auth import user_is_admin
from app.models import AuditLog, FinancePeriodSettings, User
from app.services.journal_source import SOURCE_MONTH_END_CLOSE, SOURCE_YEAR_END_CLOSE

SETTINGS_ID = UUID("00000000-0000-4000-8000-000000000001")
AUDIT_TABLE = "finance_period_settings"

STATUS_OPEN = "OPEN"
STATUS_SOFT_CLOSE = "SOFT_CLOSE"
STATUS_HARD_CLOSE = "HARD_CLOSE"

KIND_OPERATIONAL = "operational"
KIND_ADJUSTMENT = "adjustment"

ADJUSTMENT_SOURCES = {SOURCE_MONTH_END_CLOSE, SOURCE_YEAR_END_CLOSE}
MIN_REOPEN_JUSTIFICATION = 10


def as_date(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def get_or_create_settings(db: Session) -> FinancePeriodSettings:
    row = db.get(FinancePeriodSettings, SETTINGS_ID)
    if row is not None:
        return row
    row = (
        db.query(FinancePeriodSettings)
        .order_by(FinancePeriodSettings.updated_at.desc().nullslast())
        .first()
    )
    if row is not None:
        return row
    row = FinancePeriodSettings(
        id=SETTINGS_ID,
        current_closing_date=None,
        soft_close_date=None,
        hard_close_date=None,
    )
    db.add(row)
    db.flush()
    return row


def soft_close_date(settings: FinancePeriodSettings) -> date | None:
    return as_date(getattr(settings, "soft_close_date", None))


def hard_close_date(settings: FinancePeriodSettings) -> date | None:
    return as_date(
        getattr(settings, "hard_close_date", None)
        or getattr(settings, "current_closing_date", None)
    )


def get_current_closing_date(db: Session) -> date | None:
    return hard_close_date(get_or_create_settings(db))


def status_for_date(
    txn_date: date | datetime | None,
    settings: FinancePeriodSettings,
) -> str:
    resolved = as_date(txn_date)
    if resolved is None:
        return STATUS_OPEN
    hard = hard_close_date(settings)
    if hard is not None and resolved <= hard:
        return STATUS_HARD_CLOSE
    soft = soft_close_date(settings)
    if soft is not None and resolved <= soft:
        return STATUS_SOFT_CLOSE
    return STATUS_OPEN


def journal_lock_kind(entry) -> str:
    source = (getattr(entry, "source_document_type", None) or "").upper()
    if source in ADJUSTMENT_SOURCES:
        return KIND_ADJUSTMENT
    if getattr(entry, "is_system_generated", False):
        return KIND_OPERATIONAL
    return KIND_ADJUSTMENT


def period_lock_message(
    db: Session,
    txn_date: date | datetime | None,
    *,
    document: str = "transaction",
    kind: str = KIND_OPERATIONAL,
) -> str | None:
    settings = get_or_create_settings(db)
    state = status_for_date(txn_date, settings)
    resolved = as_date(txn_date)
    if state == STATUS_HARD_CLOSE:
        hard = hard_close_date(settings)
        return (
            f"Period is hard-closed through {hard.isoformat() if hard else resolved}. "
            f"This {document} dated {resolved.isoformat() if resolved else '—'} cannot be "
            "created or modified. An Admin must reopen the period with a justification."
        )
    if state == STATUS_SOFT_CLOSE and kind != KIND_ADJUSTMENT:
        soft = soft_close_date(settings)
        return (
            f"Period is soft-closed through {soft.isoformat() if soft else resolved}. "
            f"Operational {document} dated {resolved.isoformat() if resolved else '—'} "
            "cannot be created or modified. Finance may still post adjusting journals."
        )
    return None


def assert_transaction_date_open(
    db: Session,
    txn_date: date | datetime | None,
    *,
    document: str = "transaction",
    kind: str = KIND_OPERATIONAL,
) -> None:
    message = period_lock_message(db, txn_date, document=document, kind=kind)
    if message:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message)


def assert_dates_open(
    db: Session,
    *txn_dates: date | datetime | None,
    document: str = "transaction",
    kind: str = KIND_OPERATIONAL,
) -> None:
    for txn_date in txn_dates:
        assert_transaction_date_open(db, txn_date, document=document, kind=kind)


def serialize_period_settings(
    settings: FinancePeriodSettings,
    *,
    as_of: date | None = None,
) -> dict:
    as_of = as_of or date.today()
    hard = hard_close_date(settings)
    return {
        "id": settings.id,
        "soft_close_date": soft_close_date(settings),
        "hard_close_date": hard,
        "current_closing_date": hard,
        "as_of_status": status_for_date(as_of, settings),
        "updated_by_user_id": settings.updated_by_user_id,
        "updated_at": settings.updated_at,
    }


def _is_hard_reopen(old_hard: date | None, new_hard: date | None) -> bool:
    if old_hard is None:
        return False
    if new_hard is None:
        return True
    return new_hard < old_hard


def update_period_settings(
    db: Session,
    user: User,
    *,
    soft_close_date_value: date | None | object = ...,
    hard_close_date_value: date | None | object = ...,
    justification: str | None = None,
) -> FinancePeriodSettings:
    settings = get_or_create_settings(db)
    old_soft = soft_close_date(settings)
    old_hard = hard_close_date(settings)
    new_soft = old_soft if soft_close_date_value is ... else as_date(soft_close_date_value)
    new_hard = old_hard if hard_close_date_value is ... else as_date(hard_close_date_value)

    if new_hard is not None and (new_soft is None or new_hard > new_soft):
        new_soft = new_hard
    if new_soft is not None and new_hard is not None and new_soft < new_hard:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Soft close date cannot be earlier than the hard close date.",
        )

    if old_soft == new_soft and old_hard == new_hard:
        return settings

    if _is_hard_reopen(old_hard, new_hard):
        if not user_is_admin(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Hard-closed periods can only be reopened by an Admin, "
                    "and a justification is required."
                ),
            )
        reason = (justification or "").strip()
        if len(reason) < MIN_REOPEN_JUSTIFICATION:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "A justification of at least "
                    f"{MIN_REOPEN_JUSTIFICATION} characters is required to reopen a hard close."
                ),
            )
    else:
        reason = (justification or "").strip() or None

    settings.soft_close_date = new_soft
    settings.hard_close_date = new_hard
    settings.current_closing_date = new_hard
    settings.updated_by_user_id = user.id
    settings.updated_at = datetime.utcnow()
    db.add(
        AuditLog(
            table_name=AUDIT_TABLE,
            record_id=settings.id,
            action="UPDATE",
            old_data={
                "soft_close_date": _iso(old_soft),
                "hard_close_date": _iso(old_hard),
                "current_closing_date": _iso(old_hard),
            },
            new_data={
                "soft_close_date": _iso(new_soft),
                "hard_close_date": _iso(new_hard),
                "current_closing_date": _iso(new_hard),
                "justification": reason,
            },
            user_id=user.id,
        )
    )
    db.flush()
    return settings


def update_current_closing_date(
    db: Session,
    user: User,
    new_date: date | None,
    justification: str | None = None,
) -> FinancePeriodSettings:
    return update_period_settings(
        db,
        user,
        hard_close_date_value=new_date,
        justification=justification,
    )
