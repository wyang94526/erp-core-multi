import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    String,
    Integer,
    Numeric,
    DateTime,
    ForeignKey,
    Text,
    CHAR,
    BigInteger,
    Date,
    CheckConstraint,
    UniqueConstraint,
    text,
)


from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ========================================================
# 1. BASE TABLES
# ========================================================

APPROVAL_STATUSES = (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
)


class Department(Base):
    __tablename__ = 'departments'

    id = Column(String(50), primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    users = relationship("User", back_populates="department")


class Role(Base):
    __tablename__ = 'roles'

    role_id = Column(String(50), primary_key=True)
    role_name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    users = relationship("User", secondary="user_roles", back_populates="roles")
    permissions = relationship("Permission", secondary="role_permissions", back_populates="roles")
    workflow_steps = relationship("WorkflowStep", back_populates="required_role")


class Permission(Base):
    __tablename__ = 'permissions'

    id = Column(String(50), primary_key=True)
    code = Column(String(100), unique=True, nullable=False)
    module = Column(String(50), nullable=False)
    description = Column(Text)

    roles = relationship("Role", secondary="role_permissions", back_populates="permissions")


class RolePermission(Base):
    __tablename__ = 'role_permissions'

    role_id = Column(String(50), ForeignKey('roles.role_id', ondelete='CASCADE'), primary_key=True)
    permission_id = Column(String(50), ForeignKey('permissions.id', ondelete='CASCADE'), primary_key=True)


class UserRole(Base):
    __tablename__ = 'user_roles'

    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    role_id = Column(String(50), ForeignKey('roles.role_id', ondelete='CASCADE'), primary_key=True)


class User(Base):
    __tablename__ = 'users'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    security_question = Column(String(255), nullable=True)
    security_answer_hash = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, server_default=text("'ACTIVE'"))
    department_id = Column(String(50), ForeignKey('departments.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text('NOW()'),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    department = relationship("Department", back_populates="users")
    roles = relationship("Role", secondary="user_roles", back_populates="users")


class SecurityQuestionOption(Base):
    """Admin-managed catalog of security questions users can choose from."""

    __tablename__ = 'security_question_options'

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_text = Column(String(255), unique=True, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text('true'))
    sort_order = Column(Integer, nullable=False, server_default=text('0'))
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))


class WorkflowDefinition(Base):
    __tablename__ = 'workflow_definition'

    id = Column(String(50), primary_key=True)
    module = Column(String(50), nullable=False)
    min_amount = Column(Numeric(14, 2), nullable=False, server_default=text('0'))
    max_amount = Column(Numeric(14, 2), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text('true'))
    name = Column(String(100))
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    steps = relationship(
        "WorkflowStep",
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by="WorkflowStep.step_number",
    )


class WorkflowStep(Base):
    __tablename__ = 'workflow_step'

    id = Column(String(50), primary_key=True)
    workflow_definition_id = Column(
        String(50), ForeignKey('workflow_definition.id', ondelete='CASCADE'), nullable=False
    )
    step_number = Column(Integer, nullable=False)
    step_name = Column(String(100), nullable=False)
    required_role_id = Column(String(50), ForeignKey('roles.role_id'), nullable=True)
    required_permission = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint('workflow_definition_id', 'step_number'),
        CheckConstraint(
            'required_role_id IS NOT NULL OR required_permission IS NOT NULL',
            name='chk_workflow_step_gate',
        ),
    )

    workflow = relationship("WorkflowDefinition", back_populates="steps")
    required_role = relationship("Role", back_populates="workflow_steps")


class ApprovalAuditLog(Base):
    """Transaction approval audit trail (formerly approval_history)."""

    __tablename__ = 'approval_audit_log'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    document_type = Column(String(50), nullable=False)
    document_id = Column(String(50), nullable=False)
    step_number = Column(Integer, nullable=True)
    action = Column(String(20), nullable=False)  # SUBMITTED | APPROVED | REJECTED | DELEGATED
    performed_by_user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'))
    comments = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    __table_args__ = (
        CheckConstraint(
            "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED')",
            name='chk_approval_audit_action',
        ),
    )

    performed_by = relationship("User")


