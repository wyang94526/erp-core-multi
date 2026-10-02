# @author: Wendy Yang
# @date: 2026-10-02

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.models import User
from app.schemas import FinancePeriodSettingsRead, FinancePeriodSettingsUpdate
from app.services import period_close

router = APIRouter(prefix="/finance-settings", tags=["finance-settings"])


@router.get("", response_model=FinancePeriodSettingsRead)
def get_finance_settings(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
):
    return period_close.serialize_period_settings(period_close.get_or_create_settings(db))


@router.patch("", response_model=FinancePeriodSettingsRead)
def update_finance_settings(
    payload: FinancePeriodSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("period:manage")),
):
    data = payload.model_dump(exclude_unset=True)
    if "hard_close_date" in data:
        hard = data["hard_close_date"]
    elif "current_closing_date" in data:
        hard = data["current_closing_date"]
    else:
        hard = ...
    settings = period_close.update_period_settings(
        db,
        user,
        soft_close_date_value=data["soft_close_date"] if "soft_close_date" in data else ...,
        hard_close_date_value=hard,
        justification=data.get("justification"),
    )
    db.commit()
    db.refresh(settings)
    return period_close.serialize_period_settings(settings)
