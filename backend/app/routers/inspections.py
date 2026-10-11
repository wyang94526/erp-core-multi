# @author: Wendy Yang
# @date: 2026-10-11

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps.auth import require_permission
from app.deps.company import get_current_company
from app.models import Company, Inspection, User
from app.schemas import InspectionCreate, InspectionDecision, InspectionDocumentOption, InspectionRead
from app.services import inspections as inspection_service

router = APIRouter(prefix="/inspections", tags=["inspections"])


@router.get("", response_model=list[InspectionRead])
def list_inspections(
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> list[Inspection]:
    return (
        db.query(Inspection)
        .options(joinedload(Inspection.results))
        .filter(Inspection.company_id == company.id)
        .order_by(Inspection.created_at.desc())
        .all()
    )


@router.get("/documents", response_model=list[InspectionDocumentOption])
def list_source_documents(
    source_type: str = Query(...),
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> list[dict]:
    return inspection_service.list_source_documents(db, company, source_type)


@router.post("", response_model=InspectionRead, status_code=201)
def open_inspection(
    payload: InspectionCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    return inspection_service.open_inspection(db, company, payload)


@router.get("/{inspection_id}", response_model=InspectionRead)
def get_inspection(
    inspection_id: UUID,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    return inspection_service._load(db, company, inspection_id)


@router.post("/{inspection_id}/accept", response_model=InspectionRead)
def accept_inspection(
    inspection_id: UUID,
    payload: InspectionDecision,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    return inspection_service.decide(
        db, company, inspection_id, "accepted", user, payload.results, payload.notes
    )


@router.post("/{inspection_id}/reject", response_model=InspectionRead)
def reject_inspection(
    inspection_id: UUID,
    payload: InspectionDecision,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    return inspection_service.decide(
        db, company, inspection_id, "rejected", user, payload.results, payload.notes
    )
