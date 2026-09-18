"""Company posting rules: action → debit account + credit account.

The engine looks up (event, variant, party) at post time. Catalog defaults
match the TIPTOP chart and are seeded into posting_rules; finance users can
change the accounts without a code deploy. Vendor AP mapping and bank GL
still override the AP and cash sides.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.models import ChartOfAccount, PostingRule, Supplier

EVENT_GOODS_RECEIPT = "GOODS_RECEIPT"
EVENT_SUPPLIER_INVOICE = "SUPPLIER_INVOICE"
EVENT_SALES_INVOICE = "SALES_INVOICE"
EVENT_SALES_CREDIT = "SALES_CREDIT"
EVENT_AR_PAYMENT = "AR_PAYMENT"
EVENT_AP_PAYMENT = "AP_PAYMENT"

VARIANT_MATERIALS = "MATERIALS"
VARIANT_SUBCONTRACT = "SUBCONTRACT"
VARIANT_EXPENSE = "EXPENSE"
VARIANT_GRNI_CLEAR = "GRNI_CLEAR"
VARIANT_PPV_UNFAVORABLE = "PPV_UNFAVORABLE"
VARIANT_PPV_FAVORABLE = "PPV_FAVORABLE"
VARIANT_TAX = "TAX"
VARIANT_LANDED_COST = "LANDED_COST"
VARIANT_REVENUE = "REVENUE"
VARIANT_SETTLE = "SETTLE"
VARIANT_CREDIT_MEMO = "CREDIT_MEMO"

PARTY_TRADE = "TRADE"
PARTY_RELATED = "RELATED"
PARTY_ANY = "ANY"

EVENT_LABELS = {
    EVENT_GOODS_RECEIPT: "Goods receipt",
    EVENT_SUPPLIER_INVOICE: "Supplier invoice",
    EVENT_SALES_INVOICE: "Sales invoice",
    EVENT_SALES_CREDIT: "Sales credit memo",
    EVENT_AR_PAYMENT: "Customer payment",
    EVENT_AP_PAYMENT: "Vendor payment",
}

VARIANT_LABELS = {
    VARIANT_MATERIALS: "Materials / inventory",
    VARIANT_SUBCONTRACT: "Subcontract processing",
    VARIANT_EXPENSE: "Non-stock / service",
    VARIANT_GRNI_CLEAR: "Clear GR/IR to AP",
    VARIANT_PPV_UNFAVORABLE: "Price variance (invoice higher)",
    VARIANT_PPV_FAVORABLE: "Price variance (invoice lower)",
    VARIANT_TAX: "Tax / freight",
    VARIANT_LANDED_COST: "Landed cost to inventory",
    VARIANT_REVENUE: "Revenue",
    VARIANT_SETTLE: "Settle open item",
    VARIANT_CREDIT_MEMO: "Reverse revenue",
}

PARTY_LABELS = {
    PARTY_TRADE: "Trade vendor",
    PARTY_RELATED: "Related party",
    PARTY_ANY: "All",
}

Side = Literal["debit", "credit"]

# Seed / fallback pairs. Engine uses posting_rules rows when present.
DEFAULT_RULES: tuple[dict[str, Any], ...] = (
    {
        "rule_code": "GR_MATERIALS_TRADE",
        "event_code": EVENT_GOODS_RECEIPT,
        "variant": VARIANT_MATERIALS,
        "party_scope": PARTY_TRADE,
        "name": "Goods receipt — materials (trade)",
        "debit_code": "1313",
        "debit_name": "Half-finished Goods",
        "debit_type": "Asset",
        "credit_code": "2172",
        "credit_name": "Accounts Payable - General provisional",
        "credit_type": "Liability",
        "sort_order": 10,
    },
    {
        "rule_code": "GR_MATERIALS_RELATED",
        "event_code": EVENT_GOODS_RECEIPT,
        "variant": VARIANT_MATERIALS,
        "party_scope": PARTY_RELATED,
        "name": "Goods receipt — materials (related party)",
        "debit_code": "1313",
        "debit_name": "Half-finished Goods",
        "debit_type": "Asset",
        "credit_code": "2182",
        "credit_name": "Accounts Payable - GR/IR - related parties",
        "credit_type": "Liability",
        "sort_order": 11,
    },
    {
        "rule_code": "GR_SUBCONTRACT_TRADE",
        "event_code": EVENT_GOODS_RECEIPT,
        "variant": VARIANT_SUBCONTRACT,
        "party_scope": PARTY_TRADE,
        "name": "Goods receipt — subcontract (trade)",
        "debit_code": "5146",
        "debit_name": "Processing Fees",
        "debit_type": "Expense",
        "credit_code": "2172",
        "credit_name": "Accounts Payable - General provisional",
        "credit_type": "Liability",
        "sort_order": 20,
    },
    {
        "rule_code": "GR_SUBCONTRACT_RELATED",
        "event_code": EVENT_GOODS_RECEIPT,
        "variant": VARIANT_SUBCONTRACT,
        "party_scope": PARTY_RELATED,
        "name": "Goods receipt — subcontract (related party)",
        "debit_code": "5146",
        "debit_name": "Processing Fees",
        "debit_type": "Expense",
        "credit_code": "2182",
        "credit_name": "Accounts Payable - GR/IR - related parties",
        "credit_type": "Liability",
        "sort_order": 21,
    },
    {
        "rule_code": "GR_EXPENSE_TRADE",
        "event_code": EVENT_GOODS_RECEIPT,
        "variant": VARIANT_EXPENSE,
        "party_scope": PARTY_TRADE,
        "name": "Goods receipt — service / non-stock (trade)",
        "debit_code": "5190",
        "debit_name": "Purchase Expenses",
        "debit_type": "Expense",
        "credit_code": "2172",
        "credit_name": "Accounts Payable - General provisional",
        "credit_type": "Liability",
        "sort_order": 30,
    },
    {
        "rule_code": "GR_EXPENSE_RELATED",
        "event_code": EVENT_GOODS_RECEIPT,
        "variant": VARIANT_EXPENSE,
        "party_scope": PARTY_RELATED,
        "name": "Goods receipt — service / non-stock (related party)",
        "debit_code": "5190",
        "debit_name": "Purchase Expenses",
        "debit_type": "Expense",
        "credit_code": "2182",
        "credit_name": "Accounts Payable - GR/IR - related parties",
        "credit_type": "Liability",
        "sort_order": 31,
    },
    {
        "rule_code": "AP_GRNI_CLEAR_TRADE",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_GRNI_CLEAR,
        "party_scope": PARTY_TRADE,
        "name": "Supplier invoice — clear GR/IR (trade)",
        "debit_code": "2172",
        "debit_name": "Accounts Payable - General provisional",
        "debit_type": "Liability",
        "credit_code": "2171",
        "credit_name": "Accounts Payable",
        "credit_type": "Liability",
        "sort_order": 40,
    },
    {
        "rule_code": "AP_GRNI_CLEAR_RELATED",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_GRNI_CLEAR,
        "party_scope": PARTY_RELATED,
        "name": "Supplier invoice — clear GR/IR (related party)",
        "debit_code": "2182",
        "debit_name": "Accounts Payable - GR/IR - related parties",
        "debit_type": "Liability",
        "credit_code": "2181",
        "credit_name": "Accounts Payable - related parties",
        "credit_type": "Liability",
        "sort_order": 41,
    },
    {
        "rule_code": "AP_EXPENSE_TRADE",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_EXPENSE,
        "party_scope": PARTY_TRADE,
        "name": "Supplier invoice — unaccrued expense (trade)",
        "debit_code": "5190",
        "debit_name": "Purchase Expenses",
        "debit_type": "Expense",
        "credit_code": "2171",
        "credit_name": "Accounts Payable",
        "credit_type": "Liability",
        "sort_order": 50,
    },
    {
        "rule_code": "AP_EXPENSE_RELATED",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_EXPENSE,
        "party_scope": PARTY_RELATED,
        "name": "Supplier invoice — unaccrued expense (related party)",
        "debit_code": "5190",
        "debit_name": "Purchase Expenses",
        "debit_type": "Expense",
        "credit_code": "2181",
        "credit_name": "Accounts Payable - related parties",
        "credit_type": "Liability",
        "sort_order": 51,
    },
    {
        "rule_code": "AP_TAX_TRADE",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_TAX,
        "party_scope": PARTY_TRADE,
        "name": "Supplier invoice — tax / freight (trade)",
        "debit_code": "5155",
        "debit_name": "MOH-Freight Costs",
        "debit_type": "Expense",
        "credit_code": "2171",
        "credit_name": "Accounts Payable",
        "credit_type": "Liability",
        "sort_order": 60,
    },
    {
        "rule_code": "AP_TAX_RELATED",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_TAX,
        "party_scope": PARTY_RELATED,
        "name": "Supplier invoice — tax / freight (related party)",
        "debit_code": "5155",
        "debit_name": "MOH-Freight Costs",
        "debit_type": "Expense",
        "credit_code": "2181",
        "credit_name": "Accounts Payable - related parties",
        "credit_type": "Liability",
        "sort_order": 61,
    },
    {
        "rule_code": "AP_PPV_UNFAV_TRADE",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_PPV_UNFAVORABLE,
        "party_scope": PARTY_TRADE,
        "name": "Supplier invoice — PPV unfavorable (trade)",
        "debit_code": "5840",
        "debit_name": "Other Cost-Inventory Under and Over",
        "debit_type": "Expense",
        "credit_code": "2171",
        "credit_name": "Accounts Payable",
        "credit_type": "Liability",
        "sort_order": 70,
    },
    {
        "rule_code": "AP_PPV_UNFAV_RELATED",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_PPV_UNFAVORABLE,
        "party_scope": PARTY_RELATED,
        "name": "Supplier invoice — PPV unfavorable (related party)",
        "debit_code": "5840",
        "debit_name": "Other Cost-Inventory Under and Over",
        "debit_type": "Expense",
        "credit_code": "2181",
        "credit_name": "Accounts Payable - related parties",
        "credit_type": "Liability",
        "sort_order": 71,
    },
    {
        "rule_code": "AP_PPV_FAV_TRADE",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_PPV_FAVORABLE,
        "party_scope": PARTY_TRADE,
        "name": "Supplier invoice — PPV favorable (trade)",
        "debit_code": "2172",
        "debit_name": "Accounts Payable - General provisional",
        "debit_type": "Liability",
        "credit_code": "5840",
        "credit_name": "Other Cost-Inventory Under and Over",
        "credit_type": "Expense",
        "sort_order": 80,
    },
    {
        "rule_code": "AP_PPV_FAV_RELATED",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_PPV_FAVORABLE,
        "party_scope": PARTY_RELATED,
        "name": "Supplier invoice — PPV favorable (related party)",
        "debit_code": "2182",
        "debit_name": "Accounts Payable - GR/IR - related parties",
        "debit_type": "Liability",
        "credit_code": "5840",
        "credit_name": "Other Cost-Inventory Under and Over",
        "credit_type": "Expense",
        "sort_order": 81,
    },
    {
        "rule_code": "AP_LANDED_COST",
        "event_code": EVENT_SUPPLIER_INVOICE,
        "variant": VARIANT_LANDED_COST,
        "party_scope": PARTY_ANY,
        "name": "Supplier invoice — landed cost to inventory",
        "debit_code": "1313",
        "debit_name": "Half-finished Goods",
        "debit_type": "Asset",
        "credit_code": "2171",
        "credit_name": "Accounts Payable",
        "credit_type": "Liability",
        "sort_order": 90,
    },
    {
        "rule_code": "AR_REVENUE",
        "event_code": EVENT_SALES_INVOICE,
        "variant": VARIANT_REVENUE,
        "party_scope": PARTY_ANY,
        "name": "Sales invoice — revenue",
        "debit_code": "1172",
        "debit_name": "Accounts Receivable",
        "debit_type": "Asset",
        "credit_code": "4110001",
        "credit_name": "Sales Revenue",
        "credit_type": "Revenue",
        "sort_order": 100,
    },
    {
        "rule_code": "AR_TAX",
        "event_code": EVENT_SALES_INVOICE,
        "variant": VARIANT_TAX,
        "party_scope": PARTY_ANY,
        "name": "Sales invoice — tax payable",
        "debit_code": "1172",
        "debit_name": "Accounts Receivable",
        "debit_type": "Asset",
        "credit_code": "2215",
        "credit_name": "Accrued VAT Payable",
        "credit_type": "Liability",
        "sort_order": 110,
    },
    {
        "rule_code": "AR_CREDIT_MEMO",
        "event_code": EVENT_SALES_CREDIT,
        "variant": VARIANT_CREDIT_MEMO,
        "party_scope": PARTY_ANY,
        "name": "Sales credit memo",
        "debit_code": "4110001",
        "debit_name": "Sales Revenue",
        "debit_type": "Revenue",
        "credit_code": "1172",
        "credit_name": "Accounts Receivable",
        "credit_type": "Asset",
        "sort_order": 120,
    },
    {
        "rule_code": "AR_PAYMENT",
        "event_code": EVENT_AR_PAYMENT,
        "variant": VARIANT_SETTLE,
        "party_scope": PARTY_ANY,
        "name": "Customer payment",
        "debit_code": "1103",
        "debit_name": "Cash in Banks",
        "debit_type": "Asset",
        "credit_code": "1172",
        "credit_name": "Accounts Receivable",
        "credit_type": "Asset",
        "sort_order": 130,
    },
    {
        "rule_code": "AP_PAYMENT_TRADE",
        "event_code": EVENT_AP_PAYMENT,
        "variant": VARIANT_SETTLE,
        "party_scope": PARTY_TRADE,
        "name": "Vendor payment (trade)",
        "debit_code": "2171",
        "debit_name": "Accounts Payable",
        "debit_type": "Liability",
        "credit_code": "1103",
        "credit_name": "Cash in Banks",
        "credit_type": "Asset",
        "sort_order": 140,
    },
    {
        "rule_code": "AP_PAYMENT_RELATED",
        "event_code": EVENT_AP_PAYMENT,
        "variant": VARIANT_SETTLE,
        "party_scope": PARTY_RELATED,
        "name": "Vendor payment (related party)",
        "debit_code": "2181",
        "debit_name": "Accounts Payable - related parties",
        "debit_type": "Liability",
        "credit_code": "1103",
        "credit_name": "Cash in Banks",
        "credit_type": "Asset",
        "sort_order": 141,
    },
)

_DEFAULT_BY_KEY = {
    (row["event_code"], row["variant"], row["party_scope"]): row for row in DEFAULT_RULES
}
_DEFAULT_BY_CODE = {row["rule_code"]: row for row in DEFAULT_RULES}


def find_default_rule(
    event_code: str, variant: str, party_scope: str
) -> dict[str, Any] | None:
    exact = _DEFAULT_BY_KEY.get((event_code, variant, party_scope))
    if exact is not None:
        return exact
    if party_scope != PARTY_ANY:
        return _DEFAULT_BY_KEY.get((event_code, variant, PARTY_ANY))
    return None


def catalog_account(
    event_code: str, variant: str, party_scope: str, side: Side
) -> tuple[str, str, str]:
    row = find_default_rule(event_code, variant, party_scope)
    if row is None:
        raise KeyError(f"No default posting rule for {event_code}/{variant}/{party_scope}")
    if side == "debit":
        return row["debit_code"], row["debit_name"], row["debit_type"]
    return row["credit_code"], row["credit_name"], row["credit_type"]


def receipt_variant(source_type: str | None, item=None) -> str:
    from app.services.item_types import skip_inventory_movement

    kind = (source_type or "").upper()
    if kind == "SUBCONTRACT_ORDER":
        return VARIANT_SUBCONTRACT
    if skip_inventory_movement(item):
        return VARIANT_EXPENSE
    return VARIANT_MATERIALS


def party_scope_for(supplier: Supplier | None) -> str:
    from app.services.finance import is_related_party_supplier

    return PARTY_RELATED if is_related_party_supplier(supplier) else PARTY_TRADE


def _ensure_account(db: Session, code: str, name: str, account_type: str) -> ChartOfAccount:
    from app.services.finance import get_or_create_account

    return get_or_create_account(db, code, name, account_type)


def ensure_default_posting_rules(db: Session) -> None:
    """Insert catalog rows that are missing. Does not overwrite user edits."""
    existing = {row[0] for row in db.query(PostingRule.rule_code).all()}
    for spec in DEFAULT_RULES:
        if spec["rule_code"] in existing:
            continue
        debit = _ensure_account(db, spec["debit_code"], spec["debit_name"], spec["debit_type"])
        credit = _ensure_account(
            db, spec["credit_code"], spec["credit_name"], spec["credit_type"]
        )
        db.add(
            PostingRule(
                rule_code=spec["rule_code"],
                event_code=spec["event_code"],
                variant=spec["variant"],
                party_scope=spec["party_scope"],
                name=spec["name"],
                debit_account_id=debit.id,
                credit_account_id=credit.id,
                is_system=True,
                is_active=True,
                sort_order=spec["sort_order"],
            )
        )
    db.flush()


def _pick_rule(rows: list[PostingRule], party_scope: str) -> PostingRule | None:
    by_party = {row.party_scope: row for row in rows if row.is_active}
    if party_scope in by_party:
        return by_party[party_scope]
    return by_party.get(PARTY_ANY)


def resolve_posting_pair(
    db: Session,
    event_code: str,
    variant: str,
    supplier: Supplier | None = None,
) -> tuple[ChartOfAccount, ChartOfAccount]:
    """Debit and credit accounts for an automated posting action."""
    ensure_default_posting_rules(db)
    party = party_scope_for(supplier) if supplier is not None else PARTY_TRADE
    if event_code in {EVENT_SALES_INVOICE, EVENT_SALES_CREDIT, EVENT_AR_PAYMENT}:
        party = PARTY_ANY
    rows = (
        db.query(PostingRule)
        .options(
            joinedload(PostingRule.debit_account),
            joinedload(PostingRule.credit_account),
        )
        .filter(
            PostingRule.event_code == event_code,
            PostingRule.variant == variant,
            PostingRule.is_active.is_(True),
        )
        .all()
    )
    rule = _pick_rule(rows, party)
    if rule is not None and rule.debit_account is not None and rule.credit_account is not None:
        return rule.debit_account, rule.credit_account

    spec = find_default_rule(event_code, variant, party)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No posting rule configured for {event_code} / {variant}",
        )
    debit = _ensure_account(db, spec["debit_code"], spec["debit_name"], spec["debit_type"])
    credit = _ensure_account(db, spec["credit_code"], spec["credit_name"], spec["credit_type"])
    return debit, credit


def serialize_posting_rule(rule: PostingRule) -> dict[str, Any]:
    spec = _DEFAULT_BY_CODE.get(rule.rule_code) or find_default_rule(
        rule.event_code, rule.variant, rule.party_scope
    )
    debit = rule.debit_account
    credit = rule.credit_account
    return {
        "id": rule.id,
        "rule_code": rule.rule_code,
        "event_code": rule.event_code,
        "event_label": EVENT_LABELS.get(rule.event_code, rule.event_code),
        "variant": rule.variant,
        "variant_label": VARIANT_LABELS.get(rule.variant, rule.variant),
        "party_scope": rule.party_scope,
        "party_label": PARTY_LABELS.get(rule.party_scope, rule.party_scope),
        "name": rule.name,
        "debit_account_id": rule.debit_account_id,
        "debit_account_code": debit.account_code if debit else None,
        "debit_account_name": debit.account_name if debit else None,
        "debit_account_type": debit.account_type if debit else None,
        "credit_account_id": rule.credit_account_id,
        "credit_account_code": credit.account_code if credit else None,
        "credit_account_name": credit.account_name if credit else None,
        "credit_account_type": credit.account_type if credit else None,
        "default_debit_account_code": spec["debit_code"] if spec else None,
        "default_credit_account_code": spec["credit_code"] if spec else None,
        "is_system": bool(rule.is_system),
        "is_active": bool(rule.is_active),
        "sort_order": rule.sort_order,
    }


def list_posting_rules(db: Session) -> list[dict[str, Any]]:
    ensure_default_posting_rules(db)
    rows = (
        db.query(PostingRule)
        .options(
            joinedload(PostingRule.debit_account),
            joinedload(PostingRule.credit_account),
        )
        .order_by(PostingRule.sort_order, PostingRule.rule_code)
        .all()
    )
    return [serialize_posting_rule(row) for row in rows]


def _require_account(db: Session, account_id: UUID) -> ChartOfAccount:
    account = db.get(ChartOfAccount, account_id)
    if account is None:
        raise HTTPException(status_code=400, detail="Account not found")
    return account


def update_posting_rule(db: Session, rule_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    rule = (
        db.query(PostingRule)
        .options(
            joinedload(PostingRule.debit_account),
            joinedload(PostingRule.credit_account),
        )
        .filter(PostingRule.id == rule_id)
        .first()
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Posting rule not found")
    if "debit_account_id" in payload and payload["debit_account_id"] is not None:
        debit = _require_account(db, payload["debit_account_id"])
        rule.debit_account_id = debit.id
        rule.debit_account = debit
    if "credit_account_id" in payload and payload["credit_account_id"] is not None:
        credit = _require_account(db, payload["credit_account_id"])
        rule.credit_account_id = credit.id
        rule.credit_account = credit
    if "is_active" in payload and payload["is_active"] is not None and not rule.is_system:
        rule.is_active = bool(payload["is_active"])
    if rule.debit_account_id == rule.credit_account_id:
        raise HTTPException(
            status_code=400, detail="Debit and credit accounts must be different"
        )
    db.flush()
    db.refresh(rule)
    return serialize_posting_rule(rule)


def reset_posting_rule(db: Session, rule_id: UUID) -> dict[str, Any]:
    rule = db.get(PostingRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Posting rule not found")
    spec = _DEFAULT_BY_CODE.get(rule.rule_code)
    if spec is None:
        raise HTTPException(status_code=400, detail="This rule has no catalog default")
    debit = _ensure_account(db, spec["debit_code"], spec["debit_name"], spec["debit_type"])
    credit = _ensure_account(db, spec["credit_code"], spec["credit_name"], spec["credit_type"])
    rule.debit_account_id = debit.id
    rule.credit_account_id = credit.id
    rule.is_active = True
    db.flush()
    return serialize_posting_rule(
        db.query(PostingRule)
        .options(
            joinedload(PostingRule.debit_account),
            joinedload(PostingRule.credit_account),
        )
        .filter(PostingRule.id == rule_id)
        .one()
    )
