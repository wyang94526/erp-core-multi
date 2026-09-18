# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog, User
from app.schemas import AuditLogCreate, AuditLogRead, AuditLogUpdate

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


@router.get("", response_model=list[AuditLogRead])
def list_audit_logs(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[AuditLog]:
    return db.query(AuditLog).order_by(AuditLog.id.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=AuditLogRead, status_code=status.HTTP_201_CREATED)
def create_audit_log(payload: AuditLogCreate, db: Session = Depends(get_db)) -> AuditLog:
    if payload.user_id is not None and db.get(User, payload.user_id) is None:
        raise HTTPException(status_code=400, detail="user_id not found")
    log = AuditLog(**payload.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/{log_id}", response_model=AuditLogRead)
def get_audit_log(log_id: int, db: Session = Depends(get_db)) -> AuditLog:
    log = db.get(AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")
    return log


@router.patch("/{log_id}", response_model=AuditLogRead)
def update_audit_log(log_id: int, payload: AuditLogUpdate, db: Session = Depends(get_db)) -> AuditLog:
    log = db.get(AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")
    data = payload.model_dump(exclude_unset=True)
    if "user_id" in data and data["user_id"] is not None and db.get(User, data["user_id"]) is None:
        raise HTTPException(status_code=400, detail="user_id not found")
    for key, value in data.items():
        setattr(log, key, value)
    db.commit()
    db.refresh(log)
    return log


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_log(log_id: int, db: Session = Depends(get_db)) -> None:
    log = db.get(AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")
    db.delete(log)
    db.commit()
