from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# BASE & SYSTEM MODELS
# ==========================================

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)

class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=255)

class UserRead(ORMModel):
    id: UUID
    email: EmailStr
    full_name: str
    created_at: datetime


class AuditLogCreate(BaseModel):
    table_name: str = Field(min_length=1, max_length=50)
    record_id: UUID
    action: str = Field(min_length=1, max_length=10)
    old_data: dict[str, Any] | None = None
    new_data: dict[str, Any] | None = None
    user_id: UUID | None = None

class AuditLogUpdate(BaseModel):
    table_name: str | None = Field(default=None, min_length=1, max_length=50)
    record_id: UUID | None = None
    action: str | None = Field(default=None, min_length=1, max_length=10)
    old_data: dict[str, Any] | None = None
    new_data: dict[str, Any] | None = None
    user_id: UUID | None = None

class AuditLogRead(ORMModel):
    id: int
    table_name: str
    record_id: UUID
    action: str
    old_data: dict[str, Any] | None
    new_data: dict[str, Any] | None
    user_id: UUID | None
    changed_at: datetime


# ==========================================
# FINANCIAL & LEDGER MODELS
# ==========================================

class ChartOfAccountCreate(BaseModel):
    account_code: str = Field(min_length=1, max_length=50)
    account_name: str = Field(min_length=1, max_length=255)
    account_type: str = Field(min_length=1, max_length=50)

class ChartOfAccountUpdate(BaseModel):
    account_code: str | None = Field(default=None, min_length=1, max_length=50)
    account_name: str | None = Field(default=None, min_length=1, max_length=255)
    account_type: str | None = Field(default=None, min_length=1, max_length=50)

class ChartOfAccountRead(ORMModel):
    id: UUID
    account_code: str
    account_name: str
    account_type: str
    created_at: datetime


class LedgerPostingLineCreate(BaseModel):
    account_id: UUID
    debit: Decimal = Field(default=Decimal("0.0000"), ge=0, decimal_places=4)
    credit: Decimal = Field(default=Decimal("0.0000"), ge=0, decimal_places=4)
    currency: str = Field(default="USD", min_length=3, max_length=3)

class LedgerPostingRead(ORMModel):
    id: UUID
    entry_id: UUID
    account_id: UUID
    debit: Decimal
    credit: Decimal
    currency: str

class LedgerPostingCreate(BaseModel):
    entry_id: UUID
    account_id: UUID
    debit: Decimal = Field(default=Decimal("0.0000"), ge=0, decimal_places=4)
    credit: Decimal = Field(default=Decimal("0.0000"), ge=0, decimal_places=4)
    currency: str = Field(default="USD", min_length=3, max_length=3)

class LedgerPostingUpdate(BaseModel):
    account_id: UUID | None = None
    debit: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    credit: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    currency: str | None = Field(default=None, min_length=3, max_length=3)

class JournalEntryCreate(BaseModel):
    description: str = Field(min_length=1)
    posted_by_user_id: UUID | None = None
    postings: list[LedgerPostingLineCreate] = Field(min_length=2)

class JournalEntryUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1)
    posted_by_user_id: UUID | None = None
    # Usually, we don't update postings directly through the entry to maintain audit trails

class JournalEntryRead(ORMModel):
    id: UUID
    created_at: datetime
    description: str
    posted_by_user_id: UUID | None
    postings: list[LedgerPostingRead]


# ==========================================
# CATALOG MODELS - internal product
# ==========================================

class ProductBaseCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)
    unit_price: Decimal = Field(gt=0, decimal_places=2)
    stock_quantity: int = Field(default=0, ge=0)

class ProductBaseUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    unit_price: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    stock_quantity: int | None = Field(default=None, ge=0)

class ProductBaseRead(ORMModel):
    id: UUID
    sku: str
    name: str
    unit_price: Decimal
    stock_quantity: int
    created_at: datetime

# ==========================================
# CRM & SALES MODELS (String-Based Keys)
# ==========================================
class CustomerCreate(BaseModel):
    customer_id: str = Field(max_length=50)
    customer_number_ext: str | None = Field(default=None, max_length=50)
    company_name: str = Field(min_length=1, max_length=255)

class CustomerUpdate(BaseModel):
    customer_number_ext: str | None = Field(default=None, max_length=50)
    company_name: str | None = Field(default=None, min_length=1, max_length=255)

class CustomerRead(ORMModel):
    customer_id: str
    customer_number_ext: str | None
    company_name: str