# Backward-compatible alias
ApprovalHistory = ApprovalAuditLog


class ChartOfAccount(Base):
    __tablename__ = 'chart_of_accounts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_code = Column(String(50), unique=True, nullable=False)
    account_name = Column(String(255), nullable=False)
    account_type = Column(String(50), nullable=False) # Asset, Liability, Equity, Revenue, Expense
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))


class AuditLog(Base):
    __tablename__ = 'audit_logs'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    table_name = Column(String(50), nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(String(10), nullable=False)
    old_data = Column(JSONB)
    new_data = Column(JSONB)
    user_id = Column(UUID(as_uuid=True))
    changed_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

# ========================================================
# 2. FINANCIAL & LEDGER TABLES
# ========================================================

class JournalEntry(Base):
    __tablename__ = 'journal_entries'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    description = Column(Text, nullable=False)
    posted_by_user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'))

    # Finance module additions: accounting period (YYYY-MM) and posting workflow status
    period = Column(String(7), nullable=True)  # e.g. '2026-08'
    posting_status = Column(String(20), nullable=False, server_default=text("'Posted'"))  # 'Draft' or 'Posted'
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)

    # Relationships
    user = relationship("User")
    postings = relationship("LedgerPosting", back_populates="entry")



class LedgerPosting(Base):
    __tablename__ = 'ledger_postings'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id = Column(UUID(as_uuid=True), ForeignKey('journal_entries.id', ondelete="RESTRICT"))
    account_id = Column(UUID(as_uuid=True), ForeignKey('chart_of_accounts.id'))
    debit = Column(Numeric(15, 4), default=0.0000)
    credit = Column(Numeric(15, 4), default=0.0000)
    currency = Column(String(3), default='USD')

    __table_args__ = (
        CheckConstraint(
            '(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)',
            name='check_balanced_line'
        ),
    )

    # Relationships
    entry = relationship("JournalEntry", back_populates="postings")
    account = relationship("ChartOfAccount")

# ========================================================
# 3. CRM & SALES TABLES (Capitalized Table Names in SQL)
# ========================================================

class Customer(Base):
    __tablename__ = 'customers'

    customer_id = Column(String(50), primary_key=True)
    customer_number_ext = Column(String(50))
    company_name = Column(String(255), nullable=False)
    # Note: billing fields have been removed as they are now in CustomerLocation

class CustomerLocation(Base):
    __tablename__ = 'customerlocations'

    location_id = Column(String(50), primary_key=True)
    customer_id = Column(String(50), ForeignKey('customers.customer_id', ondelete='CASCADE'))
    location_type = Column(String(20), nullable=False) # 'BILL_TO', 'SHIP_TO', or 'BOTH'
    location_name = Column(String(100))
    attention_to = Column(String(100))
    address_line1 = Column(String(255))
    city = Column(String(100))
    state = Column(String(50))
    postal_code = Column(String(20))
    country = Column(String(50))
    contact_email = Column(String(150))

    __table_args__ = (
        CheckConstraint(
            "location_type IN ('BILL_TO', 'SHIP_TO', 'BOTH')",
            name='chk_location_type'
        ),
    )

    # Relationships
    customer = relationship("Customer")

class Item(Base):
    __tablename__ = 'items'

    item_id = Column(String(50), primary_key=True)
    customer_part_number = Column(String(50), nullable=False)
    description = Column(Text)
    uom = Column(String(20), default='Each')
    unit_price = Column(Numeric(12, 2), nullable=True)
    on_hand_quantity = Column(Integer, default=0)
    wip_quantity = Column(Integer, default=0)
    is_outside_processed = Column(Boolean, nullable=False, server_default=text('false'))
    is_purchase_item = Column(Boolean, nullable=False, server_default=text('false'))
    is_subcontract_assembly = Column(Boolean, nullable=False, server_default=text('false'))
    is_raw_material = Column(Boolean, nullable=False, server_default=text('false'))

    vendor_mappings = relationship("VendorItemMapping", back_populates="item", cascade="all, delete-orphan")
    bom_components = relationship(
        "ItemBOMComponent",
        foreign_keys="ItemBOMComponent.parent_item_id",
        back_populates="parent_item",
        cascade="all, delete-orphan",
    )



