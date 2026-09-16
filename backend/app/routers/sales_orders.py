from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Customer, CustomerLocation, Item, SalesOrder, SalesOrderItem
from app.schemas import SalesOrderCreate, SalesOrderRead, SalesOrderUpdate
from app.services import o2c
from app.services.document_sequences import DOC_SALES_ORDER, generate_document_number

router = APIRouter(prefix="/sales-orders", tags=["sales_orders"])


def _validate_sales_order_refs(db: Session, payload: SalesOrderCreate | SalesOrderUpdate, *, partial: bool = False) -> None:
    """Raise 400 for missing customer / location / product references before insert."""
    data = payload.model_dump(exclude_unset=partial)

    customer_id = data.get("customer_id")
    if customer_id is not None and db.get(Customer, customer_id) is None:
        raise HTTPException(status_code=400, detail=f"Customer '{customer_id}' not found")

    for field in ("bill_to_location_id", "ship_to_location_id"):
        loc_id = data.get(field)
        if loc_id is None:
            continue
        loc = db.get(CustomerLocation, loc_id)
        if loc is None:
            raise HTTPException(
                status_code=400,
                detail=f"{field} '{loc_id}' not found in customer locations",
            )
        if customer_id and loc.customer_id != customer_id:
            raise HTTPException(
                status_code=400,
                detail=f"{field} '{loc_id}' does not belong to customer '{customer_id}'",
            )

    items = data.get("items")
    if items:
        for item in items:
            item_id = item.get("item_id") if isinstance(item, dict) else getattr(item, "item_id", None)
            if item_id and db.get(Item, item_id) is None:
                raise HTTPException(status_code=400, detail=f"Item '{item_id}' not found")


@router.get("", response_model=list[SalesOrderRead])
def list_sales_orders(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[SalesOrder]:
    """
    Retrieve a list of sales orders.
    This will automatically include the nested line items for each order 
    based on the SalesOrderRead schema.
    """
    orders = db.query(SalesOrder).offset(skip).limit(limit).all()
    o2c.attach_sales_order_billing(db, orders)
    return orders

@router.post("", response_model=SalesOrderRead, status_code=status.HTTP_201_CREATED)
def create_sales_order(payload: SalesOrderCreate, db: Session = Depends(get_db)) -> SalesOrder:
    """
    Create a new Sales Order and its associated Line Items in a single transaction.
    """
    _validate_sales_order_refs(db, payload)

    # 1. Extract the parent data, excluding the nested items
    order_data = payload.model_dump(exclude={"items"})
    order_data["sales_order_id"] = generate_document_number(
        db, DOC_SALES_ORDER, payload.order_date
    )
    order = SalesOrder(**order_data)
    
    # 2. Add the parent order to the session and flush it to generate/register the ID
    db.add(order)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Invalid sales order data: {exc.orig}") from exc

    # 3. Iterate through the nested items and link them to the newly created parent
    for item_schema in payload.items:
        item_data = item_schema.model_dump(exclude={"sales_order_id"})
        if not item_data.get("customer_part_number"):
            catalog = db.get(Item, item_data.get("item_id"))
            if catalog:
                item_data["customer_part_number"] = catalog.customer_part_number
        item = SalesOrderItem(
            **item_data,
            sales_order_id=order.sales_order_id
        )
        db.add(item)

    # Operational status APPROVED must go through the approval workflow;
    # do not bypass approval_status here.

    # Commit the entire transaction atomically
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Invalid sales order data: {exc.orig}") from exc
    db.refresh(order)
    o2c.attach_sales_order_billing(db, [order])
    return order

@router.get("/{order_id}", response_model=SalesOrderRead)
def get_sales_order(order_id: str, db: Session = Depends(get_db)) -> SalesOrder:
    """
    Retrieve a specific sales order by ID, including its line items.
    """
    order = db.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Sales Order not found")
    o2c.attach_sales_order_billing(db, [order])
    return order

@router.patch("/{order_id}", response_model=SalesOrderRead)
def update_sales_order(
    order_id: str, payload: SalesOrderUpdate, db: Session = Depends(get_db)
) -> SalesOrder:
    """
    Update top-level fields on a sales order.
    Acts as the state machine for transitions like cancelling an order.
    """
    order = db.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Sales Order not found")
        
    # --- Business Logic & State Machine ---
    
    # 1. Prevent updates if the order is already cancelled
    if order.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot modify a cancelled order.")

    # 2. Handle the "Cancel" action if status is being updated
    if payload.status == "CANCELLED":
        # Add any business rules here (e.g., preventing cancellation if shipped)
        # if order.status == "SHIPPED":
        #     raise HTTPException(
        #         status_code=400, 
        #         detail="Cannot cancel an order that has already shipped."
        #     )
        
        # Place hooks here for external actions:
        # release_inventory_holds(order.sales_order_id)
        pass 

    # --- Apply Updates ---
    
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(order, key, value)

    # AR invoice creation happens when approval workflow finalizes APPROVED.

    db.commit()
    db.refresh(order)
    o2c.attach_sales_order_billing(db, [order])
    return order

# Note: No DELETE endpoint is provided in this router. 
# "Deletions" must be handled by sending a PATCH request with {"status": "CANCELLED"}.
