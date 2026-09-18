"""Multi-stage approval workflow orchestration for ERP documents."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.deps.auth import (
    user_can_pass_step,
    user_is_admin,
    user_permission_codes,
)
from app.models import (
    APBill,
    ARInvoice,
    ApprovalAuditLog,
    CashTransaction,
    JournalEntry,
    PurchaseOrder,
    SalesOrder,
    SubcontractOrder,
    User,
    WorkflowDefinition,
    WorkflowStep,
)
from app.services import finance

# Canonical module keys used in workflow_definition.module
MODULE_CANONICAL = {
    "so": "SALES_ORDER",
    "sales-orders": "SALES_ORDER",
    "sales_order": "SALES_ORDER",
    "SALES_ORDER": "SALES_ORDER",
    "po": "PURCHASE_ORDER",
    "purchase-orders": "PURCHASE_ORDER",
    "purchase_order": "PURCHASE_ORDER",
    "PURCHASE_ORDER": "PURCHASE_ORDER",
    "subcontract": "SUBCONTRACT_ORDER",
    "subcontract-orders": "SUBCONTRACT_ORDER",
    "subcontract_order": "SUBCONTRACT_ORDER",
    "SUBCONTRACT_ORDER": "SUBCONTRACT_ORDER",
    "ar": "AR_INVOICE",
    "ar-invoices": "AR_INVOICE",
    "ar_invoice": "AR_INVOICE",
    "AR_INVOICE": "AR_INVOICE",
    "ap": "AP_BILL",
    "ap-bills": "AP_BILL",
    "ap_bill": "AP_BILL",
    "AP_BILL": "AP_BILL",
    "cash": "CASH_TRANSACTION",
    "cash-transactions": "CASH_TRANSACTION",
    "cash_transaction": "CASH_TRANSACTION",
    "CASH_TRANSACTION": "CASH_TRANSACTION",
    "je": "JOURNAL_ENTRY",
    "journal-entries": "JOURNAL_ENTRY",
    "journal": "JOURNAL_ENTRY",
    "JOURNAL_ENTRY": "JOURNAL_ENTRY",
}

# Legacy path segment ↔ canonical
LEGACY_MODULES = {
    "SALES_ORDER": "sales-orders",
    "PURCHASE_ORDER": "purchase-orders",
    "SUBCONTRACT_ORDER": "subcontract-orders",
    "AR_INVOICE": "ar-invoices",
    "AP_BILL": "ap-bills",
    "CASH_TRANSACTION": "cash-transactions",
    "JOURNAL_ENTRY": "journal-entries",
}

SUBMIT_PERMISSION = {
    "SALES_ORDER": "sales_order:submit",
    "PURCHASE_ORDER": "po:submit_for_approval",
    "SUBCONTRACT_ORDER": "subcontract:submit",
    "AR_INVOICE": "ar_invoice:submit",
    "AP_BILL": "ap_bill:submit",
    "CASH_TRANSACTION": "cash:submit",
    "JOURNAL_ENTRY": "journal:submit",
}

APPROVE_PERMISSION = {
    "SALES_ORDER": "sales_order:approve",
    "PURCHASE_ORDER": "po:approve",
    "SUBCONTRACT_ORDER": "subcontract:approve",
    "AR_INVOICE": "ar_invoice:approve",
    "AP_BILL": "ap_bill:approve",
    "CASH_TRANSACTION": "cash:approve",
    "JOURNAL_ENTRY": "journal:approve",
}

APPROVAL_MODULES = set(LEGACY_MODULES.values())
TERMINAL = {"APPROVED", "REJECTED", "CANCELLED"}


def normalize_module(type_or_module: str) -> str:
    key = MODULE_CANONICAL.get(type_or_module) or MODULE_CANONICAL.get(
        type_or_module.lower()
    )
    if not key:
        raise HTTPException(
            status_code=404, detail=f"Unknown transaction type '{type_or_module}'"
        )
    return key


def legacy_module(canonical: str) -> str:
    return LEGACY_MODULES[canonical]


def _so_amount(doc: SalesOrder) -> Decimal:
    return Decimal(str(doc.total_amount or 0))


def _po_amount(doc: PurchaseOrder) -> Decimal:
    return Decimal(str(doc.grand_total or 0))


def _sco_amount(doc: SubcontractOrder) -> Decimal:
    total = getattr(doc, "document_total", None)
    if total is not None:
        return Decimal(str(total or 0))
    return (Decimal(str(doc.unit_price or 0)) * Decimal(str(doc.quantity_ordered or 0))).quantize(
        Decimal("0.01")
    )


def _ar_amount(doc: ARInvoice) -> Decimal:
    return Decimal(str(doc.amount or 0))


def _ap_amount(doc: APBill) -> Decimal:
    return Decimal(str(doc.amount or 0))


def _cash_amount(doc: CashTransaction) -> Decimal:
    return Decimal(str(doc.amount or 0))


def _je_amount(doc: JournalEntry) -> Decimal:
    total = sum((p.debit or 0) for p in (doc.postings or []))
    return Decimal(str(total))


def _on_so_approved(db: Session, doc: SalesOrder) -> None:
    # Invoice creation is deferred to the Sales Invoice workflow after fulfillment.
    doc.status = "APPROVED"


def _on_po_approved(db: Session, doc: PurchaseOrder) -> None:
    # AP recognition is deferred to the Supplier Invoice workflow after goods receipt.
    doc.status = "Approved"


def _on_je_approved(db: Session, doc: JournalEntry) -> None:
    if doc.posting_status == "Draft":
        doc.posting_status = "Posted"


MODULE_CONFIG: dict[str, dict[str, Any]] = {
    "SALES_ORDER": {
        "model": SalesOrder,
        "id_attr": "sales_order_id",
        "amount_fn": _so_amount,
        "on_approve": _on_so_approved,
        "legacy": "sales-orders",
    },
    "PURCHASE_ORDER": {
        "model": PurchaseOrder,
        "id_attr": "po_number",
        "amount_fn": _po_amount,
        "on_approve": _on_po_approved,
        "legacy": "purchase-orders",
    },
    "SUBCONTRACT_ORDER": {
        "model": SubcontractOrder,
        "id_attr": "sco_number",
        "amount_fn": _sco_amount,
        "on_approve": None,
        "legacy": "subcontract-orders",
    },
    "AR_INVOICE": {
        "model": ARInvoice,
        "id_attr": "invoice_id",
        "amount_fn": _ar_amount,
        "on_approve": None,
        "legacy": "ar-invoices",
    },
    "AP_BILL": {
        "model": APBill,
        "id_attr": "bill_id",
        "amount_fn": _ap_amount,
        "on_approve": None,
        "legacy": "ap-bills",
    },
    "CASH_TRANSACTION": {
        "model": CashTransaction,
        "id_attr": "transaction_id",
        "amount_fn": _cash_amount,
        "on_approve": None,
        "legacy": "cash-transactions",
    },
    "JOURNAL_ENTRY": {
        "model": JournalEntry,
        "id_attr": "id",
        "amount_fn": _je_amount,
        "on_approve": _on_je_approved,
        "id_cast": UUID,
        "legacy": "journal-entries",
    },
}


def _load_document(db: Session, canonical: str, document_id: str) -> Any:
    cfg = MODULE_CONFIG[canonical]
    model = cfg["model"]
    id_attr = cfg["id_attr"]
    cast = cfg.get("id_cast")
    lookup_id: Any = document_id
    if cast is UUID:
        try:
            lookup_id = UUID(document_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid document id") from exc
    query = db.query(model)
    if canonical == "JOURNAL_ENTRY":
        query = query.options(selectinload(JournalEntry.postings))
    if canonical == "SUBCONTRACT_ORDER":
        query = query.options(selectinload(SubcontractOrder.components))
    doc = query.filter(getattr(model, id_attr) == lookup_id).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def resolve_workflow(
    db: Session, canonical: str, amount: Decimal
) -> WorkflowDefinition | None:
    defs = (
        db.query(WorkflowDefinition)
        .options(joinedload(WorkflowDefinition.steps))
        .filter(
            WorkflowDefinition.module == canonical,
            WorkflowDefinition.is_active.is_(True),
        )
        .all()
    )
    for wf in defs:
        min_a = Decimal(str(wf.min_amount or 0))
        max_a = Decimal(str(wf.max_amount)) if wf.max_amount is not None else None
        if amount < min_a:
            continue
        if max_a is not None and amount > max_a:
            continue
        return wf
    return None


def _sorted_steps(wf: WorkflowDefinition | None) -> list[WorkflowStep]:
    if not wf:
        return []
    return sorted(wf.steps or [], key=lambda s: s.step_number)


def _assert_permission(user: User, code: str) -> None:
    if user_is_admin(user):
        return
    if code not in user_permission_codes(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing permission '{code}'",
        )


def _assert_any_permission(user: User, codes: list[str]) -> None:
    if user_is_admin(user):
        return
    owned = user_permission_codes(user)
    if any(code in owned for code in codes):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Missing permission '{codes[0]}'",
    )


def _record_audit(
    db: Session,
    *,
    document_type: str,
    document_id: str,
    action: str,
    user: User,
    comments: str | None,
    step_number: int | None = None,
) -> ApprovalAuditLog:
    row = ApprovalAuditLog(
        document_type=document_type,
        document_id=document_id,
        step_number=step_number,
        action=action,
        performed_by_user_id=user.id,
        comments=comments,
    )
    db.add(row)
    db.flush()
    return row


def _doc_snapshot(
    canonical: str,
    document_id: str,
    doc: Any,
    *,
    workflow_id: str | None = None,
    pending_step_name: str | None = None,
    message: str | None = None,
) -> dict[str, Any]:
    return {
        "id": document_id,
        "type": canonical,
        "approval_status": getattr(doc, "approval_status", None),
        "current_approval_step": getattr(doc, "current_approval_step", None),
        "workflow_id": workflow_id,
        "pending_step_name": pending_step_name,
        "message": message,
    }


def _finalize_approved(
    db: Session,
    canonical: str,
    doc: Any,
    user: User,
    document_id: str,
    comments: str | None,
    step_number: int | None,
) -> None:
    doc.approval_status = "APPROVED"
    doc.current_approval_step = None
    on_approve = MODULE_CONFIG[canonical].get("on_approve")
    if on_approve:
        on_approve(db, doc)
    _record_audit(
        db,
        document_type=LEGACY_MODULES[canonical],
        document_id=document_id,
        action="APPROVED",
        user=user,
        comments=comments,
        step_number=step_number,
    )


def submit_document(
    db: Session,
    module: str,
    document_id: str,
    user: User,
    comments: str | None = None,
) -> dict[str, Any]:
    canonical = normalize_module(module)
    _assert_permission(user, SUBMIT_PERMISSION[canonical])

    doc = _load_document(db, canonical, document_id)
    if canonical == "SUBCONTRACT_ORDER":
        from app.services.subcontract import assert_sco_kit_fully_issued

        assert_sco_kit_fully_issued(doc)
    current = getattr(doc, "approval_status", None) or "DRAFT"
    if current not in {"DRAFT", "REJECTED"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot submit from approval status {current}",
        )

    amount_fn: Callable[[Any], Decimal] = MODULE_CONFIG[canonical]["amount_fn"]
    amount = amount_fn(doc)
    wf = resolve_workflow(db, canonical, amount)
    steps = _sorted_steps(wf)

    legacy = LEGACY_MODULES[canonical]
    _record_audit(
        db,
        document_type=legacy,
        document_id=document_id,
        action="SUBMITTED",
        user=user,
        comments=comments,
        step_number=None,
    )

    if canonical == "PURCHASE_ORDER" and getattr(doc, "status", None) == "Draft":
        doc.status = "Submitted"

    if not steps:
        # Auto-approve band (0 steps)
        _finalize_approved(
            db,
            canonical,
            doc,
            user,
            document_id,
            comments="AUTO_APPROVED" if not comments else f"AUTO_APPROVED: {comments}",
            step_number=0,
        )
        db.commit()
        db.refresh(doc)
        return _doc_snapshot(
            canonical,
            document_id,
            doc,
            workflow_id=wf.id if wf else None,
            message="Auto-approved (within threshold)",
        )

    doc.approval_status = "PENDING_APPROVAL"
    doc.current_approval_step = steps[0].step_number
    db.commit()
    db.refresh(doc)
    return _doc_snapshot(
        canonical,
        document_id,
        doc,
        workflow_id=wf.id if wf else None,
        pending_step_name=steps[0].step_name,
        message="Submitted for approval",
    )


def approve_document(
    db: Session,
    module: str,
    document_id: str,
    user: User,
    comments: str | None = None,
) -> dict[str, Any]:
    canonical = normalize_module(module)
    _assert_permission(user, APPROVE_PERMISSION[canonical])

    doc = _load_document(db, canonical, document_id)
    if canonical == "SUBCONTRACT_ORDER":
        from app.services.subcontract import assert_sco_kit_fully_issued

        assert_sco_kit_fully_issued(doc)
    current = getattr(doc, "approval_status", None) or "DRAFT"
    if current != "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot approve from approval status {current}",
        )

    amount_fn: Callable[[Any], Decimal] = MODULE_CONFIG[canonical]["amount_fn"]
    amount = amount_fn(doc)
    wf = resolve_workflow(db, canonical, amount)
    steps = _sorted_steps(wf)
    if not steps:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No workflow steps configured for this document",
        )

    step_num = getattr(doc, "current_approval_step", None) or steps[0].step_number
    step = next((s for s in steps if s.step_number == step_num), None)
    if step is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invalid current approval step {step_num}",
        )

    if not user_can_pass_step(
        user,
        required_role_id=step.required_role_id,
        required_permission=step.required_permission,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not authorized for step '{step.step_name}'",
        )

    legacy = LEGACY_MODULES[canonical]
    _record_audit(
        db,
        document_type=legacy,
        document_id=document_id,
        action="APPROVED",
        user=user,
        comments=comments,
        step_number=step.step_number,
    )

    remaining = [s for s in steps if s.step_number > step.step_number]
    if remaining:
        next_step = remaining[0]
        doc.current_approval_step = next_step.step_number
        doc.approval_status = "PENDING_APPROVAL"
        db.commit()
        db.refresh(doc)
        return _doc_snapshot(
            canonical,
            document_id,
            doc,
            workflow_id=wf.id if wf else None,
            pending_step_name=next_step.step_name,
            message=f"Advanced to step {next_step.step_number}",
        )

    doc.approval_status = "APPROVED"
    doc.current_approval_step = None
    on_approve = MODULE_CONFIG[canonical].get("on_approve")
    if on_approve:
        on_approve(db, doc)
    db.commit()
    db.refresh(doc)
    return _doc_snapshot(
        canonical,
        document_id,
        doc,
        workflow_id=wf.id if wf else None,
        message="Fully approved",
    )


def reject_document(
    db: Session,
    module: str,
    document_id: str,
    user: User,
    comments: str | None = None,
) -> dict[str, Any]:
    canonical = normalize_module(module)
    _assert_permission(user, APPROVE_PERMISSION[canonical])

    if not comments or not str(comments).strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Comments are required when rejecting",
        )

    doc = _load_document(db, canonical, document_id)
    current = getattr(doc, "approval_status", None) or "DRAFT"
    if current != "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot reject from approval status {current}",
        )

    amount_fn: Callable[[Any], Decimal] = MODULE_CONFIG[canonical]["amount_fn"]
    amount = amount_fn(doc)
    wf = resolve_workflow(db, canonical, amount)
    steps = _sorted_steps(wf)
    step_num = getattr(doc, "current_approval_step", None)
    step = next((s for s in steps if s.step_number == step_num), None) if steps else None

    if step and not user_can_pass_step(
        user,
        required_role_id=step.required_role_id,
        required_permission=step.required_permission,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not authorized for step '{step.step_name}'",
        )

    doc.approval_status = "REJECTED"
    doc.current_approval_step = None
    _record_audit(
        db,
        document_type=LEGACY_MODULES[canonical],
        document_id=document_id,
        action="REJECTED",
        user=user,
        comments=comments,
        step_number=step_num,
    )
    db.commit()
    db.refresh(doc)
    return _doc_snapshot(
        canonical,
        document_id,
        doc,
        workflow_id=wf.id if wf else None,
        message="Rejected",
    )


# Legacy aliases
decline_document = reject_document


def list_history(
    db: Session,
    module: str,
    document_id: str,
) -> list[dict[str, Any]]:
    canonical = normalize_module(module)
    legacy = LEGACY_MODULES[canonical]
    rows = (
        db.query(ApprovalAuditLog)
        .options(joinedload(ApprovalAuditLog.performed_by))
        .filter(
            ApprovalAuditLog.document_type.in_([legacy, canonical]),
            ApprovalAuditLog.document_id == document_id,
        )
        .order_by(ApprovalAuditLog.created_at.desc())
        .all()
    )

    # Enrich with step names when possible
    amount = None
    try:
        doc = _load_document(db, canonical, document_id)
        amount = MODULE_CONFIG[canonical]["amount_fn"](doc)
    except HTTPException:
        doc = None
    step_names: dict[int, str] = {}
    if amount is not None:
        wf = resolve_workflow(db, canonical, amount)
        for s in _sorted_steps(wf):
            step_names[s.step_number] = s.step_name

    result = []
    for r in rows:
        actor = r.performed_by
        result.append(
            {
                "id": r.id,
                "transaction_type": canonical,
                "transaction_id": r.document_id,
                "document_type": r.document_type,
                "document_id": r.document_id,
                "step_number": r.step_number,
                "step_name": step_names.get(r.step_number) if r.step_number else None,
                "action": r.action,
                "actor_user_id": str(r.performed_by_user_id) if r.performed_by_user_id else None,
                "performed_by_user_id": r.performed_by_user_id,
                "actor_name": actor.full_name if actor else None,
                "comments": r.comments,
                "timestamp": r.created_at,
                "created_at": r.created_at,
            }
        )
    return result


def require_approved(doc: Any, label: str = "Document") -> None:
    status_val = getattr(doc, "approval_status", None)
    if status_val != "APPROVED":
        raise HTTPException(
            status_code=400,
            detail=f"{label} must be APPROVED before this action (current: {status_val})",
        )


def amend_subcontract_order(
    db: Session,
    document_id: str,
    user: User,
    comments: str | None = None,
) -> dict[str, Any]:
    """Reopen an approved SCO to Draft so the vendor cost sheet can be revised."""
    from app.services.subcontract import assert_can_amend_cost_sheet

    canonical = "SUBCONTRACT_ORDER"
    _assert_permission(user, SUBMIT_PERMISSION[canonical])
    doc = _load_document(db, canonical, document_id)
    assert_can_amend_cost_sheet(doc)

    next_rev = int(getattr(doc, "amendment_number", 0) or 0) + 1
    doc.amendment_number = next_rev
    doc.approval_status = "DRAFT"
    doc.current_approval_step = None
    note = (comments or "").strip() or f"Cost sheet amendment {next_rev}"
    _record_audit(
        db,
        document_type=LEGACY_MODULES[canonical],
        document_id=document_id,
        action="AMENDED",
        user=user,
        comments=note,
    )
    db.commit()
    db.refresh(doc)
    return _doc_snapshot(
        canonical,
        document_id,
        doc,
        message=f"Reopened as Draft for cost sheet amendment {next_rev}",
    )


def recall_purchase_order(
    db: Session,
    document_id: str,
    user: User,
    comments: str | None = None,
) -> dict[str, Any]:
    """Return a submitted or approved PO to Draft without PATCH status conflicts."""
    from app.services.p2p import assert_can_recall_purchase_order

    canonical = "PURCHASE_ORDER"
    _assert_any_permission(
        user,
        [SUBMIT_PERMISSION[canonical], APPROVE_PERMISSION[canonical]],
    )
    doc = _load_document(db, canonical, document_id)
    assert_can_recall_purchase_order(db, doc)

    doc.approval_status = "DRAFT"
    doc.current_approval_step = None
    if getattr(doc, "status", None) != "Void":
        doc.status = "Draft"

    note = (comments or "").strip() or "Recalled for revision"
    _record_audit(
        db,
        document_type=LEGACY_MODULES[canonical],
        document_id=document_id,
        action="RECALLED",
        user=user,
        comments=note,
    )
    db.commit()
    db.refresh(doc)
    return _doc_snapshot(
        canonical,
        document_id,
        doc,
        message="Recalled to Draft for revision",
    )