class SalesOrder(Base):
    __tablename__ = 'salesorders'

    sales_order_id = Column(String(50), primary_key=True)
    customer_id = Column(String(50), ForeignKey('customers.customer_id'))
    
    # Updated Foreign Keys mapping to the unified CustomerLocation table
    bill_to_location_id = Column(String(50), ForeignKey('customerlocations.location_id'))
    ship_to_location_id = Column(String(50), ForeignKey('customerlocations.location_id'))
    
    customer_po_number = Column(String(50), nullable=False)
    po_revision_number = Column(Integer, default=0)
    order_date = Column(Date, nullable=False)
    
    payment_terms = Column(String(50))
    freight_terms = Column(String(50))
    shipping_method = Column(String(50))
    currency = Column(String(3), default='USD')
    
    buyer_contact_name = Column(String(100))
    buyer_contact_email = Column(String(150))
    
    status = Column(String(30), default='DRAFT')
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    total_amount = Column(Numeric(12, 2), nullable=False)
    
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    customer = relationship("Customer")
    bill_to_location = relationship("CustomerLocation", foreign_keys=[bill_to_location_id])
    ship_to_location = relationship("CustomerLocation", foreign_keys=[ship_to_location_id])
    items = relationship("SalesOrderItem", back_populates="sales_order")

class SalesOrderItem(Base):
    __tablename__ = 'salesorderitems'

    so_item_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sales_order_id = Column(String(50), ForeignKey('salesorders.sales_order_id'))
    line_number = Column(Integer, nullable=False)
    item_id = Column(String(50), ForeignKey('items.item_id'))
    
    quantity_ordered = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 4), nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0.00)
    total_amount = Column(Numeric(12, 2), nullable=False)

    # Relationships
    sales_order = relationship("SalesOrder", back_populates="items")
    item = relationship("Item")
    schedules = relationship("OrderDeliverySchedule", back_populates="order_item")

class OrderDeliverySchedule(Base):
    __tablename__ = 'orderdeliveryschedules'

    schedule_id = Column(BigInteger, primary_key=True, autoincrement=True)
    so_item_id = Column(BigInteger, ForeignKey('salesorderitems.so_item_id'))
    sub_line_number = Column(String(10))
    
    # Updated ForeignKey reference table
    ship_to_location_id = Column(String(50), ForeignKey('customerlocations.location_id'))
    
    scheduled_quantity = Column(Integer, nullable=False)
    needed_delivery_date = Column(DateTime, nullable=False)
    promised_ship_date = Column(DateTime)
    
    requester_name = Column(String(100))
    tax_flag = Column(CHAR(1), default='N')
    status = Column(String(30), default='PENDING')

    # Relationships
    order_item = relationship("SalesOrderItem", back_populates="schedules")
    
    # Updated relationship target class
    location = relationship("CustomerLocation")

    from sqlalchemy import Column, String
# ... (keep your existing imports)

class Supplier(Base):
    __tablename__ = 'suppliers'

    supplier_id = Column(String(50), primary_key=True)
    company_name = Column(String(255), nullable=False)
    contact_name = Column(String(100))
    contact_email = Column(String(150))
    phone_number = Column(String(50))
    address_line1 = Column(String(255))
    city = Column(String(100))
    state = Column(String(50))
    postal_code = Column(String(20))
    country = Column(String(50))
    vendor_number_ext = Column(String(50))
    payment_terms = Column(String(50), default='Net 30')
    status = Column(String(20), default='Active')


# ========================================================
# 4. SUBCONTRACTING / OUTSIDE PROCESSING TABLES
# ========================================================

