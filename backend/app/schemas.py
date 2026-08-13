from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# BASE & SYSTEM MODELS
# ==========================================

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    status: str = Field(default='ACTIVE', max_length=20)
    department_id: str | None = Field(default=None, max_length=50)
    role_ids: list[str] = Field(default_factory=list)
    # Legacy single role (mapped into role_ids on create)
    role_id: str | None = Field(default=None, max_length=50)
    security_question: str | None = Field(default=None, min_length=1, max_length=255)
    security_answer: str | None = Field(default=None, min_length=1, max_length=128)

class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    status: str | None = Field(default=None, max_length=20)
    department_id: str | None = Field(default=None, max_length=50)
    role_ids: list[str] | None = None
    role_id: str | None = Field(default=None, max_length=50)
    security_question: str | None = Field(default=None, min_length=1, max_length=255)
    security_answer: str | None = Field(default=None, min_length=1, max_length=128)


class AuthRegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    security_question: str = Field(min_length=1, max_length=255)
    security_answer: str = Field(min_length=1, max_length=128)


class AuthLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AuthChangePasswordRequest(BaseModel):
    email: EmailStr
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthChangePasswordResponse(BaseModel):
    message: str = "Password updated successfully"


class AuthSecurityQuestionLookupRequest(BaseModel):
    email: EmailStr


class AuthSecurityQuestionLookupResponse(BaseModel):
    email: EmailStr
    security_question: str


class AuthResetPasswordRequest(BaseModel):
    email: EmailStr
    security_answer: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthResetPasswordResponse(BaseModel):
    message: str = "Password reset successfully"


class AuthSecurityQuestionsResponse(BaseModel):
    questions: list[str]


class UserRoleBrief(BaseModel):
    role_id: str
    role_name: str

class UserRead(ORMModel):
    id: UUID
    email: EmailStr
    full_name: str
    status: str = 'ACTIVE'
    department_id: str | None = None
    roles: list[UserRoleBrief] = Field(default_factory=list)
    role_id: str | None = None  # first role for backward compat
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
    account_code: str | None = None
    account_name: str | None = None

    @model_validator(mode="wrap")
    @classmethod
    def enrich_account_fields(cls, values: Any, handler):
        account = getattr(values, "account", None) if not isinstance(values, dict) else None
        model = handler(values)
        if account is not None:
            model.account_code = getattr(account, "account_code", None)
            model.account_name = getattr(account, "account_name", None)
        return model

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
    period: str | None = None
    posting_status: str | None = None
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    postings: list[LedgerPostingRead]



# ==========================================
# CATALOG MODELS - internal product
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


class ItemCreate(BaseModel):
    item_id: str = Field(max_length=50)
    customer_part_number: str = Field(max_length=50)
    description: str | None = None
    uom: str = Field(default="Each", max_length=20)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    on_hand_quantity: int = Field(default=0, ge=0)
    wip_quantity: int = Field(default=0, ge=0)
    is_outside_processed: bool = Field(default=False)
    is_purchase_item: bool = Field(default=False)
    is_subcontract_assembly: bool = Field(default=False)
    is_raw_material: bool = Field(default=False)

class ItemRead(ORMModel):
    item_id: str
    customer_part_number: str
    description: str | None
    uom: str
    unit_price: Decimal | None = None
    on_hand_quantity: int = 0
    wip_quantity: int = 0
    is_outside_processed: bool = False
    is_purchase_item: bool = False
    is_subcontract_assembly: bool = False
    is_raw_material: bool = False

class ItemUpdate(BaseModel):
    customer_part_number: str | None = Field(default=None, max_length=50)
    description: str | None = None
    uom: str | None = Field(default=None, max_length=20)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    on_hand_quantity: int | None = Field(default=None, ge=0)
    wip_quantity: int | None = Field(default=None, ge=0)
    is_outside_processed: bool | None = None
    is_purchase_item: bool | None = None
    is_subcontract_assembly: bool | None = None
    is_raw_material: bool | None = None



# ... (Keep all your other schemas the same, just update these below) ...

