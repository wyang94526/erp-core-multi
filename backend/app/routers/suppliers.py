# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.company import get_current_company, require_company_row
from app.models import Company
from app.models.entities import BinLocation, ChartOfAccount, Supplier, WorkCenter
from app import schemas
from app.services.payment_terms import apply_payment_term_fields
from app.services.pagination import paginate_query, set_total_count_header

router = APIRouter(
    prefix="/suppliers",
    tags=["Suppliers"],
)


def _validate_supplier_refs(db: Session, payload: dict) -> None:
    ap_account_id = payload.get("ap_account_id")
    if ap_account_id and not db.get(ChartOfAccount, ap_account_id):
        raise HTTPException(status_code=400, detail="AP account was not found")

    work_center_id = payload.get("work_center_id")
    if work_center_id and not db.get(WorkCenter, work_center_id):
        raise HTTPException(status_code=400, detail="Work center was not found")

    loc_id = payload.get("consignment_stock_loc_id")
    if loc_id and not db.get(BinLocation, loc_id):
        raise HTTPException(status_code=400, detail="Consignment stock location was not found")


@router.post("/", response_model=schemas.SupplierRead, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: schemas.SupplierCreate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
):
    existing_supplier = db.query(Supplier).filter(Supplier.supplier_id == payload.supplier_id).first()
    if existing_supplier:
        raise HTTPException(status_code=400, detail="Supplier ID already exists")

    data = payload.model_dump()
    _validate_supplier_refs(db, data)
    db_supplier = Supplier(**data)
    db_supplier.company_id = company.id
    apply_payment_term_fields(
        db,
        db_supplier,
        payment_term_id=data.get("payment_term_id"),
        payment_terms=data.get("payment_terms"),
    )
    db.add(db_supplier)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create vendor. Check referenced IDs.") from exc
    db.refresh(db_supplier)
    return db_supplier


@router.get("/", response_model=schemas.SupplierListPage)
def list_suppliers(
    skip: int = 0,
    limit: int = 100,
    vendor_type: str | None = Query(default=None),
    response: Response = None,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
):
    query = db.query(Supplier).filter(Supplier.company_id == company.id)
    if vendor_type and vendor_type.strip():
        types = [part.strip().lower() for part in vendor_type.split(",") if part.strip()]
        if types:
            query = query.filter(Supplier.vendor_type.in_(types))
    rows, pagination = paginate_query(
        query,
        skip=skip,
        limit=limit,
        order_by=(Supplier.company_name.asc(), Supplier.supplier_id.asc()),
    )
    set_total_count_header(response, pagination.total)
    return schemas.SupplierListPage(data=rows, pagination=pagination)


@router.get("/{supplier_id}", response_model=schemas.SupplierRead)
def get_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
):
    supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    return require_company_row(supplier, company, "Supplier not found")


@router.put("/{supplier_id}", response_model=schemas.SupplierRead)
def replace_supplier(
    supplier_id: str,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
):
    require_company_row(db.get(Supplier, supplier_id), company, "Supplier not found")
    return _apply_supplier_update(supplier_id, payload, db)


@router.patch("/{supplier_id}", response_model=schemas.SupplierRead)
def update_supplier(
    supplier_id: str,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
):
    require_company_row(db.get(Supplier, supplier_id), company, "Supplier not found")
    return _apply_supplier_update(supplier_id, payload, db)


def _apply_supplier_update(
    supplier_id: str,
    payload: schemas.SupplierUpdate,
    db: Session,
) -> Supplier:
    db_supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    update_data = payload.model_dump(exclude_unset=True)
    _validate_supplier_refs(db, update_data)
    for key, value in update_data.items():
        setattr(db_supplier, key, value)
    if "payment_term_id" in update_data or "payment_terms" in update_data:
        apply_payment_term_fields(
            db,
            db_supplier,
            payment_term_id=update_data.get("payment_term_id", db_supplier.payment_term_id),
            payment_terms=update_data.get("payment_terms", db_supplier.payment_terms),
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not update vendor. Check referenced IDs.") from exc
    db.refresh(db_supplier)
    return db_supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    company: Company = Depends(get_current_company),
):
    db_supplier = require_company_row(db.get(Supplier, supplier_id), company, "Supplier not found")
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    try:
        db.delete(db_supplier)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete this vendor because related purchase or subcontract records still exist.",
        ) from exc
    return None
