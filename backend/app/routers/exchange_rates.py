# @author: Wendy Yang
# @date: 2026-10-11

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.deps.company import get_current_company
from app.models import Company, ExchangeRate, User
from app.schemas import ExchangeRateCreate, ExchangeRateRead, ExchangeRateRefresh
from app.services.exchange_rates import frankfurter_rates, upsert_rate

router = APIRouter(prefix="/exchange-rates", tags=["exchange-rates"])


@router.get("", response_model=list[ExchangeRateRead])
def list_rates(
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
) -> list[ExchangeRate]:
    return (
        db.query(ExchangeRate)
        .filter(ExchangeRate.company_id == company.id)
        .order_by(ExchangeRate.effective_date.desc(), ExchangeRate.quote_currency)
        .all()
    )


@router.post("", response_model=ExchangeRateRead, status_code=201)
def create_rate(
    payload: ExchangeRateCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("admin:manage")),
) -> ExchangeRate:
    row = upsert_rate(
        db,
        company,
        payload.quote_currency,
        payload.rate_to_base,
        payload.effective_date,
        "manual",
    )
    db.commit()
    db.refresh(row)
    return row


@router.post("/refresh", response_model=list[ExchangeRateRead])
def refresh_rates(
    payload: ExchangeRateRefresh,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("admin:manage")),
) -> list[ExchangeRate]:
    fetched = frankfurter_rates(company.base_currency, payload.effective_date)
    rows: list[ExchangeRate] = []
    for quote, rate in fetched.items():
        rows.append(
            upsert_rate(db, company, quote, rate, payload.effective_date, "frankfurter")
        )
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows
