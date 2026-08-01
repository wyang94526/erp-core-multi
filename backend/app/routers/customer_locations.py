from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

# Adjust these imports based on your project structure
from app.database import get_db
from app.models import entities
from app import schemas

router = APIRouter(
    prefix="/customer-locations",
    tags=["Customer Locations"]
)

@router.post("/", response_model=schemas.CustomerLocationRead, status_code=status.HTTP_201_CREATED)
def create_customer_location(
    location: schemas.CustomerLocationCreate, 
    db: Session = Depends(get_db)
):
    # Verify the customer exists before creating a location for them
    customer = db.query(entities.Customer).filter(entities.Customer.customer_id == location.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
        
    # Check if the provided location_id is already taken
    existing_loc = db.query(entities.CustomerLocation).filter(entities.CustomerLocation.location_id == location.location_id).first()
    if existing_loc:
        raise HTTPException(status_code=400, detail="Location ID already exists")

    db_location = entities.CustomerLocation(**location.model_dump())
    db.add(db_location)
    db.commit()
    db.refresh(db_location)
    return db_location


@router.get("/customer/{customer_id}", response_model=List[schemas.CustomerLocationRead])
def get_locations_by_customer(customer_id: str, db: Session = Depends(get_db)):
    """Retrieve all locations (Billing, Shipping, or Both) for a specific customer."""
    locations = db.query(entities.CustomerLocation).filter(entities.CustomerLocation.customer_id == customer_id).all()
    return locations


@router.get("/{location_id}", response_model=schemas.CustomerLocationRead)
def get_customer_location(location_id: str, db: Session = Depends(get_db)):
    location = db.query(entities.CustomerLocation).filter(entities.CustomerLocation.location_id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return location


@router.put("/{location_id}", response_model=schemas.CustomerLocationRead)
def update_customer_location(
    location_id: str, 
    location_update: schemas.CustomerLocationUpdate, 
    db: Session = Depends(get_db)
):
    db_location = db.query(entities.CustomerLocation).filter(entities.CustomerLocation.location_id == location_id).first()
    if not db_location:
        raise HTTPException(status_code=404, detail="Location not found")
        
    # Only update fields that were actually provided in the request payload
    update_data = location_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_location, key, value)
        
    db.commit()
    db.refresh(db_location)
    return db_location


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer_location(location_id: str, db: Session = Depends(get_db)):
    db_location = db.query(entities.CustomerLocation).filter(entities.CustomerLocation.location_id == location_id).first()
    if not db_location:
        raise HTTPException(status_code=404, detail="Location not found")
        
    db.delete(db_location)
    db.commit()
    return None