class ItemBOMComponent(Base):
    __tablename__ = 'itembomcomponents'

    bom_id = Column(BigInteger, primary_key=True, autoincrement=True)
    parent_item_id = Column(String(50), ForeignKey('items.item_id', ondelete='CASCADE'), nullable=False)
    component_item_id = Column(String(50), ForeignKey('items.item_id'), nullable=True)
    component_code = Column(String(50), nullable=True)  # Predefined Labor / Outside Service code (non-Product)
    quantity_per = Column(Numeric(12, 4), nullable=False, default=1)
    item_type = Column(String(30), nullable=False, server_default=text("'Material'"))
    scrap_factor = Column(Numeric(8, 4), nullable=False, server_default=text('0'))
    yield_loss_percentage = Column(Numeric(8, 4), nullable=False, server_default=text('0'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        UniqueConstraint('parent_item_id', 'component_item_id', 'component_code', name='unique_bom_line'),
        CheckConstraint('parent_item_id <> component_item_id', name='chk_bom_not_self_referencing'),
    )

    # Relationships
    parent_item = relationship("Item", foreign_keys=[parent_item_id], back_populates="bom_components")
    component_item = relationship("Item", foreign_keys=[component_item_id])


class VendorItemMapping(Base):
    """Vendor catalog: supplier ↔ purchase item mapping with cost/lead-time."""

    __tablename__ = 'vendoritemmappings'

    mapping_id = Column(BigInteger, primary_key=True, autoincrement=True)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)
    item_id = Column(String(50), ForeignKey('items.item_id', ondelete='CASCADE'), nullable=False)
    vendor_sku = Column(String(100))
    unit_cost = Column(Numeric(12, 4))
    minimum_order_qty = Column(Numeric(12, 4), nullable=False, server_default=text('1'))
    lead_time_days = Column(Integer, nullable=False, server_default=text('0'))
    is_primary_vendor = Column(Boolean, nullable=False, server_default=text('false'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        UniqueConstraint('supplier_id', 'item_id', name='uq_vendor_item_mapping'),
    )

    supplier = relationship("Supplier")
    item = relationship("Item", back_populates="vendor_mappings")


class ComponentIssueLog(Base):
    """Audit log of components issued to a subcontractor for an SCO."""

    __tablename__ = 'componentissuelogs'

    log_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sco_number = Column(String(50), ForeignKey('subcontractorders.sco_number'), nullable=False)
    issue_id = Column(String(50), ForeignKey('materialissues.issue_id', ondelete='CASCADE'), nullable=False)
    component_item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)
    quantity_issued = Column(Numeric(12, 4), nullable=False)
    issued_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))
    notes = Column(Text)

    __table_args__ = (
        CheckConstraint('quantity_issued > 0', name='chk_component_issue_log_qty'),
    )

    subcontract_order = relationship("SubcontractOrder")
    issue = relationship("MaterialIssue")
    component_item = relationship("Item")


class SubcontractOrder(Base):
    __tablename__ = 'subcontractorders'

    sco_number = Column(String(50), primary_key=True)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)
    item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)

    quantity_ordered = Column(Integer, nullable=False)
    status = Column(String(30), nullable=False, default='PLANNED')
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)

    order_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    expected_return_date = Column(Date)

    notes = Column(Text)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    supplier = relationship("Supplier")
    item = relationship("Item")
    components = relationship("SubcontractOrderComponent", back_populates="subcontract_order", cascade="all, delete-orphan")
    material_issues = relationship("MaterialIssue", back_populates="subcontract_order")
    finished_goods_receipts = relationship("FinishedGoodsReceipt", back_populates="subcontract_order")


class SubcontractOrderComponent(Base):
    __tablename__ = 'subcontractordercomponents'

    sco_component_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sco_number = Column(String(50), ForeignKey('subcontractorders.sco_number', ondelete='CASCADE'), nullable=False)
    component_item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)

    quantity_required = Column(Numeric(12, 4), nullable=False)
    quantity_issued = Column(Numeric(12, 4), nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint('sco_number', 'component_item_id', name='unique_component_per_sco'),
    )

    # Relationships
    subcontract_order = relationship("SubcontractOrder", back_populates="components")
    component_item = relationship("Item")


