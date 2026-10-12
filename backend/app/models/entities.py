# @author: Wendy Yang
# @date: 2026-09-19

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
    Index,
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
    email = Column(String(255), unique=True, nullable=True)
    full_name = Column(String(255), nullable=False)
    country = Column(String(80), nullable=True)
    password_hash = Column(String(255), nullable=False)
    security_question = Column(String(255), nullable=True)
    security_answer_hash = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, server_default=text("'ACTIVE'"))
    must_change_password = Column(Boolean, nullable=False, server_default=text('false'))
    department_id = Column(String(50), ForeignKey('departments.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text('NOW()'),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    department = relationship("Department", back_populates="users")
    roles = relationship("Role", secondary="user_roles", back_populates="users")
    company_memberships = relationship(
        "UserCompany",
        back_populates="user",
        cascade="all, delete-orphan",
    )


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
    action = Column(String(20), nullable=False)  # SUBMITTED | APPROVED | REJECTED | DELEGATED | AMENDED | RECALLED
    performed_by_user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'))
    comments = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    __table_args__ = (
        CheckConstraint(
            "action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'DELEGATED', 'AMENDED', 'RECALLED', 'REVISED')",
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


class PostingRule(Base):
    """Action → debit/credit account mapping used by automated GL posting."""

    __tablename__ = "posting_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_code = Column(String(50), unique=True, nullable=False)
    event_code = Column(String(40), nullable=False)
    variant = Column(String(40), nullable=False)
    party_scope = Column(String(20), nullable=False, server_default=text("'ANY'"))
    name = Column(String(255), nullable=False)
    debit_account_id = Column(
        UUID(as_uuid=True), ForeignKey("chart_of_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    credit_account_id = Column(
        UUID(as_uuid=True), ForeignKey("chart_of_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    is_system = Column(Boolean, nullable=False, server_default=text("true"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    sort_order = Column(Integer, nullable=False, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    debit_account = relationship("ChartOfAccount", foreign_keys=[debit_account_id])
    credit_account = relationship("ChartOfAccount", foreign_keys=[credit_account_id])

    __table_args__ = (
        UniqueConstraint("event_code", "variant", "party_scope", name="uq_posting_rules_event"),
        CheckConstraint(
            "party_scope IN ('TRADE', 'RELATED', 'ANY')",
            name="chk_posting_rules_party_scope",
        ),
        CheckConstraint(
            "debit_account_id <> credit_account_id",
            name="chk_posting_rules_distinct_accounts",
        ),
        Index("ix_posting_rules_event_variant", "event_code", "variant"),
    )


class PaymentTerm(Base):
    """Global payment-term master used by vendors, customers, POs, and invoices."""

    __tablename__ = "payment_terms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(20), unique=True, nullable=False)
    description = Column(String(255), nullable=False)
    due_days = Column(Integer, nullable=False, server_default=text("30"))
    discount_days = Column(Integer, nullable=True)
    discount_percentage = Column(Numeric(5, 2), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint("due_days >= 0", name="chk_payment_terms_due_days"),
        CheckConstraint(
            "discount_days IS NULL OR discount_days >= 0",
            name="chk_payment_terms_discount_days",
        ),
        CheckConstraint(
            "discount_percentage IS NULL OR (discount_percentage >= 0 AND discount_percentage <= 100)",
            name="chk_payment_terms_discount_pct",
        ),
    )


class CompanyProfile(Base):
    """Singleton company letterhead used on order PDFs (logo, contact, bill/ship)."""

    __tablename__ = "company_profile"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)
    company_name = Column(String(255), nullable=False, default="Grand-Tek Technology USA")
    contact_name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    bill_to = Column(JSONB, nullable=False, default=dict)
    ship_to = Column(JSONB, nullable=False, default=dict)
    logo_stored_filename = Column(String(255), nullable=True)
    logo_original_filename = Column(String(255), nullable=True)
    logo_content_type = Column(String(100), nullable=True)
    logo_file_size = Column(Integer(), nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    updated_by = relationship("User", foreign_keys=[updated_by_user_id])


class FinancePeriodSettings(Base):
    """Singleton period-close policy: Open, Soft Close, and Hard Close dates."""

    __tablename__ = "finance_period_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    current_closing_date = Column(Date, nullable=True)
    soft_close_date = Column(Date, nullable=True)
    hard_close_date = Column(Date, nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    updated_by = relationship("User", foreign_keys=[updated_by_user_id])


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
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    journal_number = Column(String(50), unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    description = Column(Text, nullable=False)
    posted_by_user_id = Column(UUID(as_uuid=True), ForeignKey('users.id'))

    # Finance module additions: accounting period (YYYY-MM) and posting workflow status
    period = Column(String(7), nullable=True)  # e.g. '2026-08'
    posting_date = Column(Date, nullable=True)
    reference = Column(String(100), nullable=True)
    posting_status = Column(String(20), nullable=False, server_default=text("'Posted'"))  # 'Draft' or 'Posted'
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    is_system_generated = Column(Boolean, nullable=False, server_default=text("false"))
    source_document_type = Column(String(40), nullable=True)
    source_record_id = Column(String(80), nullable=True)
    posting_rule_id = Column(
        UUID(as_uuid=True),
        ForeignKey("posting_rules.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    user = relationship("User")
    postings = relationship("LedgerPosting", back_populates="entry")
    posting_rule = relationship("PostingRule")

    __table_args__ = (
        CheckConstraint(
            "source_document_type IS NULL OR source_document_type IN ("
            "'GOODS_RECEIPT', 'SUPPLIER_INVOICE', 'SALES_INVOICE', 'SALES_CREDIT', "
            "'AR_PAYMENT', 'AP_PAYMENT', 'BANK_TRANSFER', 'MONTH_END_CLOSE', 'YEAR_END_CLOSE'"
            ")",
            name="chk_journal_entries_source_document_type",
        ),
        Index("ix_journal_entries_source_document", "source_document_type", "source_record_id"),
    )



class LedgerPosting(Base):
    __tablename__ = 'ledger_postings'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id = Column(UUID(as_uuid=True), ForeignKey('journal_entries.id', ondelete="RESTRICT"))
    account_id = Column(UUID(as_uuid=True), ForeignKey('chart_of_accounts.id'))
    debit = Column(Numeric(15, 4), default=0.0000)
    credit = Column(Numeric(15, 4), default=0.0000)
    currency = Column(String(3), default='USD')
    description = Column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            '(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)',
            name='check_balanced_line'
        ),
    )

    # Relationships
    entry = relationship("JournalEntry", back_populates="postings")
    account = relationship("ChartOfAccount")


class FinancialBudget(Base):
    """Optional P&L budget book used by Budget vs. Actual reporting."""

    __tablename__ = "financial_budgets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fiscal_year = Column(Integer, nullable=False)
    period = Column(String(7), nullable=False, server_default=text("''"))  # '' = annual; else YYYY-MM
    account_id = Column(UUID(as_uuid=True), ForeignKey("chart_of_accounts.id"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint(
            "fiscal_year",
            "period",
            "account_id",
            "currency",
            name="uq_financial_budget_period_account",
        ),
    )

    account = relationship("ChartOfAccount")


class GlAccountBalance(Base):
    """Imported period ending balances (e.g. TIPTOP 試算表), keyed by YYYY-MM + account."""

    __tablename__ = "gl_account_balances"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period = Column(String(7), nullable=False)  # YYYY-MM
    account_id = Column(UUID(as_uuid=True), ForeignKey("chart_of_accounts.id"), nullable=False)
    ending_debit = Column(Numeric(15, 4), nullable=False, default=0)
    ending_credit = Column(Numeric(15, 4), nullable=False, default=0)
    ending_balance = Column(Numeric(15, 4), nullable=False, default=0)
    currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    source_file = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint("period", "account_id", "currency", name="uq_gl_account_balance_period_account"),
    )

    account = relationship("ChartOfAccount")

# ========================================================
# 3. CRM & SALES TABLES (Capitalized Table Names in SQL)
# ========================================================

class Customer(Base):
    __tablename__ = 'customers'

    customer_id = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    customer_number_ext = Column(String(50))
    company_name = Column(String(255), nullable=False)
    tax_id_type = Column(String(16), nullable=True)
    tax_id = Column(String(64), nullable=True, index=True)
    industry_type = Column(String(100), nullable=True)
    facility_type = Column(String(100), nullable=True)
    website = Column(String(255), nullable=True)
    primary_contact_name = Column(String(255), nullable=True)
    primary_email = Column(String(255), nullable=True, index=True)
    primary_phone = Column(String(50), nullable=True)
    currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    credit_limit = Column(Numeric(14, 2), nullable=False, server_default=text('0.00'))
    payment_terms = Column(String(50), nullable=True)
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
    preferred_incoterms = Column(String(10), nullable=True)
    preferred_shipping_method = Column(String(50), nullable=True)
    tax_exempt = Column(Boolean, nullable=False, server_default=text('false'))
    tax_exempt_certificate_id = Column(String(100), nullable=True)
    status = Column(String(32), nullable=False, server_default=text("'ACTIVE'"))
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text('NOW()'),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    locations = relationship(
        "CustomerLocation",
        back_populates="customer",
        cascade="all, delete-orphan",
    )
    certifications = relationship(
        "CustomerCertification",
        back_populates="customer",
        cascade="all, delete-orphan",
    )
    payment_term = relationship("PaymentTerm")


class CustomerLocation(Base):
    """Bill-To / Ship-To sites. Table name remains `customerlocations` to preserve SO FKs."""

    __tablename__ = 'customerlocations'

    location_id = Column(String(50), primary_key=True)
    customer_id = Column(String(50), ForeignKey('customers.customer_id', ondelete='CASCADE'), index=True)
    location_type = Column(String(20), nullable=False)  # 'BILL_TO', 'SHIP_TO', or 'BOTH'
    location_code = Column(String(50), nullable=True)
    location_name = Column(String(150), nullable=False)
    attention_to = Column(String(100))
    address_line1 = Column(String(255), nullable=False)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=True)  # state / province (API alias: state_province)
    postal_code = Column(String(32), nullable=False)
    country = Column(String(50), nullable=False)
    contact_person = Column(String(150), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    is_default = Column(Boolean, nullable=False, server_default=text('false'))
    tax_id = Column(String(64), nullable=True)
    shipping_instructions = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text('NOW()'),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "location_type IN ('BILL_TO', 'SHIP_TO', 'BOTH')",
            name='chk_location_type'
        ),
    )

    customer = relationship("Customer", back_populates="locations")


class CustomerCertification(Base):
    __tablename__ = 'customer_certifications'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    customer_id = Column(
        String(50),
        ForeignKey('customers.customer_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    certification_name = Column(String(100), nullable=False)
    certificate_number = Column(String(100), nullable=True)
    valid_until = Column(Date, nullable=True)

    customer = relationship("Customer", back_populates="certifications")

class Item(Base):
    __tablename__ = 'items'

    item_id = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    customer_part_number = Column(String(50), nullable=False)
    description = Column(Text)
    uom = Column(String(20), nullable=True, default='Each')
    unit_price = Column(Numeric(12, 2), nullable=True)
    on_hand_quantity = Column(Integer, default=0)
    wip_quantity = Column(Integer, default=0)
    item_type = Column(String(20), nullable=False, server_default=text("'INVENTORY'"))
    is_outside_processed = Column(Boolean, nullable=False, server_default=text('false'))
    is_purchase_item = Column(Boolean, nullable=False, server_default=text('false'))
    is_subcontract_assembly = Column(Boolean, nullable=False, server_default=text('false'))
    is_raw_material = Column(Boolean, nullable=False, server_default=text('false'))
    requires_inspection = Column(Boolean, nullable=False, server_default=text('false'))

    vendor_mappings = relationship("VendorItemMapping", back_populates="item", cascade="all, delete-orphan")
    bom_headers = relationship(
        "ItemBOMHeader",
        back_populates="parent_item",
        cascade="all, delete-orphan",
    )
    bom_components = relationship(
        "ItemBOMComponent",
        foreign_keys="ItemBOMComponent.parent_item_id",
        back_populates="parent_item",
        cascade="all, delete-orphan",
    )



class SalesOrder(Base):
    __tablename__ = 'salesorders'

    sales_order_id = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    customer_id = Column(String(50), ForeignKey('customers.customer_id'))
    
    # Updated Foreign Keys mapping to the unified CustomerLocation table
    bill_to_location_id = Column(String(50), ForeignKey('customerlocations.location_id'))
    ship_to_location_id = Column(String(50), ForeignKey('customerlocations.location_id'))
    
    customer_po_number = Column(String(50), nullable=False)
    po_revision_number = Column(Integer, default=0)
    order_date = Column(Date, nullable=False)
    customer_revision_date = Column(Date, nullable=True)
    
    payment_terms = Column(String(50))
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
    freight_terms = Column(String(50))
    shipping_method = Column(String(50))
    currency = Column(String(3), default='USD')
    
    buyer_contact_name = Column(String(100))
    buyer_contact_email = Column(String(150))
    
    status = Column(String(30), default='DRAFT')
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    revision_number = Column(Integer, nullable=False, server_default=text("0"))
    root_document_id = Column(String(50), nullable=True)
    remaining_closed = Column(Boolean, nullable=False, server_default=text('false'))
    remaining_closed_at = Column(DateTime, nullable=True)
    closed_billable_amount = Column(Numeric(12, 2), nullable=True)
    total_amount = Column(Numeric(12, 2), nullable=False)
    
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    customer = relationship("Customer")
    payment_term = relationship("PaymentTerm")
    bill_to_location = relationship("CustomerLocation", foreign_keys=[bill_to_location_id])
    ship_to_location = relationship("CustomerLocation", foreign_keys=[ship_to_location_id])
    items = relationship("SalesOrderItem", back_populates="sales_order")
    subcontract_orders = relationship("SubcontractOrder", back_populates="sales_order")

class SalesOrderItem(Base):
    __tablename__ = 'salesorderitems'

    so_item_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sales_order_id = Column(String(50), ForeignKey('salesorders.sales_order_id'))
    line_number = Column(Integer, nullable=False)
    item_id = Column(String(50), ForeignKey('items.item_id'))
    customer_part_number = Column(String(50), nullable=True)
    
    quantity_ordered = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 4), nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0.00)
    total_amount = Column(Numeric(12, 2), nullable=False)

    # Relationships
    sales_order = relationship("SalesOrder", back_populates="items")
    item = relationship("Item")
    subcontract_lines = relationship("SubcontractOrderItem", back_populates="sales_order_item")
    schedules = relationship(
        "SalesOrderDeliverySchedule",
        back_populates="order_item",
        cascade="all, delete-orphan",
    )

class SalesOrderDeliverySchedule(Base):
    """Split customer delivery dates for one sales-order line."""

    __tablename__ = 'salesorderdeliveryschedules'

    schedule_id = Column(BigInteger, primary_key=True, autoincrement=True)
    so_item_id = Column(
        BigInteger,
        ForeignKey('salesorderitems.so_item_id', ondelete='CASCADE'),
        nullable=False,
    )
    sub_line_number = Column(String(10))
    ship_to_location_id = Column(String(50), ForeignKey('customerlocations.location_id'))

    scheduled_quantity = Column(Integer, nullable=False)
    needed_delivery_date = Column(DateTime, nullable=False)
    promised_ship_date = Column(DateTime)

    requester_name = Column(String(100))
    tax_flag = Column(CHAR(1), default='N')
    status = Column(String(30), default='PENDING')

    order_item = relationship("SalesOrderItem", back_populates="schedules")
    location = relationship("CustomerLocation")

class WorkCenter(Base):
    """Manufacturing / outside-processing work center referenced by subcontractors."""

    __tablename__ = 'work_centers'

    work_center_id = Column(String(50), primary_key=True)
    name = Column(String(150), nullable=False)
    warehouse_id = Column(String(50), ForeignKey('warehouses.warehouse_id'), nullable=True)
    hourly_rate = Column(Numeric(12, 2), nullable=False, server_default=text('0'))
    is_active = Column(Boolean, nullable=False, server_default=text('true'))
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))

    __table_args__ = (
        CheckConstraint("hourly_rate >= 0", name="chk_work_center_rate_nonneg"),
    )


class Supplier(Base):
    __tablename__ = 'suppliers'

    supplier_id = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    company_name = Column(String(255), nullable=False)
    contact_name = Column(String(100))
    contact_email = Column(String(255))
    phone_number = Column(String(50))
    address_line1 = Column(String(255))
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100))
    state = Column(String(50))
    postal_code = Column(String(20))
    country = Column(String(50))
    vendor_number_ext = Column(String(50))
    payment_terms = Column(String(50), default='Net 30')
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
    status = Column(String(20), default='Active')
    vendor_type = Column(String(20), nullable=False, server_default=text("'material'"))
    tax_id = Column(String(50), nullable=True)
    tax_document_type = Column(String(64), nullable=True)
    is_overseas = Column(Boolean, nullable=False, server_default=text('false'))
    currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    ap_account_id = Column(UUID(as_uuid=True), ForeignKey('chart_of_accounts.id', ondelete='SET NULL'), nullable=True)
    payment_method = Column(String(20), nullable=True)
    incoterms = Column(String(10), nullable=True)
    incoterm_location = Column(String(150), nullable=True)
    country_of_origin = Column(String(50), nullable=True)
    bank_name = Column(String(150), nullable=True)
    swift_code = Column(String(11), nullable=True)
    iban_account_number = Column(String(64), nullable=True)
    bank_address = Column(Text, nullable=True)
    intermediary_bank_name = Column(String(150), nullable=True)
    intermediary_swift_code = Column(String(11), nullable=True)
    intermediary_routing_aba = Column(String(20), nullable=True)
    lead_time_days = Column(Integer, nullable=False, server_default=text('0'))
    work_center_id = Column(
        String(50),
        ForeignKey('work_centers.work_center_id', ondelete='SET NULL'),
        nullable=True,
    )
    consignment_stock_loc_id = Column(
        String(50),
        ForeignKey('binlocations.bin_id', ondelete='SET NULL'),
        nullable=True,
    )
    standard_scrap_rate = Column(Numeric(5, 2), nullable=False, server_default=text('0.00'))
    iso_certified = Column(Boolean, nullable=False, server_default=text('false'))
    qc_status = Column(String(20), nullable=False, server_default=text("'approved'"))
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text('NOW()'))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text('NOW()'),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "vendor_type IN ('material', 'subcontractor', 'both', 'service')",
            name='chk_supplier_vendor_type',
        ),
        CheckConstraint(
            "payment_method IS NULL OR payment_method IN ('wire', 'ach', 'check', 'credit_card')",
            name='chk_supplier_payment_method',
        ),
        CheckConstraint(
            "qc_status IN ('approved', 'probation', 'blocked')",
            name='chk_supplier_qc_status',
        ),
        CheckConstraint(
            "tax_document_type IS NULL OR tax_document_type IN "
            "('W-8BEN-E', 'W-8BEN', 'Certificate of Foreign Status', 'Other', 'W-9')",
            name='chk_supplier_tax_document_type',
        ),
    )

    ap_account = relationship("ChartOfAccount", foreign_keys=[ap_account_id])
    payment_term = relationship("PaymentTerm")
    work_center = relationship("WorkCenter", foreign_keys=[work_center_id])
    consignment_location = relationship("BinLocation", foreign_keys=[consignment_stock_loc_id])