class SalesOrderItemCreate(BaseModel):
    # REMOVED: sales_order_id (The backend will assign this automatically)
    line_number: int
    item_id: str = Field(max_length=50)
    quantity_ordered: int = Field(gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=4)
    tax_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    total_amount: Decimal = Field(ge=0, decimal_places=2)

class SalesOrderItemRead(ORMModel):
    so_item_id: int
    sales_order_id: str
    line_number: int
    item_id: str
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
    status: str = Field(default="DRAFT", max_length=30)
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
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
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

# Predefined non-material (Labor / Outside Service) component codes.
# These are not real Products in the catalog, so they're validated against
# this fixed list rather than a foreign key to the products table.
LABOR_SERVICE_CODES: dict[str, str] = {
    "LABOR-ASSY": "Hours",
    "LABOR-INSP": "Hours",
    "LABOR-PACK": "Hours",
    "LABOR-SETUP": "Hours",
    "SVC-ANODIZE": "Lot",
    "SVC-PLATING": "Lot",
    "SVC-PAINT": "Lot",
    "SVC-HEATTREAT": "Lot",
}

from pydantic import model_validator


class ItemBOMComponentCreate(BaseModel):
    component_item_id: str | None = Field(default=None, max_length=50)
    component_code: str | None = Field(default=None, max_length=50)
    quantity_per: Decimal = Field(gt=0, decimal_places=4)
    item_type: Literal['Material', 'Labor', 'Outside Service'] = Field(default='Material')
    scrap_factor: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=4)
    yield_loss_percentage: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=4)

    @model_validator(mode='after')
    def _validate_component_ref(self) -> 'ItemBOMComponentCreate':
        if self.item_type == 'Material':
            if not self.component_item_id:
                raise ValueError('component_item_id is required when item_type is Material')
            if self.component_code:
                raise ValueError('component_code must not be set when item_type is Material')
        else:
            if not self.component_code:
                raise ValueError('component_code is required when item_type is Labor or Outside Service')
            if self.component_code not in LABOR_SERVICE_CODES:
                raise ValueError(f'component_code must be one of {sorted(LABOR_SERVICE_CODES)}')
            if self.component_item_id:
                raise ValueError('component_item_id must not be set when item_type is Labor or Outside Service')
        return self

class ItemBOMComponentUpdate(BaseModel):
    component_item_id: str | None = Field(default=None, max_length=50)
    component_code: str | None = Field(default=None, max_length=50)
    quantity_per: Decimal | None = Field(default=None, gt=0, decimal_places=4)
    item_type: Literal['Material', 'Labor', 'Outside Service'] | None = None
    scrap_factor: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    yield_loss_percentage: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=4)

    @model_validator(mode='after')
    def _validate_component_ref(self) -> 'ItemBOMComponentUpdate':
        if self.item_type == 'Material' and self.component_code:
            raise ValueError('component_code must not be set when item_type is Material')
        if self.item_type in ('Labor', 'Outside Service'):
            if self.component_code and self.component_code not in LABOR_SERVICE_CODES:
                raise ValueError(f'component_code must be one of {sorted(LABOR_SERVICE_CODES)}')
            if self.component_item_id:
                raise ValueError('component_item_id must not be set when item_type is Labor or Outside Service')
        return self

class ItemBOMComponentRead(ORMModel):
    bom_id: int
    parent_item_id: str
    component_item_id: str | None
    component_code: str | None = None
    quantity_per: Decimal
    item_type: str
    scrap_factor: Decimal = Decimal("0")
    yield_loss_percentage: Decimal = Decimal("0")
    created_at: datetime


class SubcontractOrderComponentRead(ORMModel):
    sco_component_id: int
    sco_number: str
    component_item_id: str
    quantity_required: Decimal
    quantity_issued: Decimal
    quantity_remaining: Decimal | None = None
    on_hand_quantity: int | None = None
    primary_vendor_id: str | None = None
    primary_vendor_sku: str | None = None
    description: str | None = None


class MaterialIssueLineCreate(BaseModel):
    component_item_id: str = Field(max_length=50)
    quantity_issued: Decimal = Field(gt=0, decimal_places=4)

