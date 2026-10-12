# @author: Wendy Yang
# @date: 2026-10-11

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.deps.company import get_current_company
from app.models import Company, Inspection, User
from app.schemas import (
    DispositionRequest,
    EmergencyOverride,
    InspectionCreate,
    InspectionDecision,
    InspectionDocumentOption,
    InspectionPlanCreate,
    InspectionPlanRead,
    InspectionRead,
    InspectionStatusUpdate,
    QualityAlertRead,
    ReinspectionDecision,
    ReinspectionRequestCreate,
    ReinspectionRequestRead,
)
from app.services import inspections as inspection_service

router = APIRouter(prefix="/inspections", tags=["inspections"])


@router.get("", response_model=list[InspectionRead])
def list_inspections(
    status: str | None = None,
    source: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> list[Inspection]:
    return inspection_service.list_inspections(db, company, status=status, source=source, q=q)


@router.get("/documents", response_model=list[InspectionDocumentOption])
def list_source_documents(
    source_type: str = Query(...),
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> list[dict]:
    return inspection_service.list_source_documents(db, company, source_type)


@router.get("/plans", response_model=list[InspectionPlanRead])
def list_plans(
    item_id: str = Query(...),
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> list:
    return inspection_service.list_plans(db, company, item_id)


@router.post("/plans", response_model=InspectionPlanRead, status_code=201)
def add_plan(
    payload: InspectionPlanCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> object:
    return inspection_service.add_plan(db, company, user, payload)


@router.post("/reinspection-requests/{request_id}/decision", response_model=ReinspectionRequestRead)
def decide_reinspection(
    request_id: UUID,
    payload: ReinspectionDecision,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> object:
    return inspection_service.decide_reinspection(db, company, user, request_id, payload.approved)


@router.get("/alerts", response_model=list[QualityAlertRead])
def list_alerts(
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("inspection:view")),
) -> list:
    return inspection_service.list_quality_alerts(db, company)


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


@router.post("/{inspection_id}/disposition", response_model=InspectionRead)
def dispose_quarantine(
    inspection_id: UUID,
    payload: DispositionRequest,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    return inspection_service.dispose_quarantine(db, company, user, inspection_id, payload.disposition)


@router.post("/{inspection_id}/emergency-override", response_model=InspectionRead)
def emergency_override(
    inspection_id: UUID,
    payload: EmergencyOverride,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    return inspection_service.emergency_override(db, company, user, inspection_id, payload)


@router.post("/{inspection_id}/reinspection-requests", response_model=ReinspectionRequestRead, status_code=201)
def request_reinspection(
    inspection_id: UUID,
    payload: ReinspectionRequestCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> object:
    return inspection_service.request_reinspection(db, company, user, inspection_id, payload.reason)


@router.patch("/{inspection_id}/status", response_model=InspectionRead)
def update_inspection_status(
    inspection_id: UUID,
    payload: InspectionStatusUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("inspection:view")),
) -> Inspection:
    decision = inspection_service.canonical_inspection_status(payload.status)
    if decision == "pending":
        raise HTTPException(status_code=400, detail="Inspection status must be Accepted or Rejected")
    return inspection_service.decide(db, company, inspection_id, decision, user, [], payload.notes)


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
