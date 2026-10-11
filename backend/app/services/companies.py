# @author: Wendy Yang
# @date: 2026-10-11

"""Company membership and parent-company assignment."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.company_ids import DEFAULT_COMPANY_ID
from app.models import Company, User, UserCompany

_COUNTRY_ALIASES = {
    "us": "united states",
    "usa": "united states",
    "united states of america": "united states",
    "tw": "taiwan",
    "jp": "japan",
    "cn": "china",
    "prc": "china",
    "vn": "vietnam",
}


def canonical_country(value: str | None) -> str:
    cleaned = " ".join((value or "").strip().casefold().split())
    return _COUNTRY_ALIASES.get(cleaned, cleaned)


def pick_company_for_country(companies: list[Company], country: str) -> Company | None:
    """Return the local company for a country.

    A subsidiary wins over a parent when both use the same country. Taiwan maps
    to GTT because that is the only Taiwan company.
    """
    wanted = canonical_country(country)
    if not wanted:
        return None
    matches = [
        company
        for company in companies
        if company.is_active and canonical_country(company.country) == wanted
    ]
    subsidiaries = [company for company in matches if company.parent_company_id is not None]
    if len(subsidiaries) == 1:
        return subsidiaries[0]
    if len(subsidiaries) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"More than one company is set up for {country.strip()}",
        )
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"More than one company is set up for {country.strip()}",
        )
    return None


def company_for_country(db: Session, country: str) -> Company | None:
    companies = db.query(Company).filter(Company.is_active.is_(True)).all()
    return pick_company_for_country(companies, country)


def registration_countries(db: Session) -> list[dict[str, str]]:
    companies = (
        db.query(Company)
        .filter(Company.is_active.is_(True), Company.country.isnot(None))
        .all()
    )
    chosen: dict[str, Company] = {}
    for company in companies:
        key = canonical_country(company.country)
        if not key:
            continue
        current = chosen.get(key)
        if current is None or (company.parent_company_id is not None and current.parent_company_id is None):
            chosen[key] = company
    rows = [
        {
            "country": company.country or "",
            "company_code": company.code,
            "company_name": company.name,
        }
        for company in chosen.values()
    ]
    return sorted(rows, key=lambda row: row["country"].casefold())


def assign_local_company(db: Session, user: User) -> UserCompany:
    """Give the user their country's company and make it the default."""
    country = (user.country or "").strip()
    if not country:
        raise HTTPException(status_code=400, detail="Country is required")
    company = company_for_country(db, country)
    if company is None:
        raise HTTPException(
            status_code=400,
            detail=f"No company is set up for {country}",
        )
    rows = (
        db.query(UserCompany)
        .filter(UserCompany.user_id == user.id)
        .all()
    )
    chosen: UserCompany | None = None
    for row in rows:
        row.is_default = row.company_id == company.id
        if row.is_default:
            chosen = row
    if chosen is None:
        chosen = UserCompany(user_id=user.id, company_id=company.id, is_default=True)
        db.add(chosen)
    return chosen


def assign_parent(db: Session, company: Company, parent_id: UUID | None) -> None:
    """Point a company at a parent. The parent is another company the user chose."""
    if parent_id is None:
        company.parent_company_id = None
        return
    if company.id is not None and parent_id == company.id:
        raise HTTPException(status_code=400, detail="A company cannot be its own parent")
    parent = db.get(Company, parent_id)
    if parent is None:
        raise HTTPException(status_code=400, detail="Parent company does not exist")
    seen = {company.id} if company.id is not None else set()
    current: Company | None = parent
    while current is not None:
        if current.id in seen:
            raise HTTPException(status_code=400, detail="That parent would create a cycle")
        seen.add(current.id)
        if current.parent_company_id is None:
            break
        current = db.get(Company, current.parent_company_id)
    company.parent_company_id = parent_id


def ensure_user_membership(db: Session, user: User, company_id: UUID | None = None) -> UserCompany:
    """Give a user the example group when they do not belong to any company yet.

    GTT-US remains the default because it holds the original masters. GTT (Taiwan)
    and the other subsidiaries are available in the company switcher.
    """
    existing = (
        db.query(UserCompany)
        .filter(UserCompany.user_id == user.id)
        .all()
    )
    if existing:
        return next((row for row in existing if row.is_default), existing[0])
    if (user.country or "").strip():
        return assign_local_company(db, user)
    companies = (
        db.query(Company)
        .filter(Company.is_active.is_(True))
        .order_by(Company.code)
        .all()
    )
    if not companies:
        return None  # type: ignore[return-value]
    preferred = company_id or DEFAULT_COMPANY_ID
    if not any(company.id == preferred for company in companies):
        preferred = companies[0].id
    chosen: UserCompany | None = None
    for company in companies:
        membership = UserCompany(
            user_id=user.id,
            company_id=company.id,
            is_default=company.id == preferred,
        )
        db.add(membership)
        if membership.is_default:
            chosen = membership
    return chosen or membership