class MaterialIssueLineRead(ORMModel):
    issue_line_id: int
    issue_id: str
    component_item_id: str
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
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=4)

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
    item_id: str = Field(max_length=50)
    quantity_ordered: int = Field(gt=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=4)
    order_date: date | None = None
    expected_return_date: date | None = None
    notes: str | None = None

class SubcontractOrderUpdate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=50)
    quantity_ordered: int | None = Field(default=None, gt=0)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    status: str | None = Field(default=None, max_length=30)
    expected_return_date: date | None = None
    notes: str | None = None

class SubcontractOrderRead(ORMModel):
    sco_number: str
    supplier_id: str
    item_id: str
    quantity_ordered: int
    unit_price: Decimal = Decimal("0")
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    billing_status: str = 'UNBILLED'
    order_date: date
    expected_return_date: date | None
    notes: str | None
    created_at: datetime
    components: list[SubcontractOrderComponentRead] = []
    material_issues: list[MaterialIssueRead] = []
    finished_goods_receipts: list[FinishedGoodsReceiptRead] = []


# ==========================================
# PROCUREMENT: PURCHASE ORDER MODELS
# ==========================================

class PurchaseOrderItemCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    quantity: Decimal = Field(gt=0, decimal_places=4)
    unit_price: Decimal = Field(ge=0, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=3)
    line_subtotal: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    line_tax: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    line_total: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)

class PurchaseOrderItemUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    quantity: Decimal | None = Field(default=None, gt=0, decimal_places=4)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=3)
    line_subtotal: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    line_tax: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    line_total: Decimal | None = Field(default=None, ge=0, decimal_places=2)

class PurchaseOrderItemRead(ORMModel):
    item_id: int
    po_number: str
    sku: str
    quantity: Decimal
    unit_price: Decimal
    tax_rate: Decimal
    line_subtotal: Decimal
    line_tax: Decimal
    line_total: Decimal


class PurchaseOrderCreate(BaseModel):
    po_number: str = Field(max_length=50)
    supplier_id: str = Field(max_length=50)
    order_date: date | None = None
    expected_delivery_date: date | None = None
    payment_terms: str | None = Field(default="Net 30", max_length=50)
    status: Literal['Draft', 'Submitted', 'Approved', 'Void'] = Field(default='Draft')

    shipping_fee: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    discount_type: Literal['percentage', 'fixed'] = Field(default='percentage')
    discount_value: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)

    subtotal: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    total_tax: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    grand_total: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)

    notes: str | None = None
    items: list[PurchaseOrderItemCreate] = Field(min_length=1)

class PurchaseOrderUpdate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=50)
    order_date: date | None = None
    expected_delivery_date: date | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    status: Literal['Draft', 'Submitted', 'Approved', 'Void'] | None = None

    shipping_fee: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    discount_type: Literal['percentage', 'fixed'] | None = None
    discount_value: Decimal | None = Field(default=None, ge=0, decimal_places=2)

    subtotal: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    total_tax: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    discount_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    grand_total: Decimal | None = Field(default=None, ge=0, decimal_places=2)

    notes: str | None = None
    items: list[PurchaseOrderItemCreate] | None = None

class PurchaseOrderRead(ORMModel):
    po_number: str
    supplier_id: str
    order_date: date
    expected_delivery_date: date | None
    payment_terms: str | None
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    billing_status: str = 'UNBILLED'

    shipping_fee: Decimal
    discount_type: str
    discount_value: Decimal

    subtotal: Decimal
    total_tax: Decimal
    discount_amount: Decimal
    grand_total: Decimal

    notes: str | None
    created_at: datetime | None
    items: list[PurchaseOrderItemRead] = []


# ==========================================
# FINANCE MODULE: AR / AP / CASH MANAGEMENT
# ==========================================

class ARInvoiceRead(ORMModel):
    invoice_id: str
    sales_order_id: str
    customer_id: str
    amount: Decimal
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    due_date: date
    created_at: datetime | None

class ARInvoiceCreate(BaseModel):
    invoice_id: str = Field(max_length=50)
    sales_order_id: str = Field(max_length=50)
    customer_id: str = Field(max_length=50)
    amount: Decimal = Field(gt=0, decimal_places=2)
    due_date: date


