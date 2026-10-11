# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Warehouse, WorkCenter
from app.schemas import WorkCenterCreate, WorkCenterRead, WorkCenterUpdate

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
    warehouse_id = (payload.warehouse_id or "").strip() or None
    if warehouse_id and not db.get(Warehouse, warehouse_id):
        raise HTTPException(status_code=400, detail="Warehouse was not found")
    data = payload.model_dump()
    data["work_center_id"] = payload.work_center_id.strip()
    data["name"] = payload.name.strip()
    data["warehouse_id"] = warehouse_id
    row = WorkCenter(**data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{work_center_id}", response_model=WorkCenterRead)
def update_work_center(work_center_id: str, payload: WorkCenterUpdate, db: Session = Depends(get_db)) -> WorkCenter:
    row = db.get(WorkCenter, work_center_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Work center not found")
    if payload.warehouse_id and not db.get(Warehouse, payload.warehouse_id):
        raise HTTPException(status_code=400, detail="Warehouse was not found")
    row.name = payload.name.strip()
    row.warehouse_id = (payload.warehouse_id or "").strip() or None
    row.hourly_rate = payload.hourly_rate
    row.is_active = payload.is_active
    db.commit()
    db.refresh(row)
    return row
