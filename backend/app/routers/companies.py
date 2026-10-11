# @author: Wendy Yang
# @date: 2026-10-11

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import nulls_first
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps.auth import get_current_user, require_permission
from app.deps.company import get_current_company
from app.models import Company, User, UserCompany
from app.schemas import CompanyCreate, CompanyMembershipRead, CompanyRead, CompanyUpdate
from app.services.companies import assign_parent, ensure_user_membership
from app.services.exchange_rates import normalize_currency

router = APIRouter(prefix="/companies", tags=["companies"])


def _memberships(db: Session, user: User) -> list[UserCompany]:
    return (
        db.query(UserCompany)
        .options(joinedload(UserCompany.company))
        .filter(UserCompany.user_id == user.id)
        .all()
    )


@router.get("/mine", response_model=list[CompanyMembershipRead])
def list_my_companies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[UserCompany]:
    rows = _memberships(db, user)
    if rows:
        return rows
    ensure_user_membership(db, user)
    db.commit()
    return _memberships(db, user)


@router.get("/current", response_model=CompanyRead)
def current_company(company: Company = Depends(get_current_company)) -> Company:
    return company


@router.get("", response_model=list[CompanyRead])
def list_companies(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> list[Company]:
    return (
        db.query(Company)
        .order_by(nulls_first(Company.parent_company_id), Company.code)
        .all()
    )


@router.post("", response_model=CompanyRead, status_code=201)
def create_company(
    payload: CompanyCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:manage")),
) -> Company:
    code = payload.code.strip().upper()
    if db.query(Company).filter(Company.code == code).first():
        raise HTTPException(status_code=400, detail="Company code already exists")
    country = (payload.country or "").strip() or None
    company = Company(
        code=code,
        name=payload.name.strip(),
        country=country,
        base_currency=normalize_currency(payload.base_currency),
        is_active=True,
    )
    assign_parent(db, company, payload.parent_company_id)
    db.add(company)
    db.flush()
    from app.services.document_prefixes import ensure_document_prefixes

    ensure_document_prefixes(db, company)
    already = (
        db.query(UserCompany)
        .filter(UserCompany.user_id == user.id, UserCompany.company_id == company.id)
        .first()
    )
    if already is None:
        db.add(UserCompany(user_id=user.id, company_id=company.id, is_default=False))
    db.commit()
    db.refresh(company)
    return company


@router.patch("/{company_id}", response_model=CompanyRead)
def update_company(
    company_id: UUID,
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> Company:
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        company.name = changes["name"].strip()
    if "country" in changes:
        company.country = (changes["country"] or "").strip() or None
    if "base_currency" in changes and changes["base_currency"] is not None:
        company.base_currency = normalize_currency(changes["base_currency"])
    if "parent_company_id" in changes:
        assign_parent(db, company, changes["parent_company_id"])
    db.commit()
    db.refresh(company)
    return company