# ========================================================
# 4. SUBCONTRACTING / OUTSIDE PROCESSING TABLES
# ========================================================

class ItemBOMHeader(Base):
    """One BOM revision for an assembly. Lines live on ItemBOMComponent."""

    __tablename__ = "itembomheaders"

    bom_header_id = Column(BigInteger, primary_key=True, autoincrement=True)
    parent_item_id = Column(
        String(50), ForeignKey("items.item_id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_no = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'active'"))
    effective_from = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    applied_master_routing_id = Column(BigInteger, ForeignKey("master_routings.id", ondelete="SET NULL"), nullable=True)
    applied_routing_code = Column(String(50), nullable=True)
    applied_routing_version = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        UniqueConstraint("parent_item_id", "version_no", name="uq_item_bom_version"),
        CheckConstraint("status IN ('draft', 'active', 'obsolete')", name="chk_bom_header_status"),
        CheckConstraint("version_no > 0", name="chk_bom_header_version_pos"),
        Index(
            "uq_one_active_bom_per_item",
            "parent_item_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    parent_item = relationship("Item", back_populates="bom_headers")
    components = relationship(
        "ItemBOMComponent",
        back_populates="header",
        cascade="all, delete-orphan",
    )


class ItemBOMComponent(Base):
    __tablename__ = 'itembomcomponents'

    bom_id = Column(BigInteger, primary_key=True, autoincrement=True)
    bom_header_id = Column(
        BigInteger,
        ForeignKey("itembomheaders.bom_header_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    parent_item_id = Column(String(50), ForeignKey('items.item_id', ondelete='CASCADE'), nullable=False)
    component_item_id = Column(String(50), ForeignKey('items.item_id'), nullable=True)
    component_code = Column(String(50), nullable=True)  # Predefined Labor / Outside Service code (non-Product)
    quantity_per = Column(Numeric(12, 4), nullable=False, default=1)
    item_type = Column(String(30), nullable=False, server_default=text("'Material'"))
    scrap_factor = Column(Numeric(8, 4), nullable=False, server_default=text('0'))
    yield_loss_percentage = Column(Numeric(8, 4), nullable=False, server_default=text('0'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        UniqueConstraint('bom_header_id', 'component_item_id', 'component_code', name='unique_bom_line'),
        CheckConstraint('parent_item_id <> component_item_id', name='chk_bom_not_self_referencing'),
    )

    # Relationships
    header = relationship("ItemBOMHeader", back_populates="components")
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
    sco_line_id = Column(
        BigInteger,
        ForeignKey('subcontractorderitems.sco_line_id', ondelete='SET NULL'),
        nullable=True,
    )
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
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)
    # Parent Sales Order when this SCO is created from an SO (e.g. PU61-26060001).
    sales_order_id = Column(String(50), ForeignKey('salesorders.sales_order_id'), nullable=True)
    item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)
    bom_header_id = Column(
        BigInteger,
        ForeignKey("itembomheaders.bom_header_id", ondelete="SET NULL"),
        nullable=True,
    )

    quantity_ordered = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False, server_default=text('0'))
    status = Column(String(30), nullable=False, default='PLANNED')
    remaining_closed = Column(Boolean, nullable=False, server_default=text('false'))
    remaining_closed_at = Column(DateTime, nullable=True)
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    amendment_number = Column(Integer, nullable=False, server_default=text("0"))
    revision_number = Column(Integer, nullable=False, server_default=text("0"))
    root_document_id = Column(String(50), nullable=True)
    billing_status = Column(String(30), nullable=False, server_default=text("'UNBILLED'"))

    order_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    expected_return_date = Column(Date)

    notes = Column(Text)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    # Relationships
    supplier = relationship("Supplier")
    sales_order = relationship("SalesOrder", back_populates="subcontract_orders")
    item = relationship("Item")
    bom_header = relationship("ItemBOMHeader")
    lines = relationship(
        "SubcontractOrderItem",
        back_populates="subcontract_order",
        cascade="all, delete-orphan",
        order_by="SubcontractOrderItem.line_number",
    )
    components = relationship("SubcontractOrderComponent", back_populates="subcontract_order", cascade="all, delete-orphan")
    material_issues = relationship("MaterialIssue", back_populates="subcontract_order")
    finished_goods_receipts = relationship("FinishedGoodsReceipt", back_populates="subcontract_order")
    schedules = relationship(
        "SubcontractOrderDeliverySchedule",
        back_populates="subcontract_order",
        cascade="all, delete-orphan",
    )

    @property
    def bom_version_no(self) -> int | None:
        return self.bom_header.version_no if self.bom_header is not None else None

    @property
    def document_total(self) -> Decimal:
        if self.lines:
            return sum((line.line_total or Decimal("0")) for line in self.lines) or Decimal("0")
        return (self.unit_price or Decimal("0")) * Decimal(str(self.quantity_ordered or 0))

    @property
    def line_count(self) -> int:
        return len(self.lines or [])


class SubcontractOrderDeliverySchedule(Base):
    """Split finished-good return dates for one subcontract order."""

    __tablename__ = 'subcontractorderdeliveryschedules'

    schedule_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sco_number = Column(
        String(50),
        ForeignKey('subcontractorders.sco_number', ondelete='CASCADE'),
        nullable=False,
    )
    sub_line_number = Column(String(10))
    warehouse_id = Column(String(50), ForeignKey('warehouses.warehouse_id'))
    bin_id = Column(String(50), ForeignKey('binlocations.bin_id'))

    scheduled_quantity = Column(Integer, nullable=False)
    needed_return_date = Column(DateTime, nullable=False)
    promised_return_date = Column(DateTime)

    requester_name = Column(String(100))
    status = Column(String(30), default='PENDING')

    subcontract_order = relationship("SubcontractOrder", back_populates="schedules")
    warehouse = relationship("Warehouse")
    bin = relationship("BinLocation")


class SubcontractOrderItem(Base):
    """Finished-good line on a subcontract order, optionally tied to one SO line."""

    __tablename__ = 'subcontractorderitems'

    sco_line_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sco_number = Column(
        String(50),
        ForeignKey('subcontractorders.sco_number', ondelete='CASCADE'),
        nullable=False,
    )
    line_number = Column(Integer, nullable=False)
    so_item_id = Column(BigInteger, ForeignKey('salesorderitems.so_item_id'), nullable=True)
    item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)
    bom_header_id = Column(
        BigInteger,
        ForeignKey("itembomheaders.bom_header_id", ondelete="SET NULL"),
        nullable=True,
    )
    quantity_ordered = Column(Integer, nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False, server_default=text('0'))
    margin_percent = Column(Numeric(8, 4), nullable=False, server_default=text('0'))
    margin_amount = Column(Numeric(12, 2), nullable=False, server_default=text('0'))
    cost_subtotal = Column(Numeric(12, 4), nullable=False, server_default=text('0'))
    tax_exempt = Column(Boolean, nullable=False, server_default=text('true'))
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default=text('0'))
    line_total = Column(Numeric(12, 2), nullable=False, server_default=text('0'))
    notes = Column(Text)

    __table_args__ = (
        UniqueConstraint('sco_number', 'line_number', name='uq_sco_line_number'),
        CheckConstraint('quantity_ordered > 0', name='chk_sco_line_qty_positive'),
    )

    subcontract_order = relationship("SubcontractOrder", back_populates="lines")
    sales_order_item = relationship("SalesOrderItem", back_populates="subcontract_lines")
    item = relationship("Item")
    bom_header = relationship("ItemBOMHeader")
    components = relationship(
        "SubcontractOrderComponent",
        back_populates="order_line",
        cascade="all, delete-orphan",
    )
    charges = relationship(
        "SubcontractOrderLineCharge",
        back_populates="order_line",
        cascade="all, delete-orphan",
        order_by="SubcontractOrderLineCharge.line_no",
    )

    @property
    def bom_version_no(self) -> int | None:
        return self.bom_header.version_no if self.bom_header is not None else None

    @property
    def so_line_number(self) -> int | None:
        return self.sales_order_item.line_number if self.sales_order_item is not None else None


