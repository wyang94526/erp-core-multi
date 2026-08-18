from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.entities import BinLocation, ChartOfAccount, Supplier, WorkCenter
from app import schemas

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
):
    existing_supplier = db.query(Supplier).filter(Supplier.supplier_id == payload.supplier_id).first()
    if existing_supplier:
        raise HTTPException(status_code=400, detail="Supplier ID already exists")

    data = payload.model_dump()
    _validate_supplier_refs(db, data)
    db_supplier = Supplier(**data)
    db.add(db_supplier)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create vendor. Check referenced IDs.") from exc
    db.refresh(db_supplier)
    return db_supplier


@router.get("/", response_model=List[schemas.SupplierRead])
def list_suppliers(
    skip: int = 0,
    limit: int = 100,
    vendor_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(Supplier)
    if vendor_type and vendor_type.strip():
        types = [part.strip().lower() for part in vendor_type.split(",") if part.strip()]
        if types:
            query = query.filter(Supplier.vendor_type.in_(types))
    return query.order_by(Supplier.company_name.asc(), Supplier.supplier_id.asc()).offset(skip).limit(limit).all()


@router.get("/{supplier_id}", response_model=schemas.SupplierRead)
def get_supplier(supplier_id: str, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.put("/{supplier_id}", response_model=schemas.SupplierRead)
def replace_supplier(
    supplier_id: str,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
):
    return _apply_supplier_update(supplier_id, payload, db)


@router.patch("/{supplier_id}", response_model=schemas.SupplierRead)
def update_supplier(
    supplier_id: str,
    payload: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
):
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

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not update vendor. Check referenced IDs.") from exc
    db.refresh(db_supplier)
    return db_supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(supplier_id: str, db: Session = Depends(get_db)):
    db_supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
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
