from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _clip_str(value: Any, max_len: int) -> Any:
    if isinstance(value, str) and len(value) > max_len:
        return value[:max_len]
    return value


def _quantize_decimal(value: Any, places: int) -> Any:
    if value is None or value == '':
        return value
    try:
        amount = Decimal(str(value))
    except Exception:
        return value
    if not amount.is_finite():
        return Decimal('0')
    return amount.quantize(Decimal('1').scaleb(-places))


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

class PaymentTermCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    description: str = Field(min_length=1, max_length=255)
    due_days: int = Field(ge=0)
    discount_days: int | None = Field(default=None, ge=0)
    discount_percentage: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=2)
    is_active: bool = True

    @field_validator("code", "description", mode="before")
    @classmethod
    def strip_payment_term_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class PaymentTermUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=20)
    description: str | None = Field(default=None, min_length=1, max_length=255)
    due_days: int | None = Field(default=None, ge=0)
    discount_days: int | None = Field(default=None, ge=0)
    discount_percentage: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=2)
    is_active: bool | None = None

    @field_validator("code", "description", mode="before")
    @classmethod
    def strip_payment_term_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class PaymentTermRead(ORMModel):
    id: UUID
    code: str
    description: str
    due_days: int
    discount_days: int | None = None
    discount_percentage: Decimal | None = None
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


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




CUSTOMER_STATUSES = ('ACTIVE', 'INACTIVE', 'ON_HOLD')
LOCATION_TYPES = ('BILL_TO', 'SHIP_TO', 'BOTH')
TAX_ID_TYPES = ('EIN', 'TIN', 'VAT', 'SSN', 'OTHER')


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str) and value.strip() == '':
        return None
    return value


