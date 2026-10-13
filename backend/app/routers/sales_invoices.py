# @author: Wendy Yang
# @date: 2026-09-19

"""Sales Invoice API for Order-to-Cash billing."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.schemas import SalesInvoiceCreate, SalesInvoiceRead, SalesInvoiceVoidRequest
from app.services import o2c
from app.services.compliance import write_document_audit

router = APIRouter(prefix="/sales-invoices", tags=["sales-invoices"])


@router.get("", response_model=list[SalesInvoiceRead])
def list_sales_invoices(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return o2c.list_sales_invoices(db, skip=skip, limit=limit)


@router.get("/{invoice_id}", response_model=SalesInvoiceRead)
def get_sales_invoice(invoice_id: int, db: Session = Depends(get_db)):
    return o2c.serialize_sales_invoice(o2c._load_sales_invoice(db, invoice_id))


@router.post("", response_model=SalesInvoiceRead, status_code=201)
def create_sales_invoice(
    payload: SalesInvoiceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = o2c.create_sales_invoice(
        db,
        sales_order_id=payload.sales_order_id,
        fulfillment_id=payload.fulfillment_id,
        issue_date=payload.issue_date,
        payment_terms=payload.payment_terms,
        payment_term_id=payload.payment_term_id,
        line_overrides=(
            [line.model_dump() for line in payload.lines] if payload.lines else None
        ),
    )
    write_document_audit(
        db,
        "sales_invoices",
        "CREATE",
        user.id,
        "Sales invoice created",
        document_key=result["invoice_number"],
    )
    db.commit()
    return result


@router.post("/{invoice_id}/approve", response_model=SalesInvoiceRead)
def approve_sales_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = o2c.approve_sales_invoice(db, invoice_id)
    write_document_audit(
        db,
        "sales_invoices",
        "UPDATE",
        user.id,
        "Sales invoice approved",
        document_key=result["invoice_number"],
    )
    db.commit()
    return result


@router.post("/{invoice_id}/void", response_model=SalesInvoiceRead)
def void_sales_invoice(
    invoice_id: int,
    payload: SalesInvoiceVoidRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = o2c.void_sales_invoice(db, invoice_id, user_id=user.id, reason=payload.reason)
    db.commit()
    return result