class SubcontractOrderLineCharge(Base):
    """Vendor cost-sheet row (labor / shipping / admin / custom / margin) on one SCO line."""

    __tablename__ = 'subcontractorderlinecharges'

    sco_charge_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sco_line_id = Column(
        BigInteger,
        ForeignKey('subcontractorderitems.sco_line_id', ondelete='CASCADE'),
        nullable=False,
    )
    line_no = Column(Integer, nullable=False)
    name = Column(String(150), nullable=False)
    detail_explanation = Column(Text)
    labor_minutes = Column(Numeric(8, 2), nullable=True)
    sf_rate = Column(Numeric(12, 4), nullable=True)
    cost_per_unit = Column(Numeric(12, 4), nullable=False, server_default=text('0'))
    margin_percent = Column(Numeric(8, 4), nullable=True)
    is_margin = Column(Boolean, nullable=False, server_default=text('false'))

    __table_args__ = (
        UniqueConstraint('sco_line_id', 'line_no', name='uq_sco_charge_line_no'),
    )

    order_line = relationship("SubcontractOrderItem", back_populates="charges")


class SubcontractOrderComponent(Base):
    __tablename__ = 'subcontractordercomponents'

    sco_component_id = Column(BigInteger, primary_key=True, autoincrement=True)
    sco_number = Column(String(50), ForeignKey('subcontractorders.sco_number', ondelete='CASCADE'), nullable=False)
    sco_line_id = Column(
        BigInteger,
        ForeignKey('subcontractorderitems.sco_line_id', ondelete='CASCADE'),
        nullable=False,
    )
    component_item_id = Column(String(50), ForeignKey('items.item_id'), nullable=False)

    quantity_required = Column(Numeric(12, 4), nullable=False)
    quantity_required_bom = Column(Numeric(12, 4), nullable=True)
    quantity_issued = Column(Numeric(12, 4), nullable=False, default=0)
    is_overridden = Column(Boolean, nullable=False, server_default=text('false'))
    notes = Column(Text)

    __table_args__ = (
        UniqueConstraint('sco_line_id', 'component_item_id', name='unique_component_per_sco_line'),
    )

    subcontract_order = relationship("SubcontractOrder", back_populates="components")
    order_line = relationship("SubcontractOrderItem", back_populates="components")
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
    sco_line_id = Column(
        BigInteger,
        ForeignKey('subcontractorderitems.sco_line_id', ondelete='SET NULL'),
        nullable=True,
    )
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
    sco_line_id = Column(
        BigInteger,
        ForeignKey('subcontractorderitems.sco_line_id', ondelete='SET NULL'),
        nullable=True,
    )
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
    """Accounts Payable Bill - mirrored from approved Supplier Invoices (or legacy PO approve)."""
    __tablename__ = 'ap_bills'

    bill_id = Column(String(50), primary_key=True)
    purchase_order_id = Column(String(50), ForeignKey('purchaseorders.po_number'), nullable=True)
    vendor_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)
    supplier_invoice_id = Column(Integer, ForeignKey('supplier_invoices.id'), nullable=True)
    source_type = Column(String(30), nullable=True)
    source_order_id = Column(String(50), nullable=True)
    reference_po_number = Column(String(50), nullable=True)

    amount = Column(Numeric(12, 2), nullable=False)
    status = Column(String(20), nullable=False, default='Unpaid')  # Unpaid, Partial, Paid
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    due_date = Column(Date, nullable=False)
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint("status IN ('Unpaid', 'Partial', 'Paid')", name='chk_ap_bill_status'),
    )

    # Relationships
    purchase_order = relationship("PurchaseOrder")
    vendor = relationship("Supplier")
    supplier_invoice = relationship("SupplierInvoice", foreign_keys=[supplier_invoice_id])
    payment_term = relationship("PaymentTerm")


