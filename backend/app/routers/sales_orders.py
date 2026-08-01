from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SalesOrder, SalesOrderItem
from app.schemas import SalesOrderCreate, SalesOrderRead, SalesOrderUpdate

router = APIRouter(prefix="/sales-orders", tags=["sales_orders"])

@router.get("", response_model=list[SalesOrderRead])
def list_sales_orders(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[SalesOrder]:
    """
    Retrieve a list of sales orders.
    This will automatically include the nested line items for each order 
    based on the SalesOrderRead schema.
    """
    return db.query(SalesOrder).offset(skip).limit(limit).all()

@router.post("", response_model=SalesOrderRead, status_code=status.HTTP_201_CREATED)
def create_sales_order(payload: SalesOrderCreate, db: Session = Depends(get_db)) -> SalesOrder:
    """
    Create a new Sales Order and its associated Line Items in a single transaction.
    """
    # 1. Extract the parent data, excluding the nested items
    order_data = payload.model_dump(exclude={"items"})
    order = SalesOrder(**order_data)
    
    # 2. Add the parent order to the session and flush it to generate/register the ID
    db.add(order)
    db.flush() 

    # 3. Iterate through the nested items and link them to the newly created parent
    for item_schema in payload.items:
        # We explicitly exclude sales_order_id from the dump just in case it is 
        # still present in the schema, and assign it manually from the parent.
        item_data = item_schema.model_dump(exclude={"sales_order_id"})
        item = SalesOrderItem(
            **item_data,
            sales_order_id=order.sales_order_id
        )
        db.add(item)
        
    # 4. Commit the entire transaction atomically
    db.commit()
    db.refresh(order)
    return order

@router.get("/{order_id}", response_model=SalesOrderRead)
def get_sales_order(order_id: str, db: Session = Depends(get_db)) -> SalesOrder:
    """
    Retrieve a specific sales order by ID, including its line items.
    """
    order = db.get(SalesOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Sales Order not found")
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
        
    db.commit()
    db.refresh(order)
    return order

# Note: No DELETE endpoint is provided in this router. 
# "Deletions" must be handled by sending a PATCH request with {"status": "CANCELLED"}.