class APBillRead(ORMModel):
    bill_id: str
    purchase_order_id: str | None = None
    vendor_id: str
    supplier_invoice_id: int | None = None
    source_type: str | None = None
    source_order_id: str | None = None
    amount: Decimal
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    due_date: date
    created_at: datetime | None

class APBillCreate(BaseModel):
    bill_id: str = Field(max_length=50)
    purchase_order_id: str = Field(max_length=50)
    vendor_id: str = Field(max_length=50)
    amount: Decimal = Field(gt=0, decimal_places=2)
    due_date: date


class CashTransactionRead(ORMModel):
    transaction_id: str
    type: str
    reference_id: str
    amount: Decimal
    transaction_date: datetime | None
    bank_account_id: str | None
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None


class PaymentRequest(BaseModel):
    """Payload for AR invoice / AP bill payment actions."""
    transaction_id: str | None = Field(default=None, max_length=50)
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    bank_account_id: str | None = Field(default=None, max_length=50)


# ==========================================
# APPROVAL WORKFLOW / RBAC
# ==========================================

ApprovalStatus = Literal[
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'
]
ApprovalAction = Literal['SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'SUBMIT', 'APPROVE', 'DECLINE']


class ApprovalActionRequest(BaseModel):
    action: ApprovalAction | None = None  # optional when using dedicated endpoints
    comments: str | None = None


class ApprovalHistoryRead(ORMModel):
    id: int
    document_type: str | None = None
    document_id: str | None = None
    transaction_type: str | None = None
    transaction_id: str | None = None
    step_number: int | None = None
    step_name: str | None = None
    action: str
    performed_by_user_id: UUID | None = None
    actor_user_id: str | None = None
    actor_name: str | None = None
    comments: str | None = None
    created_at: datetime | None = None
    timestamp: datetime | None = None


class RoleRead(ORMModel):
    role_id: str
    role_name: str
    description: str | None
    created_at: datetime | None
    permissions: list[str] = Field(default_factory=list)


class RoleCreate(BaseModel):
    role_id: str = Field(max_length=50)
    role_name: str = Field(max_length=100)
    description: str | None = None
    permission_codes: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    role_name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    permission_codes: list[str] | None = None


class PermissionRead(ORMModel):
    id: str
    code: str
    module: str
    description: str | None = None


class PermissionCreate(BaseModel):
    id: str = Field(max_length=50)
    code: str = Field(max_length=100)
    module: str = Field(max_length=50)
    description: str | None = None


class PermissionUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=100)
    module: str | None = Field(default=None, max_length=50)
    description: str | None = None


class UserRolesAssign(BaseModel):
    role_ids: list[str]


class WorkflowStepCreate(BaseModel):
    id: str = Field(max_length=50)
    step_number: int = Field(ge=1)
    step_name: str = Field(max_length=100)
    required_role_id: str | None = None
    required_permission: str | None = None


class WorkflowStepRead(ORMModel):
    id: str
    step_number: int
    step_name: str
    required_role_id: str | None = None
    required_permission: str | None = None


class WorkflowDefinitionCreate(BaseModel):
    id: str = Field(max_length=50)
    module: str = Field(max_length=50)
    min_amount: Decimal = Decimal('0')
    max_amount: Decimal | None = None
    is_active: bool = True
    name: str | None = None
    steps: list[WorkflowStepCreate] = Field(default_factory=list)


class WorkflowDefinitionUpdate(BaseModel):
    module: str | None = Field(default=None, max_length=50)
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    is_active: bool | None = None
    name: str | None = None
    steps: list[WorkflowStepCreate] | None = None


class WorkflowDefinitionRead(ORMModel):
    id: str
    module: str
    min_amount: Decimal
    max_amount: Decimal | None
    is_active: bool
    name: str | None = None
    created_at: datetime | None = None
    steps: list[WorkflowStepRead] = Field(default_factory=list)


class TransactionActionResult(BaseModel):
    id: str
    type: str
    approval_status: str | None = None
    current_approval_step: int | None = None
    workflow_id: str | None = None
    pending_step_name: str | None = None
    message: str | None = None