class MaterialIssue(Base):
    __tablename__ = 'materialissues'

    issue_id = Column(String(50), primary_key=True)
    sco_number = Column(String(50), ForeignKey('subcontractorders.sco_number'), nullable=False)
    issue_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    notes = Column(Text)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    subcontract_order = relationship("SubcontractOrder", back_populates="material_issues")
    lines = relationship("MaterialIssueLine", back_populates="issue", cascade="all, delete-orphan")


class MaterialIssueLine(Base):
    __tablename__ = 'materialissuelines'

    issue_line_id = Column(BigInteger, primary_key=True, autoincrement=True)
    issue_id = Column(String(50), ForeignKey('materialissues.issue_id', ondelete='CASCADE'), nullable=False)
    component_item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)
    quantity_issued = Column(Numeric(12, 4), nullable=False)

    __table_args__ = (
        CheckConstraint('quantity_issued > 0', name='chk_material_issue_line_qty_positive'),
    )

    # Relationships
    issue = relationship("MaterialIssue", back_populates="lines")
    component_item = relationship("Item")


class FinishedGoodsReceipt(Base):
    __tablename__ = 'finishedgoodsreceipts'

    receipt_id = Column(String(50), primary_key=True)
    sco_number = Column(String(50), ForeignKey('subcontractorders.sco_number'), nullable=False)
    quantity_received = Column(Integer, nullable=False)
    receipt_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    notes = Column(Text)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint('quantity_received > 0', name='chk_fg_receipt_qty_positive'),
    )

    # Relationships
    subcontract_order = relationship("SubcontractOrder", back_populates="finished_goods_receipts")


# ========================================================
# 5. FINANCE MODULE: AR / AP / CASH MANAGEMENT
# ========================================================

class ARInvoice(Base):
    """Accounts Receivable Invoice - auto-generated when a Sales Order is Approved."""
    __tablename__ = 'ar_invoices'

    invoice_id = Column(String(50), primary_key=True)
    sales_order_id = Column(String(50), ForeignKey('salesorders.sales_order_id'), nullable=False)
    customer_id = Column(String(50), ForeignKey('customers.customer_id'), nullable=False)

    amount = Column(Numeric(12, 2), nullable=False)
    status = Column(String(20), nullable=False, default='Unpaid')  # Unpaid, Partial, Paid
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    due_date = Column(Date, nullable=False)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint("status IN ('Unpaid', 'Partial', 'Paid')", name='chk_ar_invoice_status'),
    )

    # Relationships
    sales_order = relationship("SalesOrder")
    customer = relationship("Customer")


class APBill(Base):
    """Accounts Payable Bill - auto-generated when a Purchase Order is Approved."""
    __tablename__ = 'ap_bills'

    bill_id = Column(String(50), primary_key=True)
    purchase_order_id = Column(String(50), ForeignKey('purchaseorders.po_number'), nullable=False)
    vendor_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)

    amount = Column(Numeric(12, 2), nullable=False)
    status = Column(String(20), nullable=False, default='Unpaid')  # Unpaid, Partial, Paid
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    due_date = Column(Date, nullable=False)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint("status IN ('Unpaid', 'Partial', 'Paid')", name='chk_ap_bill_status'),
    )

    # Relationships
    purchase_order = relationship("PurchaseOrder")
    vendor = relationship("Supplier")