class PurchaseOrder(Base):
    """Purchase Order Header - an order placed with a Supplier/Vendor."""
    __tablename__ = 'purchaseorders'

    po_number = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'), nullable=False)
    po_type = Column(String(20), nullable=False, server_default=text("'MATERIAL'"))
    bom_header_id = Column(BigInteger, ForeignKey('itembomheaders.bom_header_id'), nullable=True)
    sco_number = Column(String(50), ForeignKey('subcontractorders.sco_number'), nullable=True)

    order_date = Column(Date, nullable=False, server_default=text('CURRENT_DATE'))
    expected_delivery_date = Column(Date)
    payment_terms = Column(String(50), default='Net 30')
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
    status = Column(String(20), nullable=False, default='Draft')  # Draft, Submitted, Approved, Void
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    revision_number = Column(Integer, nullable=False, server_default=text("0"))
    root_document_id = Column(String(50), nullable=True)
    billing_status = Column(String(30), nullable=False, server_default=text("'UNBILLED'"))
    remaining_closed = Column(Boolean, nullable=False, server_default=text('false'))
    remaining_closed_at = Column(DateTime, nullable=True)

    shipping_fee = Column(Numeric(12, 2), nullable=False, default=0)
    discount_type = Column(String(20), nullable=False, default='percentage')  # percentage or fixed
    discount_value = Column(Numeric(12, 2), nullable=False, default=0)
    incoterms = Column(String(10), nullable=True)
    freight_terms = Column(String(30), nullable=False, server_default=text("'PREPAID_ON_PO'"))
    carrier_account = Column(String(50), nullable=True)

    subtotal = Column(Numeric(12, 2), nullable=False, default=0)
    total_tax = Column(Numeric(12, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(12, 2), nullable=False, default=0)
    grand_total = Column(Numeric(12, 2), nullable=False, default=0)

    notes = Column(Text)
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint("status IN ('Draft', 'Submitted', 'Approved', 'Void')", name='chk_po_status'),
        CheckConstraint("discount_type IN ('percentage', 'fixed')", name='chk_po_discount_type'),
        CheckConstraint("po_type IN ('MATERIAL', 'SUBCONTRACT')", name='chk_po_type'),
        CheckConstraint(
            "freight_terms IN ('PREPAID_ON_PO', 'THIRD_PARTY_COLLECT', 'ROUTING_ACCOUNT')",
            name='chk_po_freight_terms',
        ),
    )

    # Relationships
    supplier = relationship("Supplier")
    payment_term = relationship("PaymentTerm")
    subcontract_order = relationship("SubcontractOrder", foreign_keys=[sco_number])
    items = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderItem(Base):
    """Purchase Order Line Item."""
    __tablename__ = 'purchaseorderitems'

    item_id = Column(BigInteger, primary_key=True, autoincrement=True)
    po_number = Column(String(50), ForeignKey('purchaseorders.po_number', ondelete='CASCADE'), nullable=False)

    sku = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    uom = Column(String(20), nullable=True)
    bom_header_id = Column(BigInteger, ForeignKey('itembomheaders.bom_header_id'), nullable=True)
    sco_component_id = Column(
        BigInteger,
        ForeignKey('subcontractordercomponents.sco_component_id', ondelete='SET NULL'),
        nullable=True,
    )
    quantity = Column(Numeric(12, 4), nullable=False, default=1)
    unit_price = Column(Numeric(12, 4), nullable=False, default=0)
    tax_rate = Column(Numeric(6, 3), nullable=False, default=0)

    line_subtotal = Column(Numeric(12, 2), nullable=False, default=0)
    line_tax = Column(Numeric(12, 2), nullable=False, default=0)
    line_total = Column(Numeric(12, 2), nullable=False, default=0)

    # Relationships
    purchase_order = relationship("PurchaseOrder", back_populates="items")
    sco_component = relationship("SubcontractOrderComponent", foreign_keys=[sco_component_id])
    schedules = relationship(
        "PurchaseOrderDeliverySchedule",
        back_populates="order_item",
        cascade="all, delete-orphan",
    )