class CurrentUserRead(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    status: str = 'ACTIVE'
    department_id: str | None = None
    department_name: str | None = None
    roles: list[UserRoleBrief] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    has_security_question: bool = False
    # Legacy fields
    role_id: str | None = None
    role_name: str | None = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: CurrentUserRead



# ==========================================
# INVENTORY & WAREHOUSE MANAGEMENT
# ==========================================

class WarehouseCreate(BaseModel):
    warehouse_id: str = Field(max_length=50)
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=20)
    address: str | None = Field(default=None, max_length=255)
    is_active: bool = True

class WarehouseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, min_length=1, max_length=20)
    address: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None

class WarehouseRead(ORMModel):
    warehouse_id: str
    name: str
    code: str
    address: str | None
    is_active: bool
    created_at: datetime | None


class BinLocationCreate(BaseModel):
    bin_id: str = Field(max_length=50)
    warehouse_id: str = Field(max_length=50)
    bin_code: str = Field(min_length=1, max_length=50)
    description: str | None = None
    is_active: bool = True

class BinLocationUpdate(BaseModel):
    bin_code: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = None
    is_active: bool | None = None

class BinLocationRead(ORMModel):
    bin_id: str
    warehouse_id: str
    warehouse_code: str | None = None
    bin_code: str
    description: str | None
    is_active: bool
    created_at: datetime | None


class InventoryStockCreate(BaseModel):
    stock_id: str = Field(max_length=50)
    item_id: str = Field(max_length=50)
    warehouse_id: str = Field(max_length=50)
    bin_id: str = Field(max_length=50)
    on_hand_quantity: int = Field(default=0, ge=0)
    allocated_quantity: int = Field(default=0, ge=0)
    on_order_quantity: int = Field(default=0, ge=0)
    reorder_point: int = Field(default=0, ge=0)
    is_primary: bool = False

class InventoryStockItemRead(BaseModel):
    """Aggregated product-level stock view for the Inventory Overview UI."""
    item_id: str
    description: str | None = None
    uom: str = "Each"
    on_hand_quantity: int
    allocated_quantity: int
    on_order_quantity: int
    available_to_promise: int
    reorder_point: int
    status: Literal['In Stock', 'Low Stock', 'Out of Stock']
    primary_warehouse_id: str
    primary_warehouse_code: str
    primary_bin_code: str


class StockMovementCreate(BaseModel):
    movement_id: str = Field(max_length=50)
    item_id: str = Field(max_length=50)
    movement_type: Literal['Receipt', 'Issue', 'Adjustment', 'Transfer']
    quantity: int
    warehouse_id: str = Field(max_length=50)
    bin_id: str = Field(max_length=50)
    reference: str | None = Field(default=None, max_length=50)
    notes: str | None = None
    movement_date: date | None = None

class StockMovementRead(ORMModel):
    movement_id: str
    item_id: str
    movement_type: str
    quantity: int
    warehouse_id: str
    warehouse_code: str | None = None
    bin_id: str
    bin_code: str | None = None
    reference: str | None
    notes: str | None
    movement_date: date
    created_at: datetime | None


class StockAdjustRequest(BaseModel):
    item_id: str = Field(max_length=50)
    quantity_delta: int
    notes: str | None = None
    warehouse_id: str | None = Field(default=None, max_length=50)
    bin_id: str | None = Field(default=None, max_length=50)

class StockTransferRequest(BaseModel):
    item_id: str = Field(max_length=50)
    quantity: int = Field(gt=0)
    to_warehouse_id: str = Field(max_length=50)
    to_bin_id: str = Field(max_length=50)
    from_warehouse_id: str | None = Field(default=None, max_length=50)
    from_bin_id: str | None = Field(default=None, max_length=50)
    notes: str | None = None



# ==========================================
# ITEM CATALOG / VENDOR MAPPING / SUBCONTRACT BOM
# ==========================================

# Backward-compatible aliases
ProductCreate = ItemCreate
ProductRead = ItemRead
ProductUpdate = ItemUpdate
ProductBOMComponentCreate = ItemBOMComponentCreate
ProductBOMComponentUpdate = ItemBOMComponentUpdate
ProductBOMComponentRead = ItemBOMComponentRead