class PurchaseOrder(Base):
    """Purchase Order Header - an order placed with a Supplier/Vendor."""
    __tablename__ = 'purchaseorders'

    po_number = Column(String(50), primary_key=True)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)

    order_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    expected_delivery_date = Column(Date)
    payment_terms = Column(String(50), default='Net 30')
    status = Column(String(20), nullable=False, default='Draft')  # Draft, Submitted, Approved, Void
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)

    shipping_fee = Column(Numeric(12, 2), nullable=False, default=0)
    discount_type = Column(String(20), nullable=False, default='percentage')  # percentage or fixed
    discount_value = Column(Numeric(12, 2), nullable=False, default=0)

    subtotal = Column(Numeric(12, 2), nullable=False, default=0)
    total_tax = Column(Numeric(12, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(12, 2), nullable=False, default=0)
    grand_total = Column(Numeric(12, 2), nullable=False, default=0)

    notes = Column(Text)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint("status IN ('Draft', 'Submitted', 'Approved', 'Void')", name='chk_po_status'),
        CheckConstraint("discount_type IN ('percentage', 'fixed')", name='chk_po_discount_type'),
    )

    # Relationships
    supplier = relationship("Supplier")
    items = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderItem(Base):
    """Purchase Order Line Item."""
    __tablename__ = 'purchaseorderitems'

    item_id = Column(BigInteger, primary_key=True, autoincrement=True)
    po_number = Column(String(50), ForeignKey('purchaseorders.po_number', ondelete='CASCADE'), nullable=False)

    sku = Column(String(100), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False, default=1)
    unit_price = Column(Numeric(12, 4), nullable=False, default=0)
    tax_rate = Column(Numeric(6, 3), nullable=False, default=0)

    line_subtotal = Column(Numeric(12, 2), nullable=False, default=0)
    line_tax = Column(Numeric(12, 2), nullable=False, default=0)
    line_total = Column(Numeric(12, 2), nullable=False, default=0)

    # Relationships
    purchase_order = relationship("PurchaseOrder", back_populates="items")


class CashTransaction(Base):

    """Cash Management ledger - records Check Issue (AP payment) / Check Deposit (AR payment)."""
    __tablename__ = 'cash_transactions'

    transaction_id = Column(String(50), primary_key=True)
    type = Column(String(20), nullable=False)  # 'Check Issue' or 'Check Deposit'
    reference_id = Column(String(50), nullable=False)  # AR Invoice ID or AP Bill ID (no strict FK - polymorphic reference)
    amount = Column(Numeric(12, 2), nullable=False)
    transaction_date = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))
    bank_account_id = Column(String(50), nullable=True)  # Free-text bank account identifier
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint("type IN ('Check Issue', 'Check Deposit')", name='chk_cash_transaction_type'),
    )


# ========================================================
# INVENTORY & WAREHOUSE MANAGEMENT
# ========================================================

class Warehouse(Base):
    __tablename__ = 'warehouses'

    warehouse_id = Column(String(50), primary_key=True)
    name = Column(String(255), nullable=False)
    code = Column(String(20), unique=True, nullable=False)
    address = Column(String(255))
    is_active = Column(Boolean, nullable=False, server_default=text('true'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    bins = relationship("BinLocation", back_populates="warehouse", cascade="all, delete-orphan")


class BinLocation(Base):
    __tablename__ = 'binlocations'

    bin_id = Column(String(50), primary_key=True)
    warehouse_id = Column(String(50), ForeignKey('warehouses.warehouse_id', ondelete='CASCADE'), nullable=False)
    bin_code = Column(String(50), nullable=False)
    description = Column(Text)
    is_active = Column(Boolean, nullable=False, server_default=text('true'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        UniqueConstraint('warehouse_id', 'bin_code', name='unique_bin_per_warehouse'),
    )

    warehouse = relationship("Warehouse", back_populates="bins")


class InventoryStock(Base):
    __tablename__ = 'inventorystock'

    stock_id = Column(String(50), primary_key=True)
    item_id = Column(String(50), ForeignKey('items.item_id', ondelete='CASCADE'), nullable=False)
    warehouse_id = Column(String(50), ForeignKey('warehouses.warehouse_id'), nullable=False)
    bin_id = Column(String(50), ForeignKey('binlocations.bin_id'), nullable=False)
    on_hand_quantity = Column(Integer, nullable=False, default=0)
    allocated_quantity = Column(Integer, nullable=False, default=0)
    on_order_quantity = Column(Integer, nullable=False, default=0)
    reorder_point = Column(Integer, nullable=False, default=0)
    is_primary = Column(Boolean, nullable=False, server_default=text('false'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        UniqueConstraint('item_id', 'bin_id', name='unique_item_bin'),
        CheckConstraint(
            "on_hand_quantity >= 0 AND allocated_quantity >= 0 "
            "AND on_order_quantity >= 0 AND reorder_point >= 0",
            name='chk_inventory_qty_nonneg',
        ),
    )

    item = relationship("Item")
    warehouse = relationship("Warehouse")
    bin_location = relationship("BinLocation")


class StockMovement(Base):
    __tablename__ = 'stockmovements'

    movement_id = Column(String(50), primary_key=True)
    item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)
    movement_type = Column(String(20), nullable=False)
    quantity = Column(Integer, nullable=False)
    warehouse_id = Column(String(50), ForeignKey('warehouses.warehouse_id'), nullable=False)
    bin_id = Column(String(50), ForeignKey('binlocations.bin_id'), nullable=False)
    reference = Column(String(50))
    notes = Column(Text)
    movement_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint(
            "movement_type IN ('Receipt', 'Issue', 'Adjustment', 'Transfer')",
            name='chk_stock_movement_type',
        ),
    )

    item = relationship("Item")
    warehouse = relationship("Warehouse")
    bin_location = relationship("BinLocation")



class ItemFulfillment(Base):
    __tablename__ = "item_fulfillments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fulfillment_number = Column(String(50), unique=True, nullable=False)
    sales_order_id = Column(String(50), ForeignKey("salesorders.sales_order_id"), nullable=False)
    customer_id = Column(String(50), ForeignKey("customers.customer_id"), nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'DRAFT'"))
    shipped_date = Column(Date, nullable=True)
    carrier = Column(String(100), nullable=True)
    tracking_number = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'PICKED', 'PACKED', 'SHIPPED')",
            name="chk_item_fulfillment_status",
        ),
    )

    sales_order = relationship("SalesOrder")
    customer = relationship("Customer")
    lines = relationship(
        "ItemFulfillmentLine",
        back_populates="fulfillment",
        cascade="all, delete-orphan",
    )