class PurchaseOrderDeliverySchedule(Base):
    """Split vendor delivery dates for one purchase-order line."""

    __tablename__ = 'purchaseorderdeliveryschedules'

    schedule_id = Column(BigInteger, primary_key=True, autoincrement=True)
    po_item_id = Column(
        BigInteger,
        ForeignKey('purchaseorderitems.item_id', ondelete='CASCADE'),
        nullable=False,
    )
    sub_line_number = Column(String(10))
    warehouse_id = Column(String(50), ForeignKey('warehouses.warehouse_id'))
    bin_id = Column(String(50), ForeignKey('binlocations.bin_id'))

    scheduled_quantity = Column(Numeric(12, 4), nullable=False)
    needed_delivery_date = Column(DateTime, nullable=False)
    promised_delivery_date = Column(DateTime)

    requester_name = Column(String(100))
    status = Column(String(30), default='PENDING')

    order_item = relationship("PurchaseOrderItem", back_populates="schedules")
    warehouse = relationship("Warehouse")
    bin = relationship("BinLocation")


class BankAccount(Base):
    """Company bank accounts used by Cash Management."""

    __tablename__ = "bank_accounts"

    bank_account_id = Column(String(50), primary_key=True)
    bank_name = Column(String(150), nullable=False)
    account_name = Column(String(100), nullable=False)
    account_number = Column(String(34), nullable=False)
    routing_number = Column(String(34), nullable=True)
    account_type = Column(String(20), nullable=False, server_default=text("'CHECKING'"))
    currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    gl_account_id = Column(UUID(as_uuid=True), ForeignKey("chart_of_accounts.id"), nullable=False)
    is_default = Column(Boolean, nullable=False, server_default=text("false"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        CheckConstraint(
            "account_type IN ('CHECKING', 'SAVINGS', 'MONEY_MARKET', 'OTHER')",
            name="chk_bank_account_type",
        ),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="chk_bank_account_currency"),
    )

    gl_account = relationship("ChartOfAccount")


class BankTransfer(Base):
    """Internal movement of funds between company bank accounts."""

    __tablename__ = "bank_transfers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_account_id = Column(
        String(50),
        ForeignKey("bank_accounts.bank_account_id"),
        nullable=False,
    )
    to_account_id = Column(
        String(50),
        ForeignKey("bank_accounts.bank_account_id"),
        nullable=False,
    )
    amount = Column(Numeric(12, 2), nullable=False)
    transfer_date = Column(Date, nullable=False)
    reference_number = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, server_default=text("'DRAFT'"))
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)
    journal_entry_id = Column(UUID(as_uuid=True), ForeignKey("journal_entries.id"), nullable=True)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        CheckConstraint("from_account_id <> to_account_id", name="chk_bank_transfer_distinct_accounts"),
        CheckConstraint("amount > 0", name="chk_bank_transfer_amount_positive"),
        CheckConstraint("status IN ('DRAFT', 'POSTED')", name="chk_bank_transfer_status"),
    )

    from_account = relationship("BankAccount", foreign_keys=[from_account_id])
    to_account = relationship("BankAccount", foreign_keys=[to_account_id])
    journal_entry = relationship("JournalEntry")


class CashTransaction(Base):

    """Cash Management ledger - records Check Issue (AP payment) / Check Deposit (AR payment)."""
    __tablename__ = 'cash_transactions'

    transaction_id = Column(String(50), primary_key=True)
    type = Column(String(20), nullable=False)  # 'Check Issue' or 'Check Deposit'
    reference_id = Column(String(50), nullable=False)  # AR Invoice ID or AP Bill ID (no strict FK - polymorphic reference)
    amount = Column(Numeric(12, 2), nullable=False)
    transaction_date = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))
    bank_account_id = Column(String(50), ForeignKey("bank_accounts.bank_account_id"), nullable=True)
    payment_method = Column(String(20), nullable=False, server_default=text("'CHECK'"))
    instrument_ref_no = Column(String(50), nullable=True)
    entity_name = Column(String(255), nullable=True)
    clearing_status = Column(String(20), nullable=False, server_default=text("'CLEARED'"))
    approval_status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    current_approval_step = Column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint("type IN ('Check Issue', 'Check Deposit')", name='chk_cash_transaction_type'),
        CheckConstraint("payment_method IN ('CHECK', 'WIRE', 'ACH', 'CARD')", name="chk_cash_payment_method"),
        CheckConstraint(
            "clearing_status IN ('PENDING', 'CLEARED', 'VOID')",
            name="chk_cash_clearing_status",
        ),
    )

    bank_account = relationship("BankAccount")


# ========================================================
# INVENTORY & WAREHOUSE MANAGEMENT
# ========================================================

class Warehouse(Base):
    __tablename__ = 'warehouses'

    warehouse_id = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(20), unique=True, nullable=False)
    address = Column(String(255))
    stock_class = Column(String(20), nullable=False, server_default=text("'unrestricted'"))
    is_active = Column(Boolean, nullable=False, server_default=text('true'))
    created_at = Column(DateTime, server_default=text('CURRENT_TIMESTAMP'))

    __table_args__ = (
        CheckConstraint(
            "stock_class IN ('unrestricted', 'quarantine', 'scrap', 'rework')",
            name="chk_warehouse_stock_class",
        ),
    )

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
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
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
    payment_term = relationship("PaymentTerm")
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


# ========================================================
# PROCURE-TO-PAY: GOODS RECEIPTS & SUPPLIER INVOICES
# ========================================================


class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    receipt_number = Column(String(50), unique=True, nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True, index=True)
    source_type = Column(String(30), nullable=False)
    source_order_id = Column(String(50), nullable=False)
    vendor_id = Column(String(50), ForeignKey("suppliers.supplier_id"), nullable=False)
    receipt_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'POSTED'"))
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER')",
            name="chk_goods_receipt_source_type",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'POSTED', 'CANCELLED')",
            name="chk_goods_receipt_status",
        ),
    )

    vendor = relationship("Supplier")
    lines = relationship(
        "GoodsReceiptLine",
        back_populates="receipt",
        cascade="all, delete-orphan",
    )


class GoodsReceiptLine(Base):
    __tablename__ = "goods_receipt_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    receipt_id = Column(
        Integer, ForeignKey("goods_receipts.id", ondelete="CASCADE"), nullable=False
    )
    source_line_id = Column(BigInteger, nullable=True)
    item_id = Column(String(50), ForeignKey("items.item_id"), nullable=False)
    description = Column(String(255), nullable=True)
    quantity_received = Column(Numeric(12, 4), nullable=False)
    unit_cost = Column(Numeric(12, 4), nullable=False)
    line_amount = Column(Numeric(12, 2), nullable=False)
    allocated_landed_cost = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    actual_unit_cost = Column(Numeric(12, 4), nullable=True)
    quantity_invoiced = Column(Numeric(12, 4), nullable=False, server_default=text("0"))
    billing_status = Column(String(20), nullable=False, server_default=text("'UNBILLED'"))

    __table_args__ = (
        CheckConstraint("quantity_received > 0", name="chk_gr_line_qty_pos"),
        CheckConstraint(
            "billing_status IN ('UNBILLED', 'PARTIALLY_BILLED', 'FULLY_BILLED')",
            name="chk_gr_line_billing_status",
        ),
    )

    receipt = relationship("GoodsReceipt", back_populates="lines")
    item = relationship("Item")
    invoice_lines = relationship("SupplierInvoiceLine", back_populates="goods_receipt_line")


class SupplierInvoice(Base):
    __tablename__ = "supplier_invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_number = Column(String(50), unique=True, nullable=False)
    vendor_id = Column(String(50), ForeignKey("suppliers.supplier_id"), nullable=False)
    invoice_type = Column(String(20), nullable=False, server_default=text("'PO_MATCHED'"))
    source_type = Column(String(30), nullable=False)
    source_order_id = Column(String(50), nullable=True)
    reference_po_number = Column(String(50), nullable=True)
    vendor_invoice_number = Column(String(100), nullable=True)
    invoice_date = Column(Date, nullable=False)
    posting_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    payment_term_id = Column(UUID(as_uuid=True), ForeignKey("payment_terms.id"), nullable=True)
    payment_terms = Column(String(50), nullable=True)
    status = Column(String(30), nullable=False, server_default=text("'DRAFT'"))
    subtotal = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    freight_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    total_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    outstanding_balance = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    ap_bill_id = Column(String(50), ForeignKey("ap_bills.bill_id"), nullable=True)
    match_warnings = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "invoice_type IN ('PO_MATCHED', 'LANDED_COST', 'EXPENSE')",
            name="chk_supplier_invoice_type",
        ),
        CheckConstraint(
            "source_type IN ('PURCHASE_ORDER', 'SUBCONTRACT_ORDER', 'NON_PO')",
            name="chk_supplier_invoice_source_type",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'PAID', 'CANCELLED')",
            name="chk_supplier_invoice_status",
        ),
    )

    vendor = relationship("Supplier")
    ap_bill = relationship("APBill", foreign_keys=[ap_bill_id])
    payment_term = relationship("PaymentTerm")
    lines = relationship(
        "SupplierInvoiceLine",
        back_populates="invoice",
        cascade="all, delete-orphan",
    )
    distributions = relationship(
        "SupplierInvoiceDistribution",
        back_populates="invoice",
        cascade="all, delete-orphan",
    )


