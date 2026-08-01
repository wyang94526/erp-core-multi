from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

# Adjust these imports based on your project structure
from app.database import get_db
from app.models.entities import Supplier
from app import schemas

router = APIRouter(
    prefix="/suppliers",
    tags=["Suppliers"]
)

@router.post("/", response_model=schemas.SupplierRead, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: schemas.SupplierCreate, 
    db: Session = Depends(get_db)
):
    # Check if the provided supplier_id is already taken
    existing_supplier = db.query(Supplier).filter(Supplier.supplier_id == payload.supplier_id).first()
    if existing_supplier:
        raise HTTPException(status_code=400, detail="Supplier ID already exists")

    db_supplier = Supplier(**payload.model_dump())
    db.add(db_supplier)
    db.commit()
    db.refresh(db_supplier)
    return db_supplier


@router.get("/", response_model=List[schemas.SupplierRead])
def list_suppliers(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db)
):
    """Retrieve a list of suppliers with pagination."""
    suppliers = db.query(Supplier).offset(skip).limit(limit).all()
    return suppliers


@router.get("/{supplier_id}", response_model=schemas.SupplierRead)
def get_supplier(supplier_id: str, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.put("/{supplier_id}", response_model=schemas.SupplierRead)
def update_supplier(
    supplier_id: str, 
    payload: schemas.SupplierUpdate, 
    db: Session = Depends(get_db)
):
    db_supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    # Only update fields that were actually provided in the request payload
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_supplier, key, value)
        
    db.commit()
    db.refresh(db_supplier)
    return db_supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(supplier_id: str, db: Session = Depends(get_db)):
    db_supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
        
    db.delete(db_supplier)
    db.commit()
    return None
