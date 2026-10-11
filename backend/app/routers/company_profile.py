# @author: Wendy Yang
# @date: 2026-10-02

from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user, require_permission
from app.deps.company import get_current_company
from app.models import Company, User
from app.schemas import CompanyNameRead, CompanyProfileRead, CompanyProfileUpdate
from app.services import company_profile as profile_service

router = APIRouter(prefix="/company-profile", tags=["company-profile"])


def _letterhead_company(db: Session, company_id: str | None) -> Company:
    if company_id:
        try:
            parsed = UUID(company_id)
        except ValueError:
            parsed = None
        if parsed is not None:
            company = db.get(Company, parsed)
            if company is not None and company.is_active:
                return company
    parent = (
        db.query(Company)
        .filter(Company.is_active.is_(True), Company.parent_company_id.is_(None))
        .order_by(Company.code)
        .first()
    )
    if parent is not None:
        return parent
    company = db.query(Company).filter(Company.is_active.is_(True)).order_by(Company.code).first()
    if company is None:
        raise HTTPException(status_code=404, detail="No company is set up")
    return company


@router.get("/public", response_model=CompanyNameRead)
def get_public_company_name(
    db: Session = Depends(get_db),
    x_company_id: str | None = Header(default=None),
):
    """Letterhead name, country, and base currency for the active company."""
    company = _letterhead_company(db, x_company_id)
    row = profile_service.get_or_create_profile(db, company)
    db.commit()
    identity = profile_service.letterhead_for_company(company)
    return CompanyNameRead(
        company_name=identity["company_name"] or row.company_name,
        country=identity["country"],
        base_currency=identity["base_currency"],
    )


@router.get("", response_model=CompanyProfileRead)
def get_company_profile(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    row = profile_service.get_or_create_profile(db, company)
    db.commit()
    return profile_service.serialize_profile(row, company)


@router.patch("", response_model=CompanyProfileRead)
def update_company_profile(
    payload: CompanyProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:manage")),
    company: Company = Depends(get_current_company),
):
    row = profile_service.update_profile(db, user, company, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(row)
    return profile_service.serialize_profile(row, company)


@router.get("/logo")
def get_company_logo(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    row = profile_service.get_or_create_profile(db, company)
    path = profile_service.logo_path(row)
    if path is None:
        raise HTTPException(status_code=404, detail="No company logo uploaded")
    return FileResponse(
        path,
        media_type=row.logo_content_type or "application/octet-stream",
        filename=row.logo_original_filename or path.name,
        content_disposition_type="inline",
    )


@router.post("/logo", response_model=CompanyProfileRead, status_code=status.HTTP_200_OK)
async def upload_company_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:manage")),
    company: Company = Depends(get_current_company),
):
    row = await profile_service.save_logo(db, user, company, file)
    db.commit()
    db.refresh(row)
    return profile_service.serialize_profile(row, company)


@router.delete("/logo", response_model=CompanyProfileRead)
def delete_company_logo(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:manage")),
    company: Company = Depends(get_current_company),
):
    row = profile_service.delete_logo(db, user, company)
    db.commit()
    db.refresh(row)
    return profile_service.serialize_profile(row, company)