class VendorItemMappingCreate(BaseModel):
    supplier_id: str = Field(max_length=50)
    item_id: str = Field(max_length=50)
    vendor_sku: str | None = Field(default=None, max_length=100)
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    minimum_order_qty: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=4)
    lead_time_days: int = Field(default=0, ge=0)
    is_primary_vendor: bool = False


class VendorItemMappingUpdate(BaseModel):
    vendor_sku: str | None = Field(default=None, max_length=100)
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    minimum_order_qty: Decimal | None = Field(default=None, gt=0, decimal_places=4)
    lead_time_days: int | None = Field(default=None, ge=0)
    is_primary_vendor: bool | None = None


class VendorItemMappingRead(ORMModel):
    mapping_id: int
    supplier_id: str
    item_id: str
    vendor_sku: str | None
    unit_cost: Decimal | None
    minimum_order_qty: Decimal
    lead_time_days: int
    is_primary_vendor: bool
    created_at: datetime | None = None
    supplier_name: str | None = None
    item_description: str | None = None


class SubcontractBOMLineCreate(BaseModel):
    """Material kit line for a subcontract assembly (stored in ProductBOMComponents)."""

    assembly_item_id: str = Field(max_length=50)
    component_item_id: str = Field(max_length=50)
    quantity_required: Decimal = Field(gt=0, decimal_places=4)
    scrap_factor: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=4)
    yield_loss_percentage: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=4)


class SubcontractBOMLineRead(ORMModel):
    bom_id: int
    assembly_item_id: str
    component_item_id: str | None
    quantity_required: Decimal
    scrap_factor: Decimal = Decimal("0")
    yield_loss_percentage: Decimal = Decimal("0")
    component_description: str | None = None
    is_purchase_item: bool | None = None
    is_raw_material: bool | None = None
    primary_vendor_id: str | None = None
    primary_vendor_sku: str | None = None
    unit_cost: Decimal | None = None


class SubcontractBOMRead(ORMModel):
    assembly_item_id: str
    assembly_description: str | None = None
    is_subcontract_assembly: bool = False
    components: list[SubcontractBOMLineRead] = []


class CalculatedComponentLine(BaseModel):
    component_item_id: str
    description: str | None = None
    quantity_per: Decimal
    scrap_factor: Decimal = Decimal("0")
    yield_loss_percentage: Decimal = Decimal("0")
    quantity_required: Decimal
    quantity_issued: Decimal = Decimal("0")
    quantity_remaining: Decimal = Decimal("0")
    on_hand_quantity: int = 0
    primary_vendor_id: str | None = None
    primary_vendor_sku: str | None = None
    unit_cost: Decimal | None = None


class CalculateComponentsResponse(BaseModel):
    sco_number: str
    assembly_item_id: str
    quantity_ordered: int
    components: list[CalculatedComponentLine]


class ComponentIssueLogRead(ORMModel):
    log_id: int
    sco_number: str
    issue_id: str
    component_item_id: str
    quantity_issued: Decimal
    issued_at: datetime | None = None
    notes: str | None = None


# ==========================================
# ORDER-TO-CASH: FULFILLMENTS & SALES INVOICES
# ==========================================

class ItemFulfillmentLineCreate(BaseModel):
    sales_order_line_id: int
    quantity_fulfilled: int = Field(gt=0)


class ItemFulfillmentCreate(BaseModel):
    sales_order_id: str = Field(min_length=1, max_length=50)
    carrier: str | None = Field(default=None, max_length=100)
    tracking_number: str | None = Field(default=None, max_length=100)
    status: str = Field(default='DRAFT', max_length=20)
    lines: list[ItemFulfillmentLineCreate] = Field(min_length=1)


class ItemFulfillmentStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    shipped_date: date | None = None
    carrier: str | None = Field(default=None, max_length=100)
    tracking_number: str | None = Field(default=None, max_length=100)


class ItemFulfillmentLineRead(BaseModel):
    id: int
    fulfillment_id: int
    sales_order_line_id: int
    item_id: str
    quantity_fulfilled: int