class SupplierInvoiceLine(Base):
    __tablename__ = "supplier_invoice_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id = Column(
        Integer, ForeignKey("supplier_invoices.id", ondelete="CASCADE"), nullable=False
    )
    source_line_id = Column(BigInteger, nullable=True)
    item_id = Column(String(50), ForeignKey("items.item_id"), nullable=True)
    description = Column(String(255), nullable=True)
    quantity_billed = Column(Numeric(12, 4), nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False)
    line_subtotal = Column(Numeric(12, 2), nullable=False)
    goods_receipt_line_id = Column(
        Integer, ForeignKey("goods_receipt_lines.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint("quantity_billed >= 0", name="chk_si_line_qty_pos"),
    )

    invoice = relationship("SupplierInvoice", back_populates="lines")
    item = relationship("Item")
    goods_receipt_line = relationship("GoodsReceiptLine", back_populates="invoice_lines")


class SupplierInvoiceDistribution(Base):
    """GL / cost-center split for Non-PO expense and landed-cost invoices."""

    __tablename__ = "supplier_invoice_distributions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id = Column(
        Integer, ForeignKey("supplier_invoices.id", ondelete="CASCADE"), nullable=False
    )
    gl_account_id = Column(UUID(as_uuid=True), ForeignKey("chart_of_accounts.id"), nullable=False)
    department_id = Column(String(50), ForeignKey("departments.id"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String(255), nullable=True)
    goods_receipt_id = Column(Integer, ForeignKey("goods_receipts.id"), nullable=True)
    goods_receipt_line_id = Column(Integer, ForeignKey("goods_receipt_lines.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_si_dist_amount_pos"),
    )

    invoice = relationship("SupplierInvoice", back_populates="distributions")
    gl_account = relationship("ChartOfAccount")
    department = relationship("Department")
    goods_receipt = relationship("GoodsReceipt")
    goods_receipt_line = relationship("GoodsReceiptLine")


class DocumentAttachment(Base):
    """Supporting files (typically PDFs) attached to any ERP document."""

    __tablename__ = "document_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_type = Column(String(30), nullable=False)
    document_id = Column(String(50), nullable=False)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    file_size = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)
    uploaded_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)

    __table_args__ = (
        CheckConstraint("file_size > 0", name="chk_document_attachment_file_size"),
    )

    uploaded_by = relationship("User")


class DocumentSequence(Base):
    """Persisted per-type / per-month counters for document numbers."""

    __tablename__ = "document_sequences"

    doc_type = Column(String(30), primary_key=True)
    year_month = Column(String(6), primary_key=True)
    last_value = Column(Integer, nullable=False, server_default=text("0"))
    updated_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"), nullable=False)


class CompanyDocumentPrefix(Base):
    """Prefix each company uses when the next document number is issued."""

    __tablename__ = "company_document_prefixes"

    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    doc_type = Column(String(40), primary_key=True)
    prefix = Column(String(20), nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "prefix", name="uq_company_document_prefix"),
    )


class DocumentRevision(Base):
    """Frozen header + lines snapshot for one SO / PO / SCO revision."""

    __tablename__ = "document_revisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_type = Column(String(30), nullable=False)
    document_id = Column(String(50), nullable=False)
    revision_number = Column(Integer, nullable=False)
    root_document_id = Column(String(50), nullable=False)
    snapshot_json = Column(JSONB, nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "document_type",
            "document_id",
            "revision_number",
            name="uq_document_revisions_doc_rev",
        ),
    )

    created_by = relationship("User")


