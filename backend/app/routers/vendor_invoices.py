# @author: Wendy Yang
# @date: 2026-09-19

"""Supplier Invoice (Vendor Bill) API for Procure-to-Pay."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    DepartmentRead,
    GoodsReceiptRead,
    SupplierInvoiceCreate,
    SupplierInvoicePayRequest,
    SupplierInvoiceRead,
)
from app.services import p2p

router = APIRouter(prefix="/vendor-invoices", tags=["vendor-invoices"])


@router.get("", response_model=list[SupplierInvoiceRead])
def list_vendor_invoices(
    skip: int = 0,
    limit: int = 100,
    source_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    vendor_id: str | None = Query(default=None),
    source_order_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return p2p.list_supplier_invoices(
        db,
        skip=skip,
        limit=limit,
        source_type=source_type,
        status=status,
        vendor_id=vendor_id,
        source_order_id=source_order_id,
    )


@router.get("/goods-receipts", response_model=list[GoodsReceiptRead])
def list_posted_goods_receipts(
    vendor_id: str | None = Query(default=None),
    q: str | None = Query(default=None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    return p2p.list_posted_goods_receipts(db, vendor_id=vendor_id, q=q, skip=skip, limit=limit)


@router.get("/departments", response_model=list[DepartmentRead])
def list_departments(db: Session = Depends(get_db)):
    return p2p.list_departments(db)


@router.get("/{invoice_id}", response_model=SupplierInvoiceRead)
def get_vendor_invoice(invoice_id: int, db: Session = Depends(get_db)):
    return p2p.serialize_supplier_invoice(p2p._load_invoice(db, invoice_id))


@router.post("", response_model=SupplierInvoiceRead, status_code=201)
def create_vendor_invoice(payload: SupplierInvoiceCreate, db: Session = Depends(get_db)):
    result = p2p.create_supplier_invoice(
        db,
        invoice_type=payload.invoice_type,
        source_type=payload.source_type,
        source_order_id=payload.source_order_id,
        vendor_id=payload.vendor_id,
        vendor_invoice_number=payload.vendor_invoice_number,
        invoice_date=payload.invoice_date,
        due_date=payload.due_date,
        tax_amount=payload.tax_amount,
        freight_amount=payload.freight_amount,
        currency=payload.currency,
        lines=[line.model_dump() for line in payload.lines] if payload.lines else None,
        distributions=(
            [row.model_dump() for row in payload.distributions] if payload.distributions else None
        ),
        payment_term_id=payload.payment_term_id,
        payment_terms=payload.payment_terms,
        allocate_to_goods_receipt_id=payload.allocate_to_goods_receipt_id,
    )
    db.commit()
    return result


@router.patch("/{invoice_id}/submit", response_model=SupplierInvoiceRead)
def submit_vendor_invoice(invoice_id: int, db: Session = Depends(get_db)):
    result = p2p.submit_supplier_invoice(db, invoice_id)
    db.commit()
    return result


@router.patch("/{invoice_id}/approve", response_model=SupplierInvoiceRead)
def approve_vendor_invoice(invoice_id: int, db: Session = Depends(get_db)):
    result = p2p.approve_supplier_invoice(db, invoice_id)
    db.commit()
    return result


@router.patch("/{invoice_id}/pay", response_model=SupplierInvoiceRead)
def pay_vendor_invoice(
    invoice_id: int,
    payload: SupplierInvoicePayRequest | None = None,
    db: Session = Depends(get_db),
):
    body = payload or SupplierInvoicePayRequest()
    result = p2p.pay_supplier_invoice(
        db,
        invoice_id,
        amount=body.amount,
        bank_account_id=body.bank_account_id,
        payment_method=body.payment_method,
        instrument_ref_no=body.instrument_ref_no,
        payment_date=body.payment_date,
    )
    db.commit()
    return result