class ItemFulfillmentRead(BaseModel):
    id: int
    fulfillment_number: str
    sales_order_id: str
    customer_id: str
    customer_name: str | None = None
    status: str
    shipped_date: date | None = None
    carrier: str | None = None
    tracking_number: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    lines: list[ItemFulfillmentLineRead] = Field(default_factory=list)


class SalesInvoiceLineCreate(BaseModel):
    item_id: str
    description: str | None = None
    quantity: int = Field(gt=0)
    unit_price: Decimal


class SalesInvoiceCreate(BaseModel):
    sales_order_id: str = Field(min_length=1, max_length=50)
    fulfillment_id: int | None = None
    issue_date: date | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    lines: list[SalesInvoiceLineCreate] | None = None


class SalesInvoiceLineRead(BaseModel):
    id: int
    invoice_id: int
    item_id: str
    description: str | None = None
    quantity: int
    unit_price: Decimal
    line_subtotal: Decimal


class SalesInvoiceRead(BaseModel):
    id: int
    invoice_number: str
    sales_order_id: str
    fulfillment_id: int | None = None
    customer_id: str
    customer_name: str | None = None
    status: str
    issue_date: date
    due_date: date
    payment_terms: str | None = None
    subtotal: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    outstanding_balance: Decimal
    ar_invoice_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    lines: list[SalesInvoiceLineRead] = Field(default_factory=list)


# ==========================================
# PROCURE-TO-PAY: GOODS RECEIPTS & SUPPLIER INVOICES
# ==========================================


class GoodsReceiptLineCreate(BaseModel):
    source_line_id: int
    quantity_received: Decimal = Field(gt=0)
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=4)


class GoodsReceiptCreate(BaseModel):
    receipt_date: date | None = None
    notes: str | None = None
    lines: list[GoodsReceiptLineCreate] = Field(min_length=1)


class GoodsReceiptLineRead(BaseModel):
    id: int
    receipt_id: int
    source_line_id: int | None = None
    item_id: str
    description: str | None = None
    quantity_received: Decimal
    unit_cost: Decimal
    line_amount: Decimal


class GoodsReceiptRead(BaseModel):
    id: int
    receipt_number: str
    source_type: str
    source_order_id: str
    vendor_id: str
    receipt_date: date
    status: str
    notes: str | None = None
    created_at: datetime | None = None
    lines: list[GoodsReceiptLineRead] = Field(default_factory=list)


class SupplierInvoiceLineCreate(BaseModel):
    source_line_id: int | None = None
    item_id: str | None = None
    description: str | None = None
    quantity_billed: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=4)


class SupplierInvoiceCreate(BaseModel):
    source_type: Literal["PURCHASE_ORDER", "SUBCONTRACT_ORDER"]
    source_order_id: str = Field(min_length=1, max_length=50)
    vendor_invoice_number: str | None = Field(default=None, max_length=100)
    invoice_date: date | None = None
    due_date: date | None = None
    tax_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    freight_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    lines: list[SupplierInvoiceLineCreate] | None = None


class SupplierInvoiceLineRead(BaseModel):
    id: int
    invoice_id: int
    source_line_id: int | None = None
    item_id: str
    description: str | None = None
    quantity_billed: Decimal
    unit_price: Decimal
    line_subtotal: Decimal
    goods_receipt_line_id: int | None = None


class SupplierInvoiceRead(BaseModel):
    id: int
    invoice_number: str
    vendor_id: str
    vendor_name: str | None = None
    source_type: str
    source_order_id: str
    vendor_invoice_number: str | None = None
    invoice_date: date
    due_date: date
    status: str
    subtotal: Decimal
    tax_amount: Decimal
    freight_amount: Decimal
    total_amount: Decimal
    outstanding_balance: Decimal
    currency: str
    ap_bill_id: str | None = None
    match_warnings: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    lines: list[SupplierInvoiceLineRead] = Field(default_factory=list)
    payment_transaction_id: str | None = None


class SupplierInvoicePayRequest(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    bank_account_id: str | None = Field(default=None, max_length=50)