class ItemFulfillmentLine(Base):
    __tablename__ = "item_fulfillment_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fulfillment_id = Column(
        Integer, ForeignKey("item_fulfillments.id", ondelete="CASCADE"), nullable=False
    )
    sales_order_line_id = Column(
        BigInteger, ForeignKey("salesorderitems.so_item_id"), nullable=False
    )
    item_id = Column(String(50), ForeignKey("items.item_id"), nullable=False)
    quantity_fulfilled = Column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("quantity_fulfilled > 0", name="chk_fulfillment_qty_pos"),
    )

    fulfillment = relationship("ItemFulfillment", back_populates="lines")
    sales_order_line = relationship("SalesOrderItem")
    item = relationship("Item")


class SalesInvoice(Base):
    __tablename__ = "sales_invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_number = Column(String(50), unique=True, nullable=False)
    sales_order_id = Column(String(50), ForeignKey("salesorders.sales_order_id"), nullable=False)
    fulfillment_id = Column(Integer, ForeignKey("item_fulfillments.id"), nullable=True)
    customer_id = Column(String(50), ForeignKey("customers.customer_id"), nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'DRAFT'"))
    issue_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    payment_terms = Column(String(50), nullable=True)
    subtotal = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    total_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    outstanding_balance = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    ar_invoice_id = Column(String(50), ForeignKey("ar_invoices.invoice_id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'APPROVED', 'PAID', 'VOID')",
            name="chk_sales_invoice_status",
        ),
    )

    sales_order = relationship("SalesOrder")
    fulfillment = relationship("ItemFulfillment")
    customer = relationship("Customer")
    ar_invoice = relationship("ARInvoice")
    lines = relationship(
        "SalesInvoiceLine",
        back_populates="invoice",
        cascade="all, delete-orphan",
    )


class SalesInvoiceLine(Base):
    __tablename__ = "sales_invoice_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id = Column(
        Integer, ForeignKey("sales_invoices.id", ondelete="CASCADE"), nullable=False
    )
    item_id = Column(String(50), ForeignKey("items.item_id"), nullable=False)
    description = Column(String(255), nullable=True)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False)
    line_subtotal = Column(Numeric(12, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="chk_sales_invoice_line_qty_pos"),
    )

    invoice = relationship("SalesInvoice", back_populates="lines")
    item = relationship("Item")
