# @author: Wendy Yang
# @date: 2026-10-11

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps.auth import require_permission
from app.deps.company import get_current_company
from app.models import Company, ProductionOrder, User
from app.schemas import (
    ProductionIssueCreate,
    ProductionIssueRead,
    ProductionOrderCreate,
    ProductionOrderRead,
    ProductionOrderStatusUpdate,
    ProductionOrderUpdate,
    ProductionReceiptCreate,
    ProductionReceiptRead,
    ProductionRoutingStatusUpdate,
    StepComplete,
)
from app.services.production import canonical_status
from app.services import production as production_service
from app.services import shop_floor

router = APIRouter(prefix="/production-orders", tags=["production-orders"])


def _load(db: Session, company: Company, order_id: str) -> ProductionOrder:
    order = (
        db.query(ProductionOrder)
        .options(
            selectinload(ProductionOrder.materials),
            selectinload(ProductionOrder.operations),
            selectinload(ProductionOrder.receipts),
        )
        .filter(
            ProductionOrder.production_order_id == order_id,
            ProductionOrder.company_id == company.id,
        )
        .first()
    )
    if order is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Production order not found")
    return order


@router.get("", response_model=list[ProductionOrderRead])
def list_orders(
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> list[ProductionOrder]:
    query = (
        db.query(ProductionOrder)
        .options(
            selectinload(ProductionOrder.materials),
            selectinload(ProductionOrder.operations),
            selectinload(ProductionOrder.receipts),
        )
        .filter(ProductionOrder.company_id == company.id)
    )
    if status:
        query = query.filter(ProductionOrder.status == canonical_status(status))
    if date_from is not None:
        query = query.filter(ProductionOrder.order_date >= date_from)
    if date_to is not None:
        query = query.filter(ProductionOrder.order_date <= date_to)
    return (
        query.order_by(ProductionOrder.order_date.desc(), ProductionOrder.production_order_id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("", response_model=ProductionOrderRead, status_code=201)
def create_order(
    payload: ProductionOrderCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    order = production_service.create_order(db, company, payload)
    return _load(db, company, order.production_order_id)


@router.patch("/{order_id}", response_model=ProductionOrderRead)
def update_order(
    order_id: str,
    payload: ProductionOrderUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    production_service.update_order(db, company, order_id, payload)
    return _load(db, company, order_id)


@router.patch("/{order_id}/status", response_model=ProductionOrderRead)
def update_status(
    order_id: str,
    payload: ProductionOrderStatusUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    production_service.change_status(db, company, order_id, payload.status)
    return _load(db, company, order_id)


@router.delete("/{order_id}", status_code=204)
def delete_order(
    order_id: str,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> Response:
    production_service.cancel_order(db, company, order_id)
    return Response(status_code=204)


@router.post("/{order_id}/steps/{step_id}/start", response_model=ProductionOrderRead)
def start_step(
    order_id: str,
    step_id: int,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    shop_floor.start_step(db, company, order_id, step_id, user.id)
    return _load(db, company, order_id)


@router.post("/{order_id}/steps/{step_id}/complete", response_model=ProductionOrderRead)
def complete_step(
    order_id: str,
    step_id: int,
    payload: StepComplete,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    shop_floor.complete_step(db, company, order_id, step_id, payload)
    return _load(db, company, order_id)


@router.patch("/{order_id}/routing/{operation_id}", response_model=ProductionOrderRead)
def update_routing_status(
    order_id: str,
    operation_id: int,
    payload: ProductionRoutingStatusUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    production_service.set_operation_status(db, company, order_id, operation_id, payload.status)
    return _load(db, company, order_id)


@router.get("/{order_id}", response_model=ProductionOrderRead)
def get_order(
    order_id: str,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    return _load(db, company, order_id)


@router.post("/{order_id}/release", response_model=ProductionOrderRead)
def release_order(
    order_id: str,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    production_service.release_order(db, company, order_id)
    return _load(db, company, order_id)


@router.post("/{order_id}/close", response_model=ProductionOrderRead)
def close_order(
    order_id: str,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionOrder:
    production_service.close_order(db, company, order_id)
    return _load(db, company, order_id)


@router.post("/{order_id}/issues", response_model=ProductionIssueRead, status_code=201)
def issue_materials(
    order_id: str,
    payload: ProductionIssueCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    _user: User = Depends(require_permission("production:view")),
) -> ProductionIssueRead:
    issue = production_service.issue_materials(db, company, order_id, payload)
    return issue


@router.post("/{order_id}/receipts", response_model=ProductionReceiptRead, status_code=201)
def receive_goods(
    order_id: str,
    payload: ProductionReceiptCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
    user: User = Depends(require_permission("production:view")),
) -> ProductionReceiptRead:
    return production_service.receive_finished_goods(db, company, order_id, payload, user.id)
