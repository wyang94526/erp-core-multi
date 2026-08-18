from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Warehouse, WorkCenter
from app.schemas import WorkCenterCreate, WorkCenterRead

router = APIRouter(prefix="/work-centers", tags=["Work Centers"])


@router.get("", response_model=list[WorkCenterRead])
def list_work_centers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[WorkCenter]:
    return (
        db.query(WorkCenter)
        .order_by(WorkCenter.name.asc(), WorkCenter.work_center_id.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("", response_model=WorkCenterRead, status_code=status.HTTP_201_CREATED)
def create_work_center(payload: WorkCenterCreate, db: Session = Depends(get_db)) -> WorkCenter:
    if db.get(WorkCenter, payload.work_center_id):
        raise HTTPException(status_code=400, detail="Work center ID already exists")
    if payload.warehouse_id and not db.get(Warehouse, payload.warehouse_id):
        raise HTTPException(status_code=400, detail="Warehouse was not found")
    row = WorkCenter(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
