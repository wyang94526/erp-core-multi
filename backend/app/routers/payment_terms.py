# @author: Wendy Yang
# @date: 2026-09-19

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import PaymentTermCreate, PaymentTermRead, PaymentTermUpdate
from app.services import payment_terms as payment_term_service

router = APIRouter(prefix="/payment-terms", tags=["payment-terms"])


@router.get("", response_model=list[PaymentTermRead])
def list_payment_terms(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    return payment_term_service.list_payment_terms(db, include_inactive=include_inactive)


@router.post("", response_model=PaymentTermRead, status_code=status.HTTP_201_CREATED)
def create_payment_term(payload: PaymentTermCreate, db: Session = Depends(get_db)):
    return payment_term_service.create_payment_term(
        db,
        code=payload.code,
        description=payload.description,
        due_days=payload.due_days,
        discount_days=payload.discount_days,
        discount_percentage=payload.discount_percentage,
        is_active=payload.is_active,
    )


@router.put("/{term_id}", response_model=PaymentTermRead)
def update_payment_term(
    term_id: UUID,
    payload: PaymentTermUpdate,
    db: Session = Depends(get_db),
):
    return payment_term_service.update_payment_term(
        db, term_id, payload.model_dump(exclude_unset=True)
    )


@router.delete("/{term_id}", response_model=PaymentTermRead)
def deactivate_payment_term(term_id: UUID, db: Session = Depends(get_db)):
    return payment_term_service.deactivate_payment_term(db, term_id)