def _normalize_tax_id_type(value: Any) -> Any:
    cleaned = _blank_to_none(value)
    if cleaned is None:
        return None
    normalized = str(cleaned).strip().upper().replace(' ', '_')
    aliases = {
        'EMPLOYER_IDENTIFICATION_NUMBER': 'EIN',
        'TAXPAYER_IDENTIFICATION_NUMBER': 'TIN',
        'VALUE_ADDED_TAX': 'VAT',
        'SOCIAL_SECURITY_NUMBER': 'SSN',
        'OTHER': 'OTHER',
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in TAX_ID_TYPES:
        raise ValueError(f'tax_id_type must be one of: {", ".join(TAX_ID_TYPES)}')
    return normalized


def validate_customer_locations(locations: list['CustomerLocationNested']) -> None:
    """Require bill-to + ship-to coverage and at most one default of each role."""
    if not locations:
        raise ValueError('At least one BILL_TO and one SHIP_TO location are required (or one BOTH).')

    has_bill = any(loc.location_type in ('BILL_TO', 'BOTH') for loc in locations)
    has_ship = any(loc.location_type in ('SHIP_TO', 'BOTH') for loc in locations)
    if not has_bill:
        raise ValueError('At least one BILL_TO location is required (or a location set to BOTH).')
    if not has_ship:
        raise ValueError('At least one SHIP_TO location is required (or a location set to BOTH).')

    default_bill = [loc for loc in locations if loc.is_default and loc.location_type in ('BILL_TO', 'BOTH')]
    default_ship = [loc for loc in locations if loc.is_default and loc.location_type in ('SHIP_TO', 'BOTH')]
    if len(default_bill) > 1:
        raise ValueError('A customer may have at most one default BILL_TO location.')
    if len(default_ship) > 1:
        raise ValueError('A customer may have at most one default SHIP_TO location.')


class CustomerCertificationNested(BaseModel):
    id: int | None = None
    certification_name: str = Field(min_length=1, max_length=100)
    certificate_number: str | None = Field(default=None, max_length=100)
    valid_until: date | None = None

    @field_validator('certificate_number', mode='before')
    @classmethod
    def blank_cert_number(cls, value: Any) -> Any:
        return _blank_to_none(value)


class CustomerCertificationRead(ORMModel):
    id: int
    customer_id: str
    certification_name: str
    certificate_number: str | None
    valid_until: date | None


class CustomerLocationNested(BaseModel):
    location_id: str | None = Field(default=None, max_length=50)
    location_type: Literal['BILL_TO', 'SHIP_TO', 'BOTH']
    location_code: str | None = Field(default=None, max_length=50)
    location_name: str = Field(min_length=1, max_length=150)
    attention_to: str | None = Field(default=None, max_length=100)
    address_line1: str = Field(min_length=1, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str = Field(min_length=1, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=32)
    country: str = Field(min_length=1, max_length=50)
    contact_person: str | None = Field(default=None, max_length=150)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=50)
    is_default: bool = False
    tax_id: str | None = Field(default=None, max_length=64)
    shipping_instructions: str | None = None

    @field_validator(
        'location_id',
        'location_code',
        'attention_to',
        'address_line2',
        'state',
        'state_province',
        'contact_person',
        'contact_email',
        'contact_phone',
        'tax_id',
        'shipping_instructions',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @model_validator(mode='after')
    def unify_state_province(self) -> 'CustomerLocationNested':
        province = self.state_province or self.state
        self.state = province
        self.state_province = province
        return self


class CustomerLocationCreate(BaseModel):
    location_id: str = Field(max_length=50)
    customer_id: str = Field(max_length=50)
    location_type: Literal['BILL_TO', 'SHIP_TO', 'BOTH']
    location_code: str | None = Field(default=None, max_length=50)
    location_name: str | None = Field(default=None, max_length=150)
    attention_to: str | None = Field(default=None, max_length=100)
    address_line1: str = Field(min_length=1, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str = Field(min_length=1, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=32)
    country: str = Field(min_length=1, max_length=50)
    contact_person: str | None = Field(default=None, max_length=150)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=50)
    is_default: bool = False
    tax_id: str | None = Field(default=None, max_length=64)
    shipping_instructions: str | None = None

    @field_validator(
        'location_code',
        'location_name',
        'attention_to',
        'address_line2',
        'state',
        'state_province',
        'contact_person',
        'contact_email',
        'contact_phone',
        'tax_id',
        'shipping_instructions',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @model_validator(mode='after')
    def apply_defaults(self) -> 'CustomerLocationCreate':
        province = self.state_province or self.state
        self.state = province
        self.state_province = province
        if not self.location_name:
            self.location_name = self.location_id
        return self


class CustomerLocationUpdate(BaseModel):
    location_type: Literal['BILL_TO', 'SHIP_TO', 'BOTH'] | None = None
    location_code: str | None = Field(default=None, max_length=50)
    location_name: str | None = Field(default=None, max_length=150)
    attention_to: str | None = Field(default=None, max_length=100)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    state_province: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=32)
    country: str | None = Field(default=None, max_length=50)
    contact_person: str | None = Field(default=None, max_length=150)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=50)
    is_default: bool | None = None
    tax_id: str | None = Field(default=None, max_length=64)
    shipping_instructions: str | None = None

    @field_validator(
        'location_code',
        'location_name',
        'attention_to',
        'address_line2',
        'state',
        'state_province',
        'contact_person',
        'contact_email',
        'contact_phone',
        'tax_id',
        'shipping_instructions',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @model_validator(mode='after')
    def unify_state_province(self) -> 'CustomerLocationUpdate':
        if self.state_province and not self.state:
            self.state = self.state_province
        if self.state and not self.state_province:
            self.state_province = self.state
        return self


class CustomerLocationRead(ORMModel):
    location_id: str
    customer_id: str
    location_type: str
    location_code: str | None = None
    location_name: str | None = None
    attention_to: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    state_province: str | None = None
    postal_code: str | None = None
    country: str | None = None
    contact_person: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    is_default: bool = False
    tax_id: str | None = None
    shipping_instructions: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @model_validator(mode='after')
    def expose_state_province(self) -> 'CustomerLocationRead':
        self.state_province = self.state_province or self.state
        return self


class CustomerBase(BaseModel):
    customer_number_ext: str | None = Field(default=None, max_length=50)
    company_name: str = Field(min_length=1, max_length=255)
    tax_id_type: str | None = Field(default=None, max_length=16)
    tax_id: str | None = Field(default=None, max_length=64)
    industry_type: str | None = Field(default=None, max_length=100)
    facility_type: str | None = Field(default=None, max_length=100)
    website: str | None = Field(default=None, max_length=255)
    primary_contact_name: str | None = Field(default=None, max_length=255)
    primary_email: EmailStr | None = None
    primary_phone: str | None = Field(default=None, max_length=50)
    currency: str = Field(default='USD', min_length=3, max_length=3)
    credit_limit: Decimal = Field(default=Decimal('0.00'), ge=0, decimal_places=2)
    payment_terms: str | None = Field(default=None, max_length=50)
    payment_term_id: UUID | None = None
    preferred_incoterms: str | None = Field(default=None, max_length=10)
    preferred_shipping_method: str | None = Field(default=None, max_length=50)
    tax_exempt: bool = False
    tax_exempt_certificate_id: str | None = Field(default=None, max_length=100)
    status: str = Field(default='ACTIVE', max_length=32)

    @field_validator(
        'customer_number_ext',
        'tax_id',
        'industry_type',
        'facility_type',
        'website',
        'primary_contact_name',
        'primary_email',
        'primary_phone',
        'payment_terms',
        'payment_term_id',
        'preferred_incoterms',
        'preferred_shipping_method',
        'tax_exempt_certificate_id',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator('tax_id_type', mode='before')
    @classmethod
    def normalize_tax_id_type(cls, value: Any) -> Any:
        return _normalize_tax_id_type(value)

    @field_validator('currency', mode='before')
    @classmethod
    def normalize_currency(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return 'USD'
        return str(value).strip().upper()

    @field_validator('status', mode='before')
    @classmethod
    def normalize_status(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return 'ACTIVE'
        status = str(value).strip().upper().replace(' ', '_')
        if status not in CUSTOMER_STATUSES:
            raise ValueError(f'status must be one of: {", ".join(CUSTOMER_STATUSES)}')
        return status

    @field_validator('preferred_incoterms', mode='before')
    @classmethod
    def normalize_incoterms(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().upper()


class CustomerCreate(CustomerBase):
    customer_id: str = Field(max_length=50)
    locations: list[CustomerLocationNested] | None = None
    certifications: list[CustomerCertificationNested] | None = None

    @model_validator(mode='after')
    def validate_nested(self) -> 'CustomerCreate':
        if self.locations is not None:
            validate_customer_locations(self.locations)
        return self


class CustomerUpdate(BaseModel):
    """Partial header-only update (PATCH). Nested sync uses PUT."""

    customer_number_ext: str | None = Field(default=None, max_length=50)
    company_name: str | None = Field(default=None, min_length=1, max_length=255)
    tax_id_type: str | None = Field(default=None, max_length=16)
    tax_id: str | None = Field(default=None, max_length=64)
    industry_type: str | None = Field(default=None, max_length=100)
    facility_type: str | None = Field(default=None, max_length=100)
    website: str | None = Field(default=None, max_length=255)
    primary_contact_name: str | None = Field(default=None, max_length=255)
    primary_email: EmailStr | None = None
    primary_phone: str | None = Field(default=None, max_length=50)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    credit_limit: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    payment_terms: str | None = Field(default=None, max_length=50)
    payment_term_id: UUID | None = None
    preferred_incoterms: str | None = Field(default=None, max_length=10)
    preferred_shipping_method: str | None = Field(default=None, max_length=50)
    tax_exempt: bool | None = None
    tax_exempt_certificate_id: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=32)

    @field_validator(
        'customer_number_ext',
        'tax_id',
        'industry_type',
        'facility_type',
        'website',
        'primary_contact_name',
        'primary_email',
        'primary_phone',
        'payment_terms',
        'payment_term_id',
        'preferred_incoterms',
        'preferred_shipping_method',
        'tax_exempt_certificate_id',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator('tax_id_type', mode='before')
    @classmethod
    def normalize_tax_id_type(cls, value: Any) -> Any:
        return _normalize_tax_id_type(value)

    @field_validator('currency', mode='before')
    @classmethod
    def normalize_currency(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().upper()

    @field_validator('status', mode='before')
    @classmethod
    def normalize_status(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        status = str(cleaned).strip().upper().replace(' ', '_')
        if status not in CUSTOMER_STATUSES:
            raise ValueError(f'status must be one of: {", ".join(CUSTOMER_STATUSES)}')
        return status


class CustomerUpsert(CustomerBase):
    """Full nested create/update payload (POST body / PUT body)."""

    customer_id: str | None = Field(default=None, max_length=50)
    locations: list[CustomerLocationNested]
    certifications: list[CustomerCertificationNested] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_nested(self) -> 'CustomerUpsert':
        validate_customer_locations(self.locations)
        return self


class CustomerRead(ORMModel):
    customer_id: str
    customer_number_ext: str | None = None
    company_name: str
    tax_id_type: str | None = None
    tax_id: str | None = None
    industry_type: str | None = None
    facility_type: str | None = None
    website: str | None = None
    primary_contact_name: str | None = None
    primary_email: str | None = None
    primary_phone: str | None = None
    currency: str = 'USD'
    credit_limit: Decimal = Decimal('0.00')
    payment_terms: str | None = None
    payment_term_id: UUID | None = None
    preferred_incoterms: str | None = None
    preferred_shipping_method: str | None = None
    tax_exempt: bool = False
    tax_exempt_certificate_id: str | None = None
    status: str = 'ACTIVE'
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CustomerDetailRead(CustomerRead):
    locations: list[CustomerLocationRead] = Field(default_factory=list)
    bill_to_locations: list[CustomerLocationRead] = Field(default_factory=list)
    ship_to_locations: list[CustomerLocationRead] = Field(default_factory=list)
    certifications: list[CustomerCertificationRead] = Field(default_factory=list)


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
    customer_part_number: str | None = Field(default=None, max_length=50)
    quantity_ordered: int = Field(gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=4)
    tax_amount: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    total_amount: Decimal = Field(ge=0, decimal_places=2)

class SalesOrderItemRead(ORMModel):
    so_item_id: int
    sales_order_id: str
    line_number: int
    item_id: str
    customer_part_number: str | None = None
    quantity_ordered: int
    unit_price: Decimal
    tax_amount: Decimal
    total_amount: Decimal

class SalesOrderCreate(BaseModel):
    sales_order_id: str | None = Field(default=None, max_length=50)
    customer_id: str = Field(max_length=50)
    # NEW: Link to the specific locations for this order
    bill_to_location_id: str = Field(max_length=50)
    ship_to_location_id: str = Field(max_length=50)
    customer_po_number: str = Field(max_length=50)
    po_revision_number: int = Field(default=0)
    order_date: date
    customer_revision_date: date | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    payment_term_id: UUID | None = None
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
    customer_revision_date: date | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    payment_term_id: UUID | None = None
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
    customer_revision_date: date | None = None
    payment_terms: str | None
    payment_term_id: UUID | None = None
    freight_terms: str | None
    shipping_method: str | None
    currency: str
    buyer_contact_name: str | None
    buyer_contact_email: EmailStr | None
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    total_amount: Decimal
    billed_amount: Decimal = Decimal("0.00")
    remaining_billable_amount: Decimal = Decimal("0.00")
    invoice_status: str = "UNBILLED"
    created_at: datetime | None

    # NEW: When we fetch an order, return its items too
    items: list[SalesOrderItemRead] = []

class SalesOrderDeliveryScheduleCreate(BaseModel):
    so_item_id: int
    sub_line_number: str | None = Field(default=None, max_length=10)
    ship_to_location_id: str | None = Field(default=None, max_length=50)
    scheduled_quantity: int = Field(gt=0)
    needed_delivery_date: datetime
    promised_ship_date: datetime | None = None
    requester_name: str | None = Field(default=None, max_length=100)
    tax_flag: str = Field(default="N", max_length=1)
    status: str = Field(default="PENDING", max_length=30)

class SalesOrderDeliveryScheduleRead(ORMModel):
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

VENDOR_TYPES = ('material', 'subcontractor', 'both', 'service')
PAYMENT_METHODS = ('wire', 'ach', 'check', 'credit_card')
QC_STATUSES = ('approved', 'probation', 'blocked')
TAX_DOCUMENT_TYPES = (
    'W-8BEN-E',
    'W-8BEN',
    'Certificate of Foreign Status',
    'Other',
    'W-9',
)


def _normalize_swift_code(value: Any) -> Any:
    cleaned = _blank_to_none(value)
    if cleaned is None:
        return None
    code = str(cleaned).strip().replace(' ', '').upper()
    if not code.isalnum() or len(code) not in (8, 11):
        raise ValueError('SWIFT / BIC must be 8 or 11 alphanumeric characters')
    return code


def _normalize_tax_document_type(value: Any) -> Any:
    cleaned = _blank_to_none(value)
    if cleaned is None:
        return None
    label = str(cleaned).strip()
    lookup: dict[str, str | None] = {item.upper(): item for item in TAX_DOCUMENT_TYPES}
    lookup.update({
        'W8BENE': 'W-8BEN-E',
        'W-8BENE': 'W-8BEN-E',
        'W8BEN': 'W-8BEN',
        'W9': 'W-9',
        'NONE': None,
    })
    key = label.upper()
    compact = key.replace(' ', '').replace('_', '-')
    if key in lookup:
        return lookup[key]
    if compact in lookup:
        return lookup[compact]
    raise ValueError(f'tax_document_type must be one of: {", ".join(TAX_DOCUMENT_TYPES)}')


class WorkCenterCreate(BaseModel):
    work_center_id: str = Field(max_length=50)
    name: str = Field(min_length=1, max_length=150)
    warehouse_id: str | None = Field(default=None, max_length=50)
    is_active: bool = True


class WorkCenterRead(ORMModel):
    work_center_id: str
    name: str
    warehouse_id: str | None = None
    is_active: bool = True
    created_at: datetime | None = None


class SupplierBase(BaseModel):
    company_name: str = Field(min_length=1, max_length=255)
    contact_name: str | None = Field(default=None, max_length=100)
    contact_email: EmailStr | None = None
    phone_number: str | None = Field(default=None, max_length=50)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=50)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=50)
    vendor_number_ext: str | None = Field(default=None, max_length=50)
    payment_terms: str | None = Field(default="Net 30", max_length=50)
    payment_term_id: UUID | None = None
    status: str | None = Field(default="Active", max_length=20)
    vendor_type: Literal['material', 'subcontractor', 'both', 'service'] = 'material'
    tax_id: str | None = Field(default=None, max_length=50)
    tax_document_type: str | None = Field(default=None, max_length=64)
    is_overseas: bool = False
    currency: str = Field(default='USD', min_length=3, max_length=3)
    ap_account_id: UUID | None = None
    payment_method: Literal['wire', 'ach', 'check', 'credit_card'] | None = None
    incoterms: str | None = Field(default=None, max_length=10)
    incoterm_location: str | None = Field(default=None, max_length=150)
    country_of_origin: str | None = Field(default=None, max_length=50)
    bank_name: str | None = Field(default=None, max_length=150)
    swift_code: str | None = Field(default=None, max_length=11)
    iban_account_number: str | None = Field(default=None, max_length=64)
    bank_address: str | None = None
    intermediary_bank_name: str | None = Field(default=None, max_length=150)
    intermediary_swift_code: str | None = Field(default=None, max_length=11)
    intermediary_routing_aba: str | None = Field(default=None, max_length=20)
    lead_time_days: int = Field(default=0, ge=0)
    work_center_id: str | None = Field(default=None, max_length=50)
    consignment_stock_loc_id: str | None = Field(default=None, max_length=50)
    standard_scrap_rate: Decimal = Field(default=Decimal('0.00'), ge=0, le=100, decimal_places=2)
    iso_certified: bool = False
    qc_status: Literal['approved', 'probation', 'blocked'] = 'approved'
    notes: str | None = None

    @field_validator(
        'contact_name',
        'contact_email',
        'phone_number',
        'address_line1',
        'address_line2',
        'city',
        'state',
        'postal_code',
        'country',
        'vendor_number_ext',
        'payment_terms',
        'payment_term_id',
        'tax_id',
        'tax_document_type',
        'ap_account_id',
        'payment_method',
        'incoterms',
        'incoterm_location',
        'country_of_origin',
        'bank_name',
        'swift_code',
        'iban_account_number',
        'bank_address',
        'intermediary_bank_name',
        'intermediary_swift_code',
        'intermediary_routing_aba',
        'work_center_id',
        'consignment_stock_loc_id',
        'notes',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator('currency', mode='before')
    @classmethod
    def normalize_currency(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return 'USD'
        return str(value).strip().upper()

    @field_validator('vendor_type', mode='before')
    @classmethod
    def normalize_vendor_type(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return 'material'
        return str(value).strip().lower()

    @field_validator('payment_method', mode='before')
    @classmethod
    def normalize_payment_method(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().lower()

    @field_validator('qc_status', mode='before')
    @classmethod
    def normalize_qc_status(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return 'approved'
        return str(value).strip().lower()

    @field_validator('incoterms', mode='before')
    @classmethod
    def normalize_incoterms(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().upper()

    @field_validator('tax_document_type', mode='before')
    @classmethod
    def normalize_tax_document_type(cls, value: Any) -> Any:
        return _normalize_tax_document_type(value)

    @field_validator('swift_code', 'intermediary_swift_code', mode='before')
    @classmethod
    def normalize_swift(cls, value: Any) -> Any:
        return _normalize_swift_code(value)

    @field_validator('iban_account_number', mode='before')
    @classmethod
    def normalize_iban(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip()

    @field_validator('intermediary_routing_aba', mode='before')
    @classmethod
    def normalize_aba(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        digits = ''.join(ch for ch in str(cleaned) if ch.isdigit())
        if len(digits) not in (0, 9):
            raise ValueError('Intermediary routing / ABA must be 9 digits')
        return digits or None


class SupplierCreate(SupplierBase):
    supplier_id: str = Field(max_length=50)


class SupplierUpdate(BaseModel):
    company_name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_name: str | None = Field(default=None, max_length=100)
    contact_email: EmailStr | None = None
    phone_number: str | None = Field(default=None, max_length=50)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=50)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=50)
    vendor_number_ext: str | None = Field(default=None, max_length=50)
    payment_terms: str | None = Field(default=None, max_length=50)
    payment_term_id: UUID | None = None
    status: str | None = Field(default=None, max_length=20)
    vendor_type: Literal['material', 'subcontractor', 'both', 'service'] | None = None
    tax_id: str | None = Field(default=None, max_length=50)
    tax_document_type: str | None = Field(default=None, max_length=64)
    is_overseas: bool | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    ap_account_id: UUID | None = None
    payment_method: Literal['wire', 'ach', 'check', 'credit_card'] | None = None
    incoterms: str | None = Field(default=None, max_length=10)
    incoterm_location: str | None = Field(default=None, max_length=150)
    country_of_origin: str | None = Field(default=None, max_length=50)
    bank_name: str | None = Field(default=None, max_length=150)
    swift_code: str | None = Field(default=None, max_length=11)
    iban_account_number: str | None = Field(default=None, max_length=64)
    bank_address: str | None = None
    intermediary_bank_name: str | None = Field(default=None, max_length=150)
    intermediary_swift_code: str | None = Field(default=None, max_length=11)
    intermediary_routing_aba: str | None = Field(default=None, max_length=20)
    lead_time_days: int | None = Field(default=None, ge=0)
    work_center_id: str | None = Field(default=None, max_length=50)
    consignment_stock_loc_id: str | None = Field(default=None, max_length=50)
    standard_scrap_rate: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=2)
    iso_certified: bool | None = None
    qc_status: Literal['approved', 'probation', 'blocked'] | None = None
    notes: str | None = None

    @field_validator(
        'contact_name',
        'contact_email',
        'phone_number',
        'address_line1',
        'address_line2',
        'city',
        'state',
        'postal_code',
        'country',
        'vendor_number_ext',
        'payment_terms',
        'payment_term_id',
        'tax_id',
        'tax_document_type',
        'ap_account_id',
        'payment_method',
        'incoterms',
        'incoterm_location',
        'country_of_origin',
        'bank_name',
        'swift_code',
        'iban_account_number',
        'bank_address',
        'intermediary_bank_name',
        'intermediary_swift_code',
        'intermediary_routing_aba',
        'work_center_id',
        'consignment_stock_loc_id',
        'notes',
        mode='before',
    )
    @classmethod
    def blank_optional(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator('currency', mode='before')
    @classmethod
    def normalize_currency(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().upper()

    @field_validator('vendor_type', 'payment_method', 'qc_status', mode='before')
    @classmethod
    def normalize_enums(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().lower()

    @field_validator('incoterms', mode='before')
    @classmethod
    def normalize_incoterms(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        return str(cleaned).strip().upper()

    @field_validator('tax_document_type', mode='before')
    @classmethod
    def normalize_tax_document_type(cls, value: Any) -> Any:
        return _normalize_tax_document_type(value)

    @field_validator('swift_code', 'intermediary_swift_code', mode='before')
    @classmethod
    def normalize_swift(cls, value: Any) -> Any:
        return _normalize_swift_code(value)

    @field_validator('intermediary_routing_aba', mode='before')
    @classmethod
    def normalize_aba(cls, value: Any) -> Any:
        cleaned = _blank_to_none(value)
        if cleaned is None:
            return None
        digits = ''.join(ch for ch in str(cleaned) if ch.isdigit())
        if digits and len(digits) != 9:
            raise ValueError('Intermediary routing / ABA must be 9 digits')
        return digits or None


class SupplierRead(SupplierBase):
    supplier_id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


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


class ItemBOMHeaderCreate(BaseModel):
    copy_from_header_id: int | None = None
    notes: str | None = None


class ItemBOMHeaderRead(ORMModel):
    bom_header_id: int
    parent_item_id: str
    version_no: int
    status: str
    effective_from: date | None = None
    notes: str | None = None
    created_at: datetime | None = None


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
    bom_header_id: int
    parent_item_id: str
    component_item_id: str | None
    component_code: str | None = None
    quantity_per: Decimal
    item_type: str
    scrap_factor: Decimal = Decimal("0")
    yield_loss_percentage: Decimal = Decimal("0")
    created_at: datetime


class SubcontractOrderComponentOverride(BaseModel):
    component_item_id: str = Field(max_length=50)
    quantity_required: Decimal = Field(gt=0, decimal_places=4)
    notes: str | None = None


class SubcontractOrderComponentRead(ORMModel):
    sco_component_id: int
    sco_number: str
    sco_line_id: int | None = None
    component_item_id: str
    quantity_required: Decimal
    quantity_required_bom: Decimal | None = None
    quantity_issued: Decimal
    is_overridden: bool = False
    notes: str | None = None
    quantity_remaining: Decimal | None = None
    on_hand_quantity: int | None = None
    primary_vendor_id: str | None = None
    primary_vendor_sku: str | None = None
    description: str | None = None


class SubcontractChargeInput(BaseModel):
    line_no: int | None = None
    name: str = Field(min_length=1, max_length=150)
    detail_explanation: str | None = None
    labor_minutes: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    sf_rate: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    cost_per_unit: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    margin_percent: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    is_margin: bool = False


class SubcontractChargeRead(ORMModel):
    sco_charge_id: int | None = None
    sco_line_id: int | None = None
    line_no: int
    name: str
    detail_explanation: str | None = None
    labor_minutes: Decimal | None = None
    sf_rate: Decimal | None = None
    cost_per_unit: Decimal = Decimal("0")
    margin_percent: Decimal | None = None
    is_margin: bool = False


class SubcontractOrderLineCreate(BaseModel):
    so_item_id: int | None = None
    item_id: str = Field(max_length=50)
    quantity_ordered: int = Field(gt=0)
    bom_header_id: int | None = None
    unit_price: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=4)
    tax_exempt: bool = True
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    notes: str | None = None
    charges: list[SubcontractChargeInput] | None = None
    components: list[SubcontractOrderComponentOverride] | None = None


class SubcontractOrderLineRead(ORMModel):
    sco_line_id: int
    sco_number: str
    line_number: int
    so_item_id: int | None = None
    so_line_number: int | None = None
    item_id: str
    bom_header_id: int | None = None
    bom_version_no: int | None = None
    quantity_ordered: int
    unit_price: Decimal = Decimal("0")
    margin_percent: Decimal = Decimal("0")
    margin_amount: Decimal = Decimal("0")
    cost_subtotal: Decimal = Decimal("0")
    tax_exempt: bool = True
    tax_amount: Decimal = Decimal("0")
    line_total: Decimal = Decimal("0")
    notes: str | None = None
    components: list[SubcontractOrderComponentRead] = []
    charges: list[SubcontractChargeRead] = []


class MaterialIssueLineCreate(BaseModel):
    component_item_id: str = Field(max_length=50)
    quantity_issued: Decimal = Field(gt=0, decimal_places=4)
    sco_line_id: int | None = None

class MaterialIssueLineRead(ORMModel):
    issue_line_id: int
    issue_id: str
    sco_line_id: int | None = None
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
    sco_line_id: int | None = None

class FinishedGoodsReceiptRead(ORMModel):
    receipt_id: str
    sco_number: str
    sco_line_id: int | None = None
    quantity_received: int
    receipt_date: date
    notes: str | None
    created_at: datetime


class SubcontractOrderCreate(BaseModel):
    sco_number: str | None = Field(default=None, max_length=50)
    supplier_id: str = Field(max_length=50)
    item_id: str | None = Field(default=None, max_length=50)
    quantity_ordered: int | None = Field(default=None, gt=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=4)
    sales_order_id: str | None = Field(default=None, max_length=50)
    order_date: date | None = None
    expected_return_date: date | None = None
    notes: str | None = None
    bom_header_id: int | None = None
    lines: list[SubcontractOrderLineCreate] | None = None

    @model_validator(mode="after")
    def _require_lines_or_legacy_item(self) -> "SubcontractOrderCreate":
        if self.lines:
            return self
        if not self.item_id or not self.quantity_ordered:
            raise ValueError("Provide lines[] or item_id + quantity_ordered")
        return self

class SubcontractOrderLineChargesUpdate(BaseModel):
    sco_line_id: int
    charges: list[SubcontractChargeInput] = Field(default_factory=list)


class SubcontractOrderAmendRequest(BaseModel):
    comments: str | None = Field(default=None, max_length=2000)


class SubcontractOrderUpdate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=50)
    quantity_ordered: int | None = Field(default=None, gt=0)
    unit_price: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    status: str | None = Field(default=None, max_length=30)
    expected_return_date: date | None = None
    notes: str | None = None
    lines: list[SubcontractOrderLineChargesUpdate] | None = None

class SubcontractOrderRead(ORMModel):
    sco_number: str
    supplier_id: str
    sales_order_id: str | None = None
    item_id: str
    bom_header_id: int | None = None
    bom_version_no: int | None = None
    quantity_ordered: int
    unit_price: Decimal = Decimal("0")
    document_total: Decimal = Decimal("0")
    line_count: int = 0
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    amendment_number: int = 0
    billing_status: str = 'UNBILLED'
    order_date: date
    expected_return_date: date | None
    notes: str | None
    created_at: datetime
    lines: list[SubcontractOrderLineRead] = []
    components: list[SubcontractOrderComponentRead] = []
    material_issues: list[MaterialIssueRead] = []
    finished_goods_receipts: list[FinishedGoodsReceiptRead] = []


class EligibleSalesOrderRead(BaseModel):
    sales_order_id: str
    customer_id: str | None = None
    customer_name: str | None = None
    customer_po_number: str | None = None
    order_date: date | None = None
    status: str | None = None
    approval_status: str | None = None
    open_line_count: int = 0


class SalesOrderSubcontractLineRead(BaseModel):
    so_item_id: int
    line_number: int
    item_id: str
    item_description: str | None = None
    customer_part_number: str | None = None
    quantity_ordered: int
    quantity_subcontracted: int
    quantity_remaining: int
    has_active_bom: bool
    active_bom_header_id: int | None = None
    active_bom_version_no: int | None = None
    bom_status: str | None = None
    is_subcontract_assembly: bool = False


class PreviewComponentLine(BaseModel):
    so_item_id: int | None = None
    item_id: str
    quantity_ordered: int
    bom_header_id: int | None = None
    bom_header_id_resolved: int | None = None
    bom_version_no: int | None = None
    bom_status: str | None = None
    quantity_remaining_on_so_line: int | None = None
    charges: list[SubcontractChargeRead] = []
    unit_price: Decimal = Decimal("0")
    line_total: Decimal = Decimal("0")
    components: list["CalculatedComponentLine"] = []


class PreviewComponentsRequest(BaseModel):
    sales_order_id: str | None = None
    lines: list[SubcontractOrderLineCreate] = Field(min_length=1)


class PreviewComponentsResponse(BaseModel):
    can_create: bool
    warnings: list[dict] = []
    default_charges: list[SubcontractChargeRead] = []
    lines: list[PreviewComponentLine] = []
    consolidated_components: list["CalculatedComponentLine"] = []


class SubcontractOrderDeliveryScheduleCreate(BaseModel):
    sco_number: str = Field(max_length=50)
    sub_line_number: str | None = Field(default=None, max_length=10)
    warehouse_id: str | None = Field(default=None, max_length=50)
    bin_id: str | None = Field(default=None, max_length=50)
    scheduled_quantity: int = Field(gt=0)
    needed_return_date: datetime
    promised_return_date: datetime | None = None
    requester_name: str | None = Field(default=None, max_length=100)
    status: str = Field(default="PENDING", max_length=30)


class SubcontractOrderDeliveryScheduleRead(ORMModel):
    schedule_id: int
    sco_number: str
    sub_line_number: str | None
    warehouse_id: str | None
    bin_id: str | None
    scheduled_quantity: int
    needed_return_date: datetime
    promised_return_date: datetime | None
    requester_name: str | None
    status: str


# ==========================================
# PROCUREMENT: PURCHASE ORDER MODELS
# ==========================================

class PurchaseOrderItemCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    uom: str | None = Field(default=None, max_length=20)
    bom_header_id: int | None = None
    sco_component_id: int | None = None
    quantity: Decimal = Field(gt=0, decimal_places=4)
    unit_price: Decimal = Field(ge=0, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=3)
    line_subtotal: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    line_tax: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)
    line_total: Decimal = Field(default=Decimal("0.00"), ge=0, decimal_places=2)

    @field_validator('description', mode='before')
    @classmethod
    def clip_po_item_description(cls, value: Any) -> Any:
        return _clip_str(value, 255)

    @field_validator('uom', mode='before')
    @classmethod
    def clip_po_item_uom(cls, value: Any) -> Any:
        return _clip_str(value, 20) if value else value

    @field_validator('quantity', 'unit_price', mode='before')
    @classmethod
    def quantize_po_item_4(cls, value: Any) -> Any:
        return _quantize_decimal(value, 4)

    @field_validator('tax_rate', mode='before')
    @classmethod
    def quantize_po_item_tax(cls, value: Any) -> Any:
        return _quantize_decimal(value, 3)

    @field_validator('line_subtotal', 'line_tax', 'line_total', mode='before')
    @classmethod
    def quantize_po_item_money(cls, value: Any) -> Any:
        return _quantize_decimal(value, 2)

class PurchaseOrderItemUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    uom: str | None = Field(default=None, max_length=20)
    bom_header_id: int | None = None
    sco_component_id: int | None = None
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
    description: str | None = None
    uom: str | None = None
    bom_header_id: int | None = None
    sco_component_id: int | None = None
    quantity: Decimal
    unit_price: Decimal
    tax_rate: Decimal
    line_subtotal: Decimal
    line_tax: Decimal
    line_total: Decimal


class PurchaseOrderDeliveryScheduleCreate(BaseModel):
    po_item_id: int
    sub_line_number: str | None = Field(default=None, max_length=10)
    warehouse_id: str | None = Field(default=None, max_length=50)
    bin_id: str | None = Field(default=None, max_length=50)
    scheduled_quantity: Decimal = Field(gt=0, decimal_places=4)
    needed_delivery_date: datetime
    promised_delivery_date: datetime | None = None
    requester_name: str | None = Field(default=None, max_length=100)
    status: str = Field(default="PENDING", max_length=30)


class PurchaseOrderDeliveryScheduleRead(ORMModel):
    schedule_id: int
    po_item_id: int
    sub_line_number: str | None
    warehouse_id: str | None
    bin_id: str | None
    scheduled_quantity: Decimal
    needed_delivery_date: datetime
    promised_delivery_date: datetime | None
    requester_name: str | None
    status: str


class PurchaseOrderCreate(BaseModel):
    po_number: str | None = Field(default=None, max_length=50)
    supplier_id: str = Field(max_length=50)
    po_type: Literal['MATERIAL', 'SUBCONTRACT'] = Field(default='MATERIAL')
    bom_header_id: int | None = None
    sco_number: str | None = Field(default=None, max_length=50)
    order_date: date | None = None
    expected_delivery_date: date | None = None
    payment_terms: str | None = Field(default="Net 30", max_length=50)
    payment_term_id: UUID | None = None
    status: Literal['Draft', 'Submitted', 'Approved', 'Void'] = Field(default='Draft')

    shipping_fee: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    discount_type: Literal['percentage', 'fixed'] = Field(default='percentage')
    discount_value: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    incoterms: str | None = Field(default=None, max_length=10)
    freight_terms: Literal['PREPAID_ON_PO', 'THIRD_PARTY_COLLECT', 'ROUTING_ACCOUNT'] = Field(
        default='PREPAID_ON_PO'
    )
    carrier_account: str | None = Field(default=None, max_length=50)

    subtotal: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    total_tax: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    grand_total: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)

    notes: str | None = None
    items: list[PurchaseOrderItemCreate] = Field(min_length=1)

    @field_validator('incoterms', 'carrier_account', mode='before')
    @classmethod
    def blank_po_logistics(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return None
        cleaned = value.strip() if isinstance(value, str) else value
        return cleaned

    @field_validator('incoterms', mode='after')
    @classmethod
    def normalize_po_incoterms(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip().upper()

class PurchaseOrderUpdate(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=50)
    po_type: Literal['MATERIAL', 'SUBCONTRACT'] | None = None
    bom_header_id: int | None = None
    sco_number: str | None = Field(default=None, max_length=50)
    order_date: date | None = None
    expected_delivery_date: date | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    payment_term_id: UUID | None = None
    status: Literal['Draft', 'Submitted', 'Approved', 'Void'] | None = None

    shipping_fee: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    discount_type: Literal['percentage', 'fixed'] | None = None
    discount_value: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    incoterms: str | None = Field(default=None, max_length=10)
    freight_terms: Literal['PREPAID_ON_PO', 'THIRD_PARTY_COLLECT', 'ROUTING_ACCOUNT'] | None = None
    carrier_account: str | None = Field(default=None, max_length=50)

    subtotal: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    total_tax: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    discount_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    grand_total: Decimal | None = Field(default=None, ge=0, decimal_places=2)

    notes: str | None = None
    items: list[PurchaseOrderItemCreate] | None = None

    @field_validator('incoterms', 'carrier_account', mode='before')
    @classmethod
    def blank_po_logistics_update(cls, value: Any) -> Any:
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return None
        return value.strip() if isinstance(value, str) else value

    @field_validator('incoterms', mode='after')
    @classmethod
    def normalize_po_incoterms_update(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip().upper()

class PurchaseOrderRead(ORMModel):
    po_number: str
    supplier_id: str
    po_type: str = 'MATERIAL'
    bom_header_id: int | None = None
    sco_number: str | None = None
    order_date: date
    expected_delivery_date: date | None
    payment_terms: str | None
    payment_term_id: UUID | None = None
    status: str
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None
    billing_status: str = 'UNBILLED'

    shipping_fee: Decimal
    discount_type: str
    discount_value: Decimal
    incoterms: str | None = None
    freight_terms: str = 'PREPAID_ON_PO'
    carrier_account: str | None = None

    subtotal: Decimal
    total_tax: Decimal
    discount_amount: Decimal
    grand_total: Decimal

    notes: str | None
    created_at: datetime | None
    items: list[PurchaseOrderItemRead] = []


class EligibleMaterialPoScoRead(BaseModel):
    sco_number: str
    supplier_id: str
    supplier_name: str | None = None
    item_id: str
    fg_description: str | None = None
    expected_return_date: date | None = None
    status: str
    quantity_ordered: int
    open_component_line_count: int = 0


class UnfulfilledScoComponentRead(BaseModel):
    sco_component_id: int
    sco_line_id: int | None = None
    component_item_id: str
    description: str | None = None
    uom: str | None = None
    quantity_required: Decimal
    quantity_already_ordered: Decimal
    quantity_on_draft_pos: Decimal = Decimal("0")
    quantity_remaining: Decimal
    unit_cost: Decimal | None = None
    price_source: Literal[
        'VENDOR_MAPPING',
        'PRIMARY_VENDOR',
        'LAST_PO_VENDOR',
        'LAST_PO',
        'CATALOG',
        'NONE',
    ] = 'NONE'


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

class ARInvoicePaymentRead(BaseModel):
    payment_date: datetime | date | None = None
    method: str
    reference: str
    amount_applied: Decimal
    unapplied_balance: Decimal


class ARInvoiceLineDetailRead(BaseModel):
    item_id: str
    description: str | None = None
    quantity: int
    unit_price: Decimal
    line_subtotal: Decimal


class ARInvoiceDetailRead(ARInvoiceRead):
    customer_name: str | None = None
    customer_email: str | None = None
    display_status: str = "Open"
    issue_date: date | None = None
    payment_date: date | None = None
    payment_terms: str | None = None
    currency: str = "USD"
    subtotal: Decimal = Decimal("0.00")
    tax_amount: Decimal = Decimal("0.00")
    freight_amount: Decimal = Decimal("0.00")
    total_amount: Decimal = Decimal("0.00")
    outstanding_balance: Decimal = Decimal("0.00")
    sales_invoice_id: int | None = None
    sales_invoice_number: str | None = None
    sales_invoice_status: str | None = None
    lines: list[ARInvoiceLineDetailRead] = Field(default_factory=list)
    payments: list[ARInvoicePaymentRead] = Field(default_factory=list)
    can_create_credit_memo: bool = False
    credit_memo_reason: str | None = None
    duplicate_invoice_ids: list[str] = Field(default_factory=list)


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
    payment_term_id: UUID | None = None
    created_at: datetime | None

class APBillPaymentRead(BaseModel):
    payment_date: datetime | date | None = None
    method: str
    reference: str
    amount_applied: Decimal
    unapplied_balance: Decimal


class APBillLineDetailRead(BaseModel):
    item_id: str | None = None
    description: str | None = None
    quantity: Decimal
    unit_price: Decimal
    line_subtotal: Decimal


class APBillDetailRead(APBillRead):
    vendor_name: str | None = None
    vendor_email: str | None = None
    vendor_invoice_number: str | None = None
    display_status: str = "Open"
    issue_date: date | None = None
    payment_date: date | None = None
    payment_terms: str | None = None
    currency: str = "USD"
    subtotal: Decimal = Decimal("0.00")
    tax_amount: Decimal = Decimal("0.00")
    freight_amount: Decimal = Decimal("0.00")
    total_amount: Decimal = Decimal("0.00")
    outstanding_balance: Decimal = Decimal("0.00")
    supplier_invoice_number: str | None = None
    supplier_invoice_status: str | None = None
    invoice_type: str | None = None
    match_warnings: list[str] = Field(default_factory=list)
    lines: list[APBillLineDetailRead] = Field(default_factory=list)
    payments: list[APBillPaymentRead] = Field(default_factory=list)


class APBillCreate(BaseModel):
    bill_id: str = Field(max_length=50)
    purchase_order_id: str = Field(max_length=50)
    vendor_id: str = Field(max_length=50)
    amount: Decimal = Field(gt=0, decimal_places=2)
    due_date: date


class BankAccountRead(ORMModel):
    bank_account_id: str
    bank_name: str
    account_name: str
    account_number: str
    account_number_masked: str | None = None
    routing_number: str | None = None
    display_name: str | None = None
    is_default: bool = False
    is_active: bool = True


class BankAccountCreate(BaseModel):
    bank_name: str = Field(min_length=1, max_length=150)
    account_name: str = Field(min_length=1, max_length=100)
    account_number: str = Field(min_length=4, max_length=34)
    routing_number: str | None = Field(default=None, max_length=9)
    is_default: bool = False


class CashTransactionRead(ORMModel):
    transaction_id: str
    type: str
    type_label: str | None = None
    reference_id: str
    amount: Decimal
    transaction_date: datetime | None
    bank_account_id: str | None
    bank_account_name: str | None = None
    bank_name: str | None = None
    account_name: str | None = None
    account_number: str | None = None
    account_number_masked: str | None = None
    routing_number: str | None = None
    payment_method: str = "CHECK"
    instrument_ref_no: str | None = None
    instrument_display_number: str | None = None
    entity_name: str | None = None
    entity_role: str | None = None
    clearing_status: str = "CLEARED"
    approval_status: str = 'DRAFT'
    current_approval_step: int | None = None


class PaymentRequest(BaseModel):
    """Payload for AR invoice / AP bill payment actions."""
    transaction_id: str | None = Field(default=None, max_length=50)
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    bank_account_id: str | None = Field(default=None, max_length=50)
    payment_method: Literal["CHECK", "WIRE", "ACH", "CARD"] | None = None
    instrument_ref_no: str | None = Field(default=None, max_length=50)
    payment_date: date | None = None


class NextInstrumentRead(BaseModel):
    payment_method: str
    instrument_ref_no: str


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
    bom_header_id: int | None = None
    bom_version_no: int | None = None
    bom_status: str | None = None
    components: list[SubcontractBOMLineRead] = []


class CalculatedComponentLine(BaseModel):
    component_item_id: str
    description: str | None = None
    uom: str | None = None
    quantity_per: Decimal
    scrap_factor: Decimal = Decimal("0")
    yield_loss_percentage: Decimal = Decimal("0")
    quantity_required: Decimal
    quantity_issued: Decimal = Decimal("0")
    quantity_remaining: Decimal = Decimal("0")
    on_hand_quantity: int = 0
    available_to_promise: int = 0
    stock_shortfall: Decimal = Decimal("0")
    primary_vendor_id: str | None = None
    primary_vendor_sku: str | None = None
    unit_cost: Decimal | None = None
    sco_line_id: int | None = None
    notes: str | None = None
    is_overridden: bool = False


class CalculateComponentsResponse(BaseModel):
    sco_number: str
    assembly_item_id: str
    quantity_ordered: int
    bom_header_id: int | None = None
    bom_version_no: int | None = None
    components: list[CalculatedComponentLine]
    lines: list[PreviewComponentLine] = []


PreviewComponentLine.model_rebuild()
PreviewComponentsResponse.model_rebuild()
CalculateComponentsResponse.model_rebuild()


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
    payment_term_id: UUID | None = None
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
    payment_term_id: UUID | None = None
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


class DepartmentRead(BaseModel):
    id: str
    name: str


class SupplierInvoiceLineCreate(BaseModel):
    source_line_id: int | None = None
    item_id: str | None = None
    description: str | None = None
    quantity_billed: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=4)


class SupplierInvoiceDistributionCreate(BaseModel):
    gl_account_id: UUID
    department_id: str | None = Field(default=None, max_length=50)
    amount: Decimal = Field(gt=0, decimal_places=2)
    description: str | None = Field(default=None, max_length=255)
    goods_receipt_id: int | None = None
    goods_receipt_line_id: int | None = None


class SupplierInvoiceCreate(BaseModel):
    invoice_type: Literal["PO_MATCHED", "LANDED_COST", "EXPENSE"] | None = None
    source_type: Literal["PURCHASE_ORDER", "SUBCONTRACT_ORDER", "NON_PO"] | None = None
    source_order_id: str | None = Field(default=None, max_length=50)
    vendor_id: str | None = Field(default=None, max_length=50)
    vendor_invoice_number: str | None = Field(default=None, max_length=100)
    invoice_date: date | None = None
    due_date: date | None = None
    payment_term_id: UUID | None = None
    payment_terms: str | None = Field(default=None, max_length=50)
    tax_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    freight_amount: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    lines: list[SupplierInvoiceLineCreate] | None = None
    distributions: list[SupplierInvoiceDistributionCreate] | None = None


class SupplierInvoiceLineRead(BaseModel):
    id: int
    invoice_id: int
    source_line_id: int | None = None
    item_id: str | None = None
    description: str | None = None
    quantity_billed: Decimal
    unit_price: Decimal
    line_subtotal: Decimal
    goods_receipt_line_id: int | None = None


class SupplierInvoiceDistributionRead(BaseModel):
    id: int
    invoice_id: int
    gl_account_id: UUID
    gl_account_code: str | None = None
    gl_account_name: str | None = None
    department_id: str | None = None
    department_name: str | None = None
    amount: Decimal
    description: str | None = None
    goods_receipt_id: int | None = None
    goods_receipt_line_id: int | None = None


class SupplierInvoiceRead(BaseModel):
    id: int
    invoice_number: str
    vendor_id: str
    vendor_name: str | None = None
    invoice_type: str
    source_type: str
    source_order_id: str | None = None
    vendor_invoice_number: str | None = None
    invoice_date: date
    due_date: date
    payment_term_id: UUID | None = None
    payment_terms: str | None = None
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
    distributions: list[SupplierInvoiceDistributionRead] = Field(default_factory=list)
    payment_transaction_id: str | None = None


class SupplierInvoicePayRequest(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    bank_account_id: str | None = Field(default=None, max_length=50)
    payment_method: Literal["CHECK", "WIRE", "ACH", "CARD"] | None = None
    instrument_ref_no: str | None = Field(default=None, max_length=50)
    payment_date: date | None = None


class DocumentAttachmentRead(ORMModel):
    id: int
    document_type: str
    document_id: str
    original_filename: str
    content_type: str
    file_size: int
    notes: str | None = None
    uploaded_by_user_id: str | None = None
    uploaded_by_name: str | None = None
    uploaded_at: datetime
