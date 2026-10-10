# @author: Wendy Yang
# @date: 2026-10-02

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user, require_permission
from app.models import User
from app.schemas import CompanyNameRead, CompanyProfileRead, CompanyProfileUpdate
from app.services import company_profile as profile_service

router = APIRouter(prefix="/company-profile", tags=["company-profile"])


@router.get("/public", response_model=CompanyNameRead)
def get_public_company_name(db: Session = Depends(get_db)):
    """Company name for the shell and sign-in screens. No contact or address data."""
    row = profile_service.get_or_create_profile(db)
    db.commit()
    return CompanyNameRead(company_name=row.company_name)


@router.get("", response_model=CompanyProfileRead)
def get_company_profile(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = profile_service.get_or_create_profile(db)
    db.commit()
    return profile_service.serialize_profile(row)


@router.patch("", response_model=CompanyProfileRead)
def update_company_profile(
    payload: CompanyProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:manage")),
):
    row = profile_service.update_profile(db, user, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(row)
    return profile_service.serialize_profile(row)


@router.get("/logo")
def get_company_logo(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = profile_service.get_or_create_profile(db)
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
):
    row = await profile_service.save_logo(db, user, file)
    db.commit()
    db.refresh(row)
    return profile_service.serialize_profile(row)


@router.delete("/logo", response_model=CompanyProfileRead)
def delete_company_logo(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("admin:manage")),
):
    row = profile_service.delete_logo(db, user)
    db.commit()
    db.refresh(row)
    return profile_service.serialize_profile(row)