class CustomerLocationCreate(BaseModel):
    location_id: str = Field(max_length=50)
    customer_id: str = Field(max_length=50)
    location_type: Literal['BILL_TO', 'SHIP_TO', 'BOTH']
    location_name: str | None = Field(default=None, max_length=100)
    attention_to: str | None = Field(default=None, max_length=100)
    address_line1: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=50)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=50)
    contact_email: EmailStr | None = None

class CustomerLocationUpdate(BaseModel):
    location_type: Literal['BILL_TO', 'SHIP_TO', 'BOTH'] | None = None
    location_name: str | None = Field(default=None, max_length=100)
    attention_to: str | None = Field(default=None, max_length=100)
    address_line1: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=50)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=50)
    contact_email: EmailStr | None = None

class CustomerLocationRead(ORMModel):
    location_id: str
    customer_id: str
    location_type: str
    location_name: str | None
    attention_to: str | None
    address_line1: str | None
    city: str | None
    state: str | None
    postal_code: str | None
    country: str | None
    contact_email: EmailStr | None


class ProductCreate(BaseModel):
    product_id: str = Field(max_length=50)
    customer_part_number: str = Field(max_length=50)
    description: str | None = None
    uom: str = Field(default="Each", max_length=20)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    on_hand_quantity: int = Field(default=0, ge=0)
    wip_quantity: int = Field(default=0, ge=0)

class ProductRead(ORMModel):
    product_id: str
    customer_part_number: str
    description: str | None
    uom: str
    unit_price: Decimal | None = None
    on_hand_quantity: int = 0
    wip_quantity: int = 0

class ProductUpdate(BaseModel):
    customer_part_number: str | None = Field(default=None, max_length=50)
    description: str | None = None
    uom: str | None = Field(default=None, max_length=20)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    on_hand_quantity: int | None = Field(default=None, ge=0)
    wip_quantity: int | None = Field(default=None, ge=0)


# ... (Keep all your other schemas the same, just update these below) ...

class SalesOrderItemCreate(BaseModel):
    # REMOVED: sales_order_id (The backend will assign this automatically)
    line_number: int
    product_id: str = Field(max_length=50)
    quantity_ordered: int = Field(gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=4)
    tax_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    total_amount: Decimal = Field(ge=0, decimal_places=2)

class SalesOrderItemRead(ORMModel):
    so_item_id: int
    sales_order_id: str
    line_number: int
    product_id: str
    quantity_ordered: int
    unit_price: Decimal
    tax_amount: Decimal
    total_amount: Decimal

class SalesOrderCreate(BaseModel):
    sales_order_id: str = Field(max_length=50)
    customer_id: str = Field(max_length=50)
    # NEW: Link to the specific locations for this order
    bill_to_location_id: str = Field(max_length=50)
    ship_to_location_id: str = Field(max_length=50)
    customer_po_number: str = Field(max_length=50)
    po_revision_number: int = Field(default=0)
    order_date: date
    payment_terms: str | None = Field(default=None, max_length=50)
    freight_terms: str | None = Field(default=None, max_length=50)
    shipping_method: str | None = Field(default=None, max_length=50)
    currency: str = Field(default="USD", max_length=3)
    buyer_contact_name: str | None = Field(default=None, max_length=100)
    buyer_contact_email: EmailStr | None = None
    status: str = Field(default="RECEIVED", max_length=30)
    total_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    
    # NEW: Nested items array required for creation
    items: list[SalesOrderItemCreate] = Field(min_length=1)

# ... (Keep SalesOrderUpdate the same) ...
class SalesOrderUpdate(BaseModel):
    bill_to_location_id: str | None = Field(default=None, max_length=50)
    ship_to_location_id: str | None = Field(default=None, max_length=50)
    customer_po_number: str | None = Field(default=None, max_length=50)
    po_revision_number: int | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    freight_terms: str | None = Field(default=None, max_length=50)
    shipping_method: str | None = Field(default=None, max_length=50)
    buyer_contact_name: str | None = Field(default=None, max_length=100)
    buyer_contact_email: EmailStr | None = None
    status: str | None = Field(default=None, max_length=30)
    total_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    
class SalesOrderRead(ORMModel):
    sales_order_id: str
    customer_id: str
    # NEW: Link to the specific locations for this order
    bill_to_location_id: str = Field(max_length=50)
    ship_to_location_id: str = Field(max_length=50)
    customer_po_number: str
    po_revision_number: int
    order_date: date
    payment_terms: str | None
    freight_terms: str | None
    shipping_method: str | None
    currency: str
    buyer_contact_name: str | None
    buyer_contact_email: EmailStr | None
    status: str
    total_amount: Decimal
    created_at: datetime | None
    
    # NEW: When we fetch an order, return its items too
    items: list[SalesOrderItemRead] = []

