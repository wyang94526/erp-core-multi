from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.models import User
from app.schemas import FinancialReportCatalogItem, FinancialReportRead
from app.services import financial_reports

router = APIRouter(prefix="/financial-reports", tags=["financial-reports"])


@router.get("", response_model=list[FinancialReportCatalogItem])
def list_financial_reports(
    _user: User = Depends(require_permission("report:view")),
) -> list[dict]:
    return financial_reports.report_catalog()


@router.get("/{report_type}", response_model=FinancialReportRead)
def get_financial_report(
    report_type: str,
    as_of_date: date | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    period: str | None = Query(default=None, description="YYYY-MM"),
    fiscal_year: int | None = Query(default=None),
    currency: str | None = Query(default="USD"),
    branch: str | None = Query(default="COMPANY"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("report:view")),
) -> dict:
    return financial_reports.get_financial_report(
        db,
        report_type,
        as_of_date=as_of_date,
        date_from=date_from,
        date_to=date_to,
        period=period,
        fiscal_year=fiscal_year,
        currency=currency,
        branch=branch,
    )
