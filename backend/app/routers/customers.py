from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Customer
from app.schemas import (
    CustomerCreate,
    CustomerDetailRead,
    CustomerListPage,
    CustomerUpdate,
    CustomerUpsert,
)
from app.services import customers as customer_service
from app.services.pagination import paginate_query, set_total_count_header

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=CustomerListPage)
def list_customers(
    skip: int = 0,
    limit: int = 100,
    q: str | None = Query(default=None, description="Search name, customer ID, tax ID, or ext #"),
    status_filter: str | None = Query(default=None, alias="status"),
    response: Response = None,
    db: Session = Depends(get_db),
) -> CustomerListPage:
    query = db.query(Customer)
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Customer.customer_id.ilike(term),
                Customer.company_name.ilike(term),
                Customer.customer_number_ext.ilike(term),
                Customer.tax_id.ilike(term),
            )
        )
    if status_filter and status_filter.strip() and status_filter.strip().upper() != "ALL":
        query = query.filter(Customer.status == status_filter.strip().upper())
    rows, pagination = paginate_query(
        query,
        skip=skip,
        limit=limit,
        order_by=(Customer.company_name.asc(), Customer.customer_id.asc()),
    )
    set_total_count_header(response, pagination.total)
    return CustomerListPage(data=rows, pagination=pagination)


@router.post("", response_model=CustomerDetailRead, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)) -> CustomerDetailRead:
    customer = customer_service.create_customer(db, payload)
    return customer_service.to_detail(customer)


@router.get("/{customer_id}", response_model=CustomerDetailRead)
def get_customer(customer_id: str, db: Session = Depends(get_db)) -> CustomerDetailRead:
    customer = customer_service.get_customer_detail(db, customer_id)
    return customer_service.to_detail(customer)


@router.put("/{customer_id}", response_model=CustomerDetailRead)
def replace_customer(
    customer_id: str, payload: CustomerUpsert, db: Session = Depends(get_db)
) -> CustomerDetailRead:
    if payload.customer_id and payload.customer_id != customer_id:
        raise HTTPException(status_code=400, detail="customer_id in body must match the URL")
    customer = customer_service.replace_customer(db, customer_id, payload)
    return customer_service.to_detail(customer)


@router.patch("/{customer_id}", response_model=CustomerDetailRead)
def update_customer(
    customer_id: str, payload: CustomerUpdate, db: Session = Depends(get_db)
) -> CustomerDetailRead:
    customer = customer_service.patch_customer(db, customer_id, payload)
    return customer_service.to_detail(customer)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(customer_id: str, db: Session = Depends(get_db)) -> None:
    customer_service.delete_customer(db, customer_id)
