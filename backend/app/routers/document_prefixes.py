# @author: Wendy Yang
# @date: 2026-10-11

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.deps.company import get_current_company
from app.models import Company, User
from app.schemas import DocumentPrefixRead, DocumentPrefixUpdate
from app.services import document_prefixes as prefix_service

router = APIRouter(prefix="/document-prefixes", tags=["document-prefixes"])


@router.get("", response_model=list[DocumentPrefixRead])
def list_prefixes(
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("admin:manage")),
) -> list[dict]:
    rows = prefix_service.list_document_prefixes(db, company)
    db.commit()
    return rows


@router.put("", response_model=list[DocumentPrefixRead])
def update_prefixes(
    payload: DocumentPrefixUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("admin:manage")),
) -> list[dict]:
    rows = prefix_service.update_document_prefixes(db, company, payload.prefixes)
    db.commit()
    return rows
