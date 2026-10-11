# @author: Wendy Yang
# @date: 2026-10-11

"""Resolve the company selected for this request."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user
from app.models import Company, User, UserCompany


def resolve_membership_company_id(
    memberships: list[tuple[UUID, bool]],
    requested: UUID | None,
) -> UUID:
    """Pick the requested company, otherwise the user's default membership."""
    if not memberships:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No company is assigned to this user",
        )
    allowed = {company_id for company_id, _is_default in memberships}
    if requested is not None:
        if requested not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of that company",
            )
        return requested
    for company_id, is_default in memberships:
        if is_default:
            return company_id
    return memberships[0][0]


def require_company_row(row, company: Company, detail: str = "Record not found"):
    if row is None or getattr(row, "company_id", None) != company.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return row


def get_current_company(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> Company:
    requested: UUID | None = None
    if x_company_id and x_company_id.strip():
        try:
            requested = UUID(x_company_id.strip())
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid X-Company-Id header",
            ) from exc

    rows = (
        db.query(UserCompany)
        .filter(UserCompany.user_id == user.id)
        .all()
    )
    company_id = resolve_membership_company_id(
        [(row.company_id, bool(row.is_default)) for row in rows],
        requested,
    )
    company = db.get(Company, company_id)
    if company is None or not company.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company