class OrderDeliveryScheduleCreate(BaseModel):
    so_item_id: int
    sub_line_number: str | None = Field(default=None, max_length=10)
    ship_to_location_id: str | None = Field(default=None, max_length=50)
    scheduled_quantity: int = Field(gt=0)
    needed_delivery_date: datetime
    promised_ship_date: datetime | None = None
    requester_name: str | None = Field(default=None, max_length=100)
    tax_flag: str = Field(default="N", max_length=1)
    status: str = Field(default="PENDING", max_length=30)

class OrderDeliveryScheduleRead(ORMModel):
    schedule_id: int
    so_item_id: int
    sub_line_number: str | None
    ship_to_location_id: str | None
    scheduled_quantity: int
    needed_delivery_date: datetime
    promised_ship_date: datetime | None
    requester_name: str | None
    tax_flag: str
    status: str

class SupplierBase(BaseModel):
    company_name: str = Field(min_length=1, max_length=255)
    contact_name: str | None = Field(default=None, max_length=100)
    contact_email: EmailStr | None = None
    phone_number: str | None = Field(default=None, max_length=50)
    address_line1: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=50)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=50)
    vendor_number_ext: str | None = Field(default=None, max_length=50)
    payment_terms: str | None = Field(default="Net 30", max_length=50)
    status: str | None = Field(default="Active", max_length=20)


class SupplierCreate(SupplierBase):
    supplier_id: str = Field(max_length=50)

class SupplierUpdate(BaseModel):
    company_name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_name: str | None = Field(default=None, max_length=100)
    contact_email: EmailStr | None = None
    phone_number: str | None = Field(default=None, max_length=50)
    address_line1: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=50)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=50)
    vendor_number_ext: str | None = Field(default=None, max_length=50)
    payment_terms: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, max_length=20)


class SupplierRead(SupplierBase):
    supplier_id: str

    model_config = {"from_attributes": True} # Use `class Config: orm_mode = True` if using Pydantic V1


# ==========================================
# SUBCONTRACTING / OUTSIDE PROCESSING MODELS
# ==========================================

class ProductBOMComponentCreate(BaseModel):
    component_product_id: str = Field(max_length=50)
    quantity_per: Decimal = Field(gt=0, decimal_places=4)

class ProductBOMComponentRead(ORMModel):
    bom_id: int
    parent_product_id: str
    component_product_id: str
    quantity_per: Decimal
    created_at: datetime


class SubcontractOrderComponentRead(ORMModel):
    sco_component_id: int
    sco_number: str
    component_product_id: str
    quantity_required: Decimal
    quantity_issued: Decimal


class MaterialIssueLineCreate(BaseModel):
    component_product_id: str = Field(max_length=50)
    quantity_issued: Decimal = Field(gt=0, decimal_places=4)

class MaterialIssueLineRead(ORMModel):
    issue_line_id: int
    issue_id: str
    component_product_id: str
    quantity_issued: Decimal


class MaterialIssueCreate(BaseModel):
    issue_id: str = Field(max_length=50)
    issue_date: date | None = None
    notes: str | None = None
    lines: list[MaterialIssueLineCreate] = Field(min_length=1)

class MaterialIssueRead(ORMModel):
    issue_id: str
    sco_number: str
    issue_date: date
    notes: str | None
    created_at: datetime
    lines: list[MaterialIssueLineRead] = []


class FinishedGoodsReceiptCreate(BaseModel):
    receipt_id: str = Field(max_length=50)
    quantity_received: int = Field(gt=0)
    receipt_date: date | None = None
    notes: str | None = None

class FinishedGoodsReceiptRead(ORMModel):
    receipt_id: str
    sco_number: str
    quantity_received: int
    receipt_date: date
    notes: str | None
    created_at: datetime


class SubcontractOrderCreate(BaseModel):
    sco_number: str = Field(max_length=50)
    supplier_id: str = Field(max_length=50)
    product_id: str = Field(max_length=50)
    quantity_ordered: int = Field(gt=0)
    order_date: date | None = None
    expected_return_date: date | None = None
    notes: str | None = None

class SubcontractOrderUpdate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=50)
    quantity_ordered: int | None = Field(default=None, gt=0)
    status: str | None = Field(default=None, max_length=30)
    expected_return_date: date | None = None
    notes: str | None = None

class SubcontractOrderRead(ORMModel):
    sco_number: str
    supplier_id: str
    product_id: str
    quantity_ordered: int
    status: str
    order_date: date
    expected_return_date: date | None
    notes: str | None
    created_at: datetime
    components: list[SubcontractOrderComponentRead] = []
    material_issues: list[MaterialIssueRead] = []
    finished_goods_receipts: list[FinishedGoodsReceiptRead] = []
