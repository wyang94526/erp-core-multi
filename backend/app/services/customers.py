"""Transactional customer create / upsert with nested locations and certifications."""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models import (
    ARInvoice,
    Customer,
    CustomerCertification,
    CustomerLocation,
    ItemFulfillment,
    SalesInvoice,
    SalesOrder,
)
from app.schemas import (
    CustomerCertificationNested,
    CustomerCreate,
    CustomerDetailRead,
    CustomerLocationNested,
    CustomerLocationRead,
    CustomerUpdate,
    CustomerUpsert,
)

LOCATION_COLUMNS = (
    "location_type",
    "location_code",
    "location_name",
    "attention_to",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "contact_person",
    "contact_email",
    "contact_phone",
    "is_default",
    "tax_id",
    "shipping_instructions",
)

CUSTOMER_COLUMNS = (
    "customer_number_ext",
    "company_name",
    "tax_id_type",
    "tax_id",
    "industry_type",
    "facility_type",
    "website",
    "primary_contact_name",
    "primary_email",
    "primary_phone",
    "currency",
    "credit_limit",
    "payment_terms",
    "preferred_incoterms",
    "tax_exempt",
    "tax_exempt_certificate_id",
    "status",
)


def _location_id_for(customer_id: str, location_type: str, existing: str | None) -> str:
    if existing:
        return existing
    prefix = {"BILL_TO": "BILL", "SHIP_TO": "SHIP", "BOTH": "LOC"}.get(location_type, "LOC")
    return f"{customer_id}-{prefix}-{uuid4().hex[:8].upper()}"


def _location_payload(item: CustomerLocationNested) -> dict:
    data = item.model_dump()
    data["state"] = data.get("state_province") or data.get("state")
    return {key: data.get(key) for key in LOCATION_COLUMNS}


def to_detail(customer: Customer) -> CustomerDetailRead:
    locations = [
        CustomerLocationRead.model_validate(loc)
        for loc in sorted(customer.locations, key=lambda row: row.location_id)
    ]
    bill_to = [loc for loc in locations if loc.location_type in ("BILL_TO", "BOTH")]
    ship_to = [loc for loc in locations if loc.location_type in ("SHIP_TO", "BOTH")]
    return CustomerDetailRead.model_validate(customer).model_copy(
        update={
            "locations": locations,
            "bill_to_locations": bill_to,
            "ship_to_locations": ship_to,
            "certifications": customer.certifications,
        }
    )


def get_customer_detail(db: Session, customer_id: str) -> Customer:
    customer = (
        db.query(Customer)
        .options(
            joinedload(Customer.locations),
            joinedload(Customer.certifications),
        )
        .filter(Customer.customer_id == customer_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


def apply_header(customer: Customer, payload: dict) -> None:
    for key, value in payload.items():
        if key in CUSTOMER_COLUMNS:
            setattr(customer, key, value)


def sync_locations(
    db: Session,
    customer: Customer,
    incoming: list[CustomerLocationNested],
) -> None:
    existing = {loc.location_id: loc for loc in list(customer.locations)}
    keep_ids: set[str] = set()

    for item in incoming:
        payload = _location_payload(item)
        loc_id = _location_id_for(customer.customer_id, item.location_type, item.location_id)
        if loc_id in existing:
            for key, value in payload.items():
                setattr(existing[loc_id], key, value)
            keep_ids.add(loc_id)
            continue

        taken = db.get(CustomerLocation, loc_id)
        if taken:
            if taken.customer_id != customer.customer_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Location ID '{loc_id}' already exists",
                )
            for key, value in payload.items():
                setattr(taken, key, value)
            if taken not in customer.locations:
                customer.locations.append(taken)
            keep_ids.add(loc_id)
            continue
        location = CustomerLocation(
            location_id=loc_id,
            customer_id=customer.customer_id,
            **payload,
        )
        customer.locations.append(location)
        keep_ids.add(loc_id)

    for loc_id, location in list(existing.items()):
        if loc_id not in keep_ids:
            customer.locations.remove(location)


def sync_certifications(
    customer: Customer,
    incoming: list[CustomerCertificationNested],
) -> None:
    existing = {cert.id: cert for cert in list(customer.certifications)}
    keep_ids: set[int] = set()

    for item in incoming:
        data = item.model_dump(exclude={"id"})
        if item.id and item.id in existing:
            for key, value in data.items():
                setattr(existing[item.id], key, value)
            keep_ids.add(item.id)
            continue
        cert = CustomerCertification(customer_id=customer.customer_id, **data)
        customer.certifications.append(cert)

    for cert_id, cert in existing.items():
        if cert_id not in keep_ids:
            customer.certifications.remove(cert)


def create_customer(db: Session, payload: CustomerCreate) -> Customer:
    if db.get(Customer, payload.customer_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Customer ID already exists",
        )

    header = payload.model_dump(exclude={"locations", "certifications", "customer_id"})
    customer = Customer(customer_id=payload.customer_id, **header)
    db.add(customer)
    db.flush()

    if payload.locations:
        sync_locations(db, customer, payload.locations)
    if payload.certifications:
        sync_certifications(customer, payload.certifications)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not create customer. Check that location IDs are unique.",
        ) from exc

    return get_customer_detail(db, payload.customer_id)


def replace_customer(db: Session, customer_id: str, payload: CustomerUpsert) -> Customer:
    customer = get_customer_detail(db, customer_id)
    header = payload.model_dump(exclude={"locations", "certifications", "customer_id"})
    apply_header(customer, header)
    sync_locations(db, customer, payload.locations)
    sync_certifications(customer, payload.certifications or [])

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Could not update customer locations. A removed location is still "
                "referenced by a sales order or shipment."
            ),
        ) from exc

    return get_customer_detail(db, customer_id)


def patch_customer(db: Session, customer_id: str, payload: CustomerUpdate) -> Customer:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    apply_header(customer, payload.model_dump(exclude_unset=True))
    db.commit()
    return get_customer_detail(db, customer_id)


def delete_customer(db: Session, customer_id: str) -> None:
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    so_count = db.query(SalesOrder).filter(SalesOrder.customer_id == customer_id).count()
    if so_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete customer '{customer_id}' because it has {so_count} sales order(s).",
        )

    fulfillment_count = (
        db.query(ItemFulfillment).filter(ItemFulfillment.customer_id == customer_id).count()
    )
    if fulfillment_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete customer '{customer_id}' because it has related fulfillments.",
        )

    invoice_count = db.query(SalesInvoice).filter(SalesInvoice.customer_id == customer_id).count()
    if invoice_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete customer '{customer_id}' because it has related sales invoices.",
        )

    ar_count = db.query(ARInvoice).filter(ARInvoice.customer_id == customer_id).count()
    if ar_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete customer '{customer_id}' because it has related AR invoices.",
        )

    try:
        db.delete(customer)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete this customer because related records still exist.",
        ) from exc
