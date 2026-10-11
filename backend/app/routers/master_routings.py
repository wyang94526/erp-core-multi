# @author: Wendy Yang
# @date: 2026-10-11

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.deps.company import get_current_company
from app.models import Company, ItemBOMHeader, User
from app.schemas import (
    ApplyMasterRouting,
    BomRoutingOperationRead,
    MasterRoutingCreate,
    MasterRoutingOperationCreate,
    MasterRoutingOperationRead,
    MasterRoutingRead,
    StandardOperationCreate,
    StandardOperationRead,
)
from app.services import master_routings as library

router = APIRouter(tags=["route-library"])


@router.get("/standard-operations", response_model=list[StandardOperationRead])
def list_standard_operations(
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:view")),
) -> list:
    return library.list_operations(db, company)


@router.post("/standard-operations", response_model=StandardOperationRead, status_code=201)
def create_standard_operation(
    payload: StandardOperationCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:edit")),
):
    return library.create_operation(db, company, payload)


@router.get("/master-routings", response_model=list[MasterRoutingRead])
def list_master_routings(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:view")),
) -> list:
    return library.list_routings(db, company, status)


@router.post("/master-routings", response_model=MasterRoutingRead, status_code=201)
def create_master_routing(
    payload: MasterRoutingCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:edit")),
):
    return library.create_routing(db, company, payload)


@router.post("/master-routings/{routing_id}/operations", response_model=MasterRoutingOperationRead, status_code=201)
def add_master_routing_operation(
    routing_id: int,
    payload: MasterRoutingOperationCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:edit")),
):
    return library.add_routing_step(db, company, routing_id, payload)


@router.post("/master-routings/{routing_id}/versions", response_model=MasterRoutingRead, status_code=201)
def revise_master_routing(
    routing_id: int,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:edit")),
):
    return library.revise_routing(db, company, routing_id)


@router.post("/master-routings/{routing_id}/activate", response_model=MasterRoutingRead)
def activate_master_routing(
    routing_id: int,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:edit")),
):
    return library.activate_routing(db, company, routing_id)


@router.post(
    "/items/{item_id}/bom-headers/{header_id}/routing/apply",
    response_model=list[BomRoutingOperationRead],
)
def apply_master_routing(
    item_id: str,
    header_id: int,
    payload: ApplyMasterRouting,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("routing:edit")),
) -> list:
    from app.routers.product_bom import _ensure_parent, _header_for_item

    _ensure_parent(db, item_id, company)
    header: ItemBOMHeader = _header_for_item(db, item_id, header_id)
    return library.apply_to_bom(db, company, header, payload.master_routing_id)