class DocumentChangeLog(Base):
    """Field-level diffs written when a revised document is re-approved."""

    __tablename__ = "document_change_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    document_type = Column(String(30), nullable=False)
    document_id = Column(String(50), nullable=False)
    revision_number = Column(Integer, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    field_name = Column(String(120), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)

    user = relationship("User")


# ========================================================
# MULTI-COMPANY, CURRENCY, PRODUCTION, AND QC
# ========================================================

class Company(Base):
    """Legal entity used to isolate masters and new manufacturing documents."""

    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    country = Column(String(80), nullable=True)
    base_currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    parent_company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    parent = relationship(
        "Company",
        remote_side=[id],
        foreign_keys=[parent_company_id],
        back_populates="subsidiaries",
    )
    subsidiaries = relationship(
        "Company",
        back_populates="parent",
        foreign_keys=[parent_company_id],
    )
    memberships = relationship("UserCompany", back_populates="company", cascade="all, delete-orphan")


class UserCompany(Base):
    __tablename__ = "user_companies"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    is_default = Column(Boolean, nullable=False, server_default=text("false"))

    user = relationship("User", back_populates="company_memberships")
    company = relationship("Company", back_populates="memberships")


class ExchangeRate(Base):
    """How many units of the company base currency equal one unit of quote_currency."""

    __tablename__ = "exchange_rates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    quote_currency = Column(String(3), nullable=False)
    rate_to_base = Column(Numeric(18, 8), nullable=False)
    effective_date = Column(Date, nullable=False)
    source = Column(String(20), nullable=False, server_default=text("'manual'"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "quote_currency",
            "effective_date",
            name="uq_exchange_rate_company_currency_date",
        ),
        CheckConstraint("rate_to_base > 0", name="chk_exchange_rate_positive"),
        CheckConstraint("source IN ('manual', 'frankfurter')", name="chk_exchange_rate_source"),
    )

    company = relationship("Company")


class BomRoutingOperation(Base):
    """Work-center step on an existing BOM revision."""

    __tablename__ = "bom_routing_operations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    bom_header_id = Column(
        BigInteger,
        ForeignKey("itembomheaders.bom_header_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence = Column(Integer, nullable=False)
    work_center_id = Column(
        String(50),
        ForeignKey("work_centers.work_center_id", ondelete="SET NULL"),
        nullable=True,
    )
    name = Column(String(150), nullable=False)
    setup_minutes = Column(Numeric(10, 2), nullable=False, server_default=text("0"))
    run_minutes_per_unit = Column(Numeric(10, 4), nullable=False, server_default=text("0"))

    __table_args__ = (
        UniqueConstraint("bom_header_id", "sequence", name="uq_bom_routing_sequence"),
        CheckConstraint("sequence > 0", name="chk_bom_routing_sequence_pos"),
        CheckConstraint("setup_minutes >= 0", name="chk_bom_routing_setup_nonneg"),
        CheckConstraint("run_minutes_per_unit >= 0", name="chk_bom_routing_run_nonneg"),
    )

    header = relationship("ItemBOMHeader")
    work_center = relationship("WorkCenter")


class StandardOperation(Base):
    """Reusable operation definition. It is not an item."""

    __tablename__ = "standard_operations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    operation_code = Column(String(50), nullable=False)
    name = Column(String(150), nullable=False)
    work_center_id = Column(String(50), ForeignKey("work_centers.work_center_id", ondelete="SET NULL"), nullable=True)
    setup_minutes = Column(Numeric(10, 2), nullable=False, server_default=text("0"))
    run_minutes_per_unit = Column(Numeric(10, 4), nullable=False, server_default=text("0"))
    description = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("company_id", "operation_code", name="uq_standard_operation_code"),
        CheckConstraint("setup_minutes >= 0", name="chk_standard_operation_setup_nonneg"),
        CheckConstraint("run_minutes_per_unit >= 0", name="chk_standard_operation_run_nonneg"),
    )

    company = relationship("Company")
    work_center = relationship("WorkCenter")


class MasterRouting(Base):
    """Versioned route template, independent of any item."""

    __tablename__ = "master_routings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    routing_code = Column(String(50), nullable=False)
    name = Column(String(150), nullable=False)
    version_no = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'draft'"))
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("company_id", "routing_code", "version_no", name="uq_master_routing_version"),
        CheckConstraint("version_no > 0", name="chk_master_routing_version_pos"),
        CheckConstraint("status IN ('draft', 'active', 'obsolete')", name="chk_master_routing_status"),
        Index(
            "uq_one_active_master_routing",
            "company_id",
            "routing_code",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    company = relationship("Company")
    operations = relationship(
        "MasterRoutingOperation",
        back_populates="routing",
        cascade="all, delete-orphan",
        order_by="MasterRoutingOperation.sequence",
    )


class MasterRoutingOperation(Base):
    __tablename__ = "master_routing_operations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    master_routing_id = Column(
        BigInteger,
        ForeignKey("master_routings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence = Column(Integer, nullable=False)
    standard_operation_id = Column(
        BigInteger,
        ForeignKey("standard_operations.id", ondelete="SET NULL"),
        nullable=True,
    )
    work_center_id = Column(String(50), ForeignKey("work_centers.work_center_id", ondelete="SET NULL"), nullable=True)
    operation_name = Column(String(150), nullable=False)
    setup_minutes = Column(Numeric(10, 2), nullable=False, server_default=text("0"))
    run_minutes_per_unit = Column(Numeric(10, 4), nullable=False, server_default=text("0"))

    __table_args__ = (
        UniqueConstraint("master_routing_id", "sequence", name="uq_master_routing_sequence"),
        CheckConstraint("sequence > 0", name="chk_master_routing_op_sequence_pos"),
        CheckConstraint("setup_minutes >= 0", name="chk_master_routing_op_setup_nonneg"),
        CheckConstraint("run_minutes_per_unit >= 0", name="chk_master_routing_op_run_nonneg"),
    )

    routing = relationship("MasterRouting", back_populates="operations")
    standard_operation = relationship("StandardOperation")
    work_center = relationship("WorkCenter")


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    production_order_id = Column(String(50), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    item_id = Column(String(50), ForeignKey("items.item_id"), nullable=False)
    bom_header_id = Column(
        BigInteger,
        ForeignKey("itembomheaders.bom_header_id", ondelete="SET NULL"),
        nullable=True,
    )
    warehouse_id = Column(String(50), ForeignKey("warehouses.warehouse_id"), nullable=True)
    sales_order_id = Column(
        String(50),
        ForeignKey("salesorders.sales_order_id", ondelete="SET NULL"),
        nullable=True,
    )
    qty_ordered = Column(Integer, nullable=False)
    qty_completed = Column(Integer, nullable=False, server_default=text("0"))
    scrapped_qty = Column(Integer, nullable=False, server_default=text("0"))
    status = Column(String(20), nullable=False, server_default=text("'draft'"))
    order_date = Column(Date, nullable=False)
    planned_start = Column(Date, nullable=True)
    planned_end = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    master_routing_id = Column(BigInteger, ForeignKey("master_routings.id", ondelete="SET NULL"), nullable=True)
    routing_code = Column(String(50), nullable=True)
    routing_version_no = Column(Integer, nullable=True)
    transaction_currency = Column(String(3), nullable=False, server_default=text("'USD'"))
    exchange_rate = Column(Numeric(18, 8), nullable=True)
    rate_date = Column(Date, nullable=True)
    transaction_amount = Column(Numeric(14, 2), nullable=False, server_default=text("0"))
    base_amount = Column(Numeric(14, 2), nullable=True)
    backflushed_units = Column(Integer, nullable=False, server_default=text("0"))
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint("qty_ordered > 0", name="chk_production_order_qty_pos"),
        CheckConstraint("qty_completed >= 0", name="chk_production_order_completed_nonneg"),
        CheckConstraint("scrapped_qty >= 0", name="chk_production_order_scrapped_nonneg"),
        CheckConstraint("backflushed_units >= 0", name="chk_production_order_backflush_nonneg"),
        CheckConstraint(
            "status IN ('draft', 'released', 'in_process', 'completed', 'closed', 'cancelled')",
            name="chk_production_order_status",
        ),
    )

    company = relationship("Company")
    item = relationship("Item")
    bom_header = relationship("ItemBOMHeader")
    warehouse = relationship("Warehouse")
    materials = relationship(
        "ProductionOrderMaterial",
        back_populates="order",
        cascade="all, delete-orphan",
    )
    issues = relationship("ProductionIssue", back_populates="order", cascade="all, delete-orphan")
    receipts = relationship("ProductionReceipt", back_populates="order", cascade="all, delete-orphan")
    operations = relationship(
        "ProductionOrderRouting",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="ProductionOrderRouting.operation_sequence",
    )


class ProductionOrderMaterial(Base):
    __tablename__ = "production_order_materials"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    production_order_id = Column(
        String(50),
        ForeignKey("production_orders.production_order_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    component_item_id = Column(String(50), ForeignKey("items.item_id"), nullable=True)
    component_code = Column(String(50), nullable=True)
    item_type = Column(String(30), nullable=False, server_default=text("'Material'"))
    quantity_required = Column(Numeric(12, 4), nullable=False)
    quantity_issued = Column(Numeric(12, 4), nullable=False, server_default=text("0"))
    warehouse_id = Column(String(50), ForeignKey("warehouses.warehouse_id"), nullable=True)
    lot_serial_tracking_required = Column(Boolean, nullable=False, server_default=text("false"))

    order = relationship("ProductionOrder", back_populates="materials")
    component_item = relationship("Item")
    warehouse = relationship("Warehouse")


class ProductionOrderRouting(Base):
    """Routing step copied onto a production order, plus shop-floor actuals.

    The sequence and standard times stay as they were when the order was created.
    Actual quantities, labor, and completion time are recorded here as the step runs.
    """

    __tablename__ = "production_order_routing"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    production_order_id = Column(
        String(50),
        ForeignKey("production_orders.production_order_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    operation_sequence = Column(Integer, nullable=False)
    work_center_id = Column(String(50), ForeignKey("work_centers.work_center_id"), nullable=True)
    operation_name = Column(String(150), nullable=False)
    setup_time = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    run_time = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    status = Column(String(20), nullable=False, server_default=text("'pending'"))
    setup_minutes_actual = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    run_minutes_actual = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    good_quantity = Column(Integer, nullable=False, server_default=text("0"))
    scrap_quantity = Column(Integer, nullable=False, server_default=text("0"))
    rework_quantity = Column(Integer, nullable=False, server_default=text("0"))
    scrap_reason_code = Column(String(40), nullable=True)
    labor_hours = Column(Numeric(12, 4), nullable=False, server_default=text("0"))
    operator_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("operation_sequence > 0", name="chk_production_routing_sequence_pos"),
        CheckConstraint("setup_time >= 0", name="chk_production_routing_setup_nonneg"),
        CheckConstraint("run_time >= 0", name="chk_production_routing_run_nonneg"),
        CheckConstraint("setup_minutes_actual >= 0", name="chk_production_routing_setup_actual_nonneg"),
        CheckConstraint("run_minutes_actual >= 0", name="chk_production_routing_run_actual_nonneg"),
        CheckConstraint("good_quantity >= 0", name="chk_production_routing_good_nonneg"),
        CheckConstraint("scrap_quantity >= 0", name="chk_production_routing_scrap_nonneg"),
        CheckConstraint("rework_quantity >= 0", name="chk_production_routing_rework_nonneg"),
        CheckConstraint("labor_hours >= 0", name="chk_production_routing_labor_nonneg"),
        CheckConstraint(
            "status IN ('pending', 'running', 'completed')",
            name="chk_production_routing_status",
        ),
    )

    order = relationship("ProductionOrder", back_populates="operations")
    work_center = relationship("WorkCenter")
    operator = relationship("User")
    company = relationship("Company")
    labor_logs = relationship(
        "ProductionStepLaborLog",
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="ProductionStepLaborLog.id",
    )
    scrap_entries = relationship(
        "ProductionStepScrap",
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="ProductionStepScrap.id",
    )
    backflushes = relationship(
        "ProductionMaterialBackflush",
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="ProductionMaterialBackflush.id",
    )
    quality_checks = relationship(
        "ProductionStepQuality",
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="ProductionStepQuality.id",
    )
    downtime_logs = relationship(
        "ProductionStepDowntime",
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="ProductionStepDowntime.id",
    )
    parameters = relationship(
        "ProductionStepParameter",
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="ProductionStepParameter.id",
    )

    @property
    def processed_quantity(self) -> int:
        return int(self.good_quantity or 0) + int(self.scrap_quantity or 0)

    @property
    def standard_minutes(self):
        if self.status != "completed":
            return None
        units = Decimal(self.processed_quantity)
        return (Decimal(self.setup_time or 0) + Decimal(self.run_time or 0) * units).quantize(Decimal("0.01"))

    @property
    def actual_minutes(self):
        if self.status != "completed":
            return None
        return (Decimal(self.setup_minutes_actual or 0) + Decimal(self.run_minutes_actual or 0)).quantize(Decimal("0.01"))

    @property
    def variance_minutes(self):
        if self.standard_minutes is None or self.actual_minutes is None:
            return None
        return (self.actual_minutes - self.standard_minutes).quantize(Decimal("0.01"))


class ProductionStepLaborLog(Base):
    """Direct labor interval for one routing step."""

    __tablename__ = "production_step_labor_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    routing_step_id = Column(
        BigInteger,
        ForeignKey("production_order_routing.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    production_order_id = Column(String(50), nullable=False)
    operator_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    stopped_at = Column(DateTime(timezone=True), nullable=True)
    labor_hours = Column(Numeric(12, 4), nullable=False, server_default=text("0"))
    notes = Column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("labor_hours >= 0", name="chk_step_labor_hours_nonneg"),
    )

    step = relationship("ProductionOrderRouting", back_populates="labor_logs")
    operator = relationship("User")
    company = relationship("Company")


class ProductionStepScrap(Base):
    __tablename__ = "production_step_scrap"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    routing_step_id = Column(
        BigInteger,
        ForeignKey("production_order_routing.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity = Column(Integer, nullable=False)
    reason_code = Column(String(40), nullable=False)
    defect_class = Column(String(40), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint("quantity > 0", name="chk_step_scrap_qty_pos"),
    )

    step = relationship("ProductionOrderRouting", back_populates="scrap_entries")
    company = relationship("Company")


class ProductionMaterialBackflush(Base):
    """Component quantity consumed when a routing step reports good and scrap output."""

    __tablename__ = "production_material_backflushes"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    production_order_id = Column(
        String(50),
        ForeignKey("production_orders.production_order_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    routing_step_id = Column(
        BigInteger,
        ForeignKey("production_order_routing.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    material_id = Column(
        BigInteger,
        ForeignKey("production_order_materials.id", ondelete="SET NULL"),
        nullable=True,
    )
    component_item_id = Column(String(50), ForeignKey("items.item_id"), nullable=True)
    quantity = Column(Numeric(12, 4), nullable=False)
    lot_number = Column(String(80), nullable=True)
    serial_number = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint("quantity > 0", name="chk_backflush_qty_pos"),
    )

    step = relationship("ProductionOrderRouting", back_populates="backflushes")
    material = relationship("ProductionOrderMaterial")
    component_item = relationship("Item")
    company = relationship("Company")


class ProductionStepQuality(Base):
    """In-process check recorded at a routing step."""

    __tablename__ = "production_step_quality"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    routing_step_id = Column(
        BigInteger,
        ForeignKey("production_order_routing.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    characteristic = Column(String(150), nullable=False)
    specification = Column(String(255), nullable=True)
    measured_value = Column(String(255), nullable=True)
    passed = Column(Boolean, nullable=False, server_default=text("false"))
    defect_class = Column(String(40), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    step = relationship("ProductionOrderRouting", back_populates="quality_checks")
    company = relationship("Company")


class ProductionStepDowntime(Base):
    __tablename__ = "production_step_downtime"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    routing_step_id = Column(
        BigInteger,
        ForeignKey("production_order_routing.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reason_code = Column(String(40), nullable=False)
    minutes = Column(Numeric(12, 2), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint("minutes > 0", name="chk_step_downtime_minutes_pos"),
    )

    step = relationship("ProductionOrderRouting", back_populates="downtime_logs")
    company = relationship("Company")


class ProductionStepParameter(Base):
    """Machine setting or reading logged for a routing step."""

    __tablename__ = "production_step_parameters"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    routing_step_id = Column(
        BigInteger,
        ForeignKey("production_order_routing.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(80), nullable=False)
    value = Column(String(80), nullable=False)
    unit = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    step = relationship("ProductionOrderRouting", back_populates="parameters")
    company = relationship("Company")


class ProductionIssue(Base):
    __tablename__ = "production_issues"

    issue_id = Column(String(50), primary_key=True)
    production_order_id = Column(
        String(50),
        ForeignKey("production_orders.production_order_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    issue_date = Column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    order = relationship("ProductionOrder", back_populates="issues")
    lines = relationship("ProductionIssueLine", back_populates="issue", cascade="all, delete-orphan")


class ProductionIssueLine(Base):
    __tablename__ = "production_issue_lines"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    issue_id = Column(
        String(50),
        ForeignKey("production_issues.issue_id", ondelete="CASCADE"),
        nullable=False,
    )
    material_id = Column(
        BigInteger,
        ForeignKey("production_order_materials.id", ondelete="SET NULL"),
        nullable=True,
    )
    component_item_id = Column(String(50), ForeignKey("items.item_id"), nullable=False)
    quantity_issued = Column(Numeric(12, 4), nullable=False)

    __table_args__ = (
        CheckConstraint("quantity_issued > 0", name="chk_production_issue_qty_pos"),
    )

    issue = relationship("ProductionIssue", back_populates="lines")
    material = relationship("ProductionOrderMaterial")
    component_item = relationship("Item")


class ProductionReceipt(Base):
    __tablename__ = "production_receipts"

    receipt_id = Column(String(50), primary_key=True)
    production_order_id = Column(
        String(50),
        ForeignKey("production_orders.production_order_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity_received = Column(Integer, nullable=False)
    receipt_date = Column(Date, nullable=False, server_default=text("CURRENT_DATE"))
    posted_to_stock = Column(Boolean, nullable=False, server_default=text("false"))
    stock_disposition = Column(String(20), nullable=False, server_default=text("'unposted'"))
    completion_counted = Column(Boolean, nullable=False, server_default=text("false"))
    received_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint("quantity_received > 0", name="chk_production_receipt_qty_pos"),
        CheckConstraint(
            "stock_disposition IN ('unposted', 'unrestricted', 'quarantine', 'scrap', 'rework')",
            name="chk_production_receipt_disposition",
        ),
    )

    order = relationship("ProductionOrder", back_populates="receipts")
    received_by = relationship("User")


class Inspection(Base):
    __tablename__ = "inspections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    source_type = Column(String(30), nullable=False)
    source_id = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'pending'"))
    inspector_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    inspected_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    reference_document = Column(String(50), nullable=True)
    prior_inspection_id = Column(UUID(as_uuid=True), ForeignKey("inspections.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(
        DateTime(timezone=True),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('production_receipt', 'goods_receipt')",
            name="chk_inspection_source_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected')",
            name="chk_inspection_status",
        ),
    )

    company = relationship("Company")
    inspector = relationship("User")
    results = relationship("InspectionResult", back_populates="inspection", cascade="all, delete-orphan")

    @property
    def document_no(self) -> str:
        return self.source_id

    @property
    def inspector_name(self) -> str | None:
        inspector = self.inspector
        if inspector is None:
            return None
        return inspector.full_name


class InspectionResult(Base):
    __tablename__ = "inspection_results"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    inspection_id = Column(
        UUID(as_uuid=True),
        ForeignKey("inspections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    characteristic = Column(String(150), nullable=False)
    specification = Column(String(255), nullable=True)
    measured_value = Column(String(255), nullable=True)
    method = Column(String(20), nullable=True)
    min_value = Column(Numeric(14, 4), nullable=True)
    max_value = Column(Numeric(14, 4), nullable=True)
    unit = Column(String(20), nullable=True)
    passed = Column(Boolean, nullable=False, server_default=text("false"))

    inspection = relationship("Inspection", back_populates="results")


class InspectionPlan(Base):
    """Standard characteristic and pass limits for a finished item."""

    __tablename__ = "inspection_plans"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    item_id = Column(String(50), ForeignKey("items.item_id"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, server_default=text("10"))
    characteristic = Column(String(150), nullable=False)
    method = Column(String(20), nullable=False)
    min_value = Column(Numeric(14, 4), nullable=True)
    max_value = Column(Numeric(14, 4), nullable=True)
    unit = Column(String(20), nullable=True)
    options = Column(String(255), nullable=True)
    pass_options = Column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("company_id", "item_id", "characteristic", name="uq_inspection_plan_characteristic"),
        CheckConstraint("method IN ('numeric', 'attribute')", name="chk_inspection_plan_method"),
        CheckConstraint("sequence > 0", name="chk_inspection_plan_sequence_pos"),
    )


class ReinspectionRequest(Base):
    """Formal request to open another inspection after a lot is closed."""

    __tablename__ = "reinspection_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    inspection_id = Column(UUID(as_uuid=True), ForeignKey("inspections.id"), nullable=False)
    source_type = Column(String(30), nullable=False)
    source_id = Column(String(50), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'pending'"))
    requested_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    decided_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    decided_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'consumed')",
            name="chk_reinspection_status",
        ),
    )

    requested_by = relationship("User", foreign_keys=[requested_by_user_id])
    decided_by = relationship("User", foreign_keys=[decided_by_user_id])


class QualityAuditNote(Base):
    """Audited quality event, including legacy stock mismatches and emergency bypasses."""

    __tablename__ = "quality_audit_notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    source_type = Column(String(30), nullable=False)
    source_id = Column(String(50), nullable=False, index=True)
    note_code = Column(String(40), nullable=False)
    message = Column(Text, nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    __table_args__ = (
        CheckConstraint(
            "note_code IN ('Legacy_Stock_Override', 'Emergency_Override', 'Scrap', 'Rework')",
            name="chk_quality_audit_note_code",
        ),
    )

    created_by = relationship("User")
    alerts = relationship("QualityAlert", back_populates="audit_note", cascade="all, delete-orphan")


class QualityAlert(Base):
    """Notice sent to plant leadership when an emergency quality bypass is used."""

    __tablename__ = "quality_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    audit_note_id = Column(
        UUID(as_uuid=True),
        ForeignKey("quality_audit_notes.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    recipient_role_id = Column(String(50), nullable=False, server_default=text("'ROLE-MANAGER'"))
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)

    audit_note = relationship("QualityAuditNote", back_populates="alerts")
    recipient = relationship("User")
