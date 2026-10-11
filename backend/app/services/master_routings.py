# @author: Wendy Yang
# @date: 2026-10-11

"""Master route library. Templates are copied onto a BOM; they do not change the item."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models import (
    BomRoutingOperation,
    Company,
    ItemBOMHeader,
    MasterRouting,
    MasterRoutingOperation,
    StandardOperation,
    WorkCenter,
)
from app.services.bom_versions import WRITABLE_STATUSES


def can_edit_routing(permission_codes: set[str], *, is_admin: bool) -> bool:
    """Shop-floor users may view a routing. Only engineering and planning may change it."""
    return is_admin or "routing:edit" in permission_codes


def freeze_routing_steps(steps, *, routing_code: str | None, version_no: int | None) -> list[dict]:
    """Copy step values so a later library revision cannot change an existing order."""
    frozen: list[dict] = []
    for step in steps:
        frozen.append(
            {
                "sequence": int(step.sequence),
                "name": str(step.name if hasattr(step, "name") else step.operation_name),
                "work_center_id": step.work_center_id,
                "setup_minutes": step.setup_minutes,
                "run_minutes_per_unit": step.run_minutes_per_unit,
                "routing_code": routing_code,
                "routing_version_no": version_no,
            }
        )
    return frozen


def list_operations(db: Session, company: Company) -> list[StandardOperation]:
    return (
        db.query(StandardOperation)
        .filter(StandardOperation.company_id == company.id)
        .order_by(StandardOperation.operation_code)
        .all()
    )


def create_operation(db: Session, company: Company, payload) -> StandardOperation:
    code = payload.operation_code.strip().upper()
    exists = (
        db.query(StandardOperation)
        .filter(StandardOperation.company_id == company.id, StandardOperation.operation_code == code)
        .first()
    )
    if exists is not None:
        raise HTTPException(status_code=400, detail="That operation code already exists")
    _work_center(db, payload.work_center_id)
    row = StandardOperation(
        company_id=company.id,
        operation_code=code,
        name=payload.name.strip(),
        work_center_id=payload.work_center_id or None,
        setup_minutes=payload.setup_minutes,
        run_minutes_per_unit=payload.run_minutes_per_unit,
        description=payload.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_routings(db: Session, company: Company, status: str | None = None) -> list[MasterRouting]:
    query = (
        db.query(MasterRouting)
        .options(selectinload(MasterRouting.operations))
        .filter(MasterRouting.company_id == company.id)
    )
    if status:
        query = query.filter(MasterRouting.status == status)
    return query.order_by(MasterRouting.routing_code, MasterRouting.version_no).all()


def _routing_for_company(db: Session, company: Company, routing_id: int) -> MasterRouting:
    routing = (
        db.query(MasterRouting)
        .options(selectinload(MasterRouting.operations))
        .filter(MasterRouting.id == routing_id, MasterRouting.company_id == company.id)
        .first()
    )
    if routing is None:
        raise HTTPException(status_code=404, detail="Master routing not found")
    return routing


def _work_center(db: Session, work_center_id: str | None) -> None:
    if work_center_id and db.get(WorkCenter, work_center_id) is None:
        raise HTTPException(status_code=400, detail="Work center not found")


def create_routing(db: Session, company: Company, payload) -> MasterRouting:
    code = payload.routing_code.strip().upper()
    taken = (
        db.query(MasterRouting)
        .filter(MasterRouting.company_id == company.id, MasterRouting.routing_code == code)
        .first()
    )
    if taken is not None:
        raise HTTPException(status_code=400, detail="Create a new version of the existing route instead")
    row = MasterRouting(
        company_id=company.id,
        routing_code=code,
        name=payload.name.strip(),
        version_no=1,
        status="draft",
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def add_routing_step(db: Session, company: Company, routing_id: int, payload) -> MasterRoutingOperation:
    routing = _routing_for_company(db, company, routing_id)
    if routing.status == "obsolete":
        raise HTTPException(status_code=400, detail="Create a new version before changing an obsolete route")
    _work_center(db, payload.work_center_id)
    standard = None
    if payload.standard_operation_id is not None:
        standard = db.get(StandardOperation, payload.standard_operation_id)
        if standard is None or standard.company_id != company.id:
            raise HTTPException(status_code=400, detail="Standard operation not found")
    name = (payload.operation_name or (standard.name if standard else "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Operation name is required")
    row = MasterRoutingOperation(
        master_routing_id=routing.id,
        sequence=payload.sequence,
        standard_operation_id=standard.id if standard else None,
        work_center_id=payload.work_center_id or (standard.work_center_id if standard else None),
        operation_name=name,
        setup_minutes=payload.setup_minutes if payload.setup_minutes is not None else (standard.setup_minutes if standard else 0),
        run_minutes_per_unit=payload.run_minutes_per_unit
        if payload.run_minutes_per_unit is not None
        else (standard.run_minutes_per_unit if standard else 0),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def revise_routing(db: Session, company: Company, routing_id: int) -> MasterRouting:
    source = _routing_for_company(db, company, routing_id)
    max_ver = (
        db.query(func.coalesce(func.max(MasterRouting.version_no), 0))
        .filter(MasterRouting.company_id == company.id, MasterRouting.routing_code == source.routing_code)
        .scalar()
    )
    revision = MasterRouting(
        company_id=company.id,
        routing_code=source.routing_code,
        name=source.name,
        version_no=int(max_ver) + 1,
        status="draft",
        notes=source.notes,
    )
    db.add(revision)
    db.flush()
    for step in source.operations:
        db.add(
            MasterRoutingOperation(
                master_routing_id=revision.id,
                sequence=step.sequence,
                standard_operation_id=step.standard_operation_id,
                work_center_id=step.work_center_id,
                operation_name=step.operation_name,
                setup_minutes=step.setup_minutes,
                run_minutes_per_unit=step.run_minutes_per_unit,
            )
        )
    db.commit()
    db.refresh(revision)
    return revision


def activate_routing(db: Session, company: Company, routing_id: int) -> MasterRouting:
    routing = _routing_for_company(db, company, routing_id)
    if not routing.operations:
        raise HTTPException(status_code=400, detail="Add at least one operation before activating")
    others = (
        db.query(MasterRouting)
        .filter(
            MasterRouting.company_id == company.id,
            MasterRouting.routing_code == routing.routing_code,
            MasterRouting.status == "active",
            MasterRouting.id != routing.id,
        )
        .all()
    )
    for other in others:
        other.status = "obsolete"
    routing.status = "active"
    db.commit()
    db.refresh(routing)
    return routing


def apply_to_bom(db: Session, company: Company, header: ItemBOMHeader, routing_id: int) -> list[BomRoutingOperation]:
    """Copy a library revision onto one BOM version. The item master is left unchanged."""
    routing = _routing_for_company(db, company, routing_id)
    if routing.status != "active":
        raise HTTPException(status_code=400, detail="Select an active routing revision")
    if header.status not in WRITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Cannot edit an obsolete BOM version")
    db.query(BomRoutingOperation).filter(BomRoutingOperation.bom_header_id == header.bom_header_id).delete()
    copied: list[BomRoutingOperation] = []
    for step in routing.operations:
        row = BomRoutingOperation(
            bom_header_id=header.bom_header_id,
            sequence=step.sequence,
            work_center_id=step.work_center_id,
            name=step.operation_name,
            setup_minutes=step.setup_minutes,
            run_minutes_per_unit=step.run_minutes_per_unit,
        )
        db.add(row)
        copied.append(row)
    header.applied_master_routing_id = routing.id
    header.applied_routing_code = routing.routing_code
    header.applied_routing_version = routing.version_no
    db.commit()
    return copied
