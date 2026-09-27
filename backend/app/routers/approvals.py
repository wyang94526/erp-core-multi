# @author: Wendy Yang
# @date: 2026-09-19

"""Approval workflow endpoints — uniform transactions API + legacy aliases."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import get_current_user, user_is_admin, user_permission_codes
from app.models import User
from app.schemas import (
    ApprovalActionRequest,
    ApprovalHistoryRead,
    CurrentUserRead,
    RoleRead,
    TransactionActionResult,
    UserRoleBrief,
)
from app.services import approval as approval_service

router = APIRouter(tags=["approvals"])


def _comments(payload: ApprovalActionRequest | None) -> str | None:
    return payload.comments if payload else None


# ---------------------------------------------------------------------------
# Uniform transaction routes
# ---------------------------------------------------------------------------


@router.post(
    "/transactions/{type}/{document_id}/submit",
    response_model=TransactionActionResult,
)
def submit_transaction(
    type: str,
    document_id: str,
    payload: ApprovalActionRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return approval_service.submit_document(
        db, type, document_id, user, _comments(payload)
    )


@router.post(
    "/transactions/{type}/{document_id}/approve",
    response_model=TransactionActionResult,
)
def approve_transaction(
    type: str,
    document_id: str,
    payload: ApprovalActionRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return approval_service.approve_document(
        db, type, document_id, user, _comments(payload)
    )


@router.post(
    "/transactions/{type}/{document_id}/reject",
    response_model=TransactionActionResult,
)
def reject_transaction(
    type: str,
    document_id: str,
    payload: ApprovalActionRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return approval_service.reject_document(
        db, type, document_id, user, _comments(payload)
    )


@router.post(
    "/transactions/{type}/{document_id}/recall",
    response_model=TransactionActionResult,
)
def recall_transaction(
    type: str,
    document_id: str,
    payload: ApprovalActionRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    canonical = approval_service.normalize_module(type)
    if canonical != "PURCHASE_ORDER":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recall is only available for purchase orders",
        )
    return approval_service.recall_purchase_order(
        db, document_id, user, _comments(payload)
    )


@router.post(
    "/transactions/{type}/{document_id}/revise",
    response_model=TransactionActionResult,
)
def revise_transaction(
    type: str,
    document_id: str,
    payload: ApprovalActionRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return approval_service.revise_document(
        db, type, document_id, user, _comments(payload)
    )


@router.get(
    "/transactions/{type}/{document_id}/approval-history",
    response_model=list[ApprovalHistoryRead],
)
def transaction_approval_history(
    type: str,
    document_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return approval_service.list_history(db, type, document_id)


# ---------------------------------------------------------------------------
# Legacy per-module routes (thin wrappers)
# ---------------------------------------------------------------------------


def _add_module_routes(module: str) -> None:
    async def submit_endpoint(
        document_id: str,
        payload: ApprovalActionRequest | None = None,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        return approval_service.submit_document(
            db, module, document_id, user, _comments(payload)
        )

    async def approve_endpoint(
        document_id: str,
        payload: ApprovalActionRequest | None = None,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        return approval_service.approve_document(
            db, module, document_id, user, _comments(payload)
        )

    async def decline_endpoint(
        document_id: str,
        payload: ApprovalActionRequest | None = None,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user),
    ):
        return approval_service.reject_document(
            db, module, document_id, user, _comments(payload)
        )

    async def history_endpoint(
        document_id: str,
        db: Session = Depends(get_db),
        _user: User = Depends(get_current_user),
    ):
        return approval_service.list_history(db, module, document_id)

    router.add_api_route(
        f"/{module}/{{document_id}}/submit",
        submit_endpoint,
        methods=["POST"],
        response_model=TransactionActionResult,
        name=f"{module}_submit",
    )
    router.add_api_route(
        f"/{module}/{{document_id}}/approve",
        approve_endpoint,
        methods=["POST"],
        response_model=TransactionActionResult,
        name=f"{module}_approve",
    )
    router.add_api_route(
        f"/{module}/{{document_id}}/decline",
        decline_endpoint,
        methods=["POST"],
        response_model=TransactionActionResult,
        name=f"{module}_decline",
    )
    router.add_api_route(
        f"/{module}/{{document_id}}/reject",
        decline_endpoint,
        methods=["POST"],
        response_model=TransactionActionResult,
        name=f"{module}_reject",
    )
    router.add_api_route(
        f"/{module}/{{document_id}}/approval-history",
        history_endpoint,
        methods=["GET"],
        response_model=list[ApprovalHistoryRead],
        name=f"{module}_approval_history",
    )


for _module in sorted(approval_service.APPROVAL_MODULES):
    _add_module_routes(_module)


@router.get("/roles", response_model=list[RoleRead])
def list_roles(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    from app.models import Role
    from sqlalchemy.orm import joinedload

    roles = (
        db.query(Role)
        .options(joinedload(Role.permissions))
        .order_by(Role.role_name)
        .all()
    )
    return [
        {
            "role_id": r.role_id,
            "role_name": r.role_name,
            "description": r.description,
            "created_at": r.created_at,
            "permissions": sorted(p.code for p in (r.permissions or [])),
        }
        for r in roles
    ]


@router.get("/me", response_model=CurrentUserRead)
def current_user_profile(user: User = Depends(get_current_user)) -> dict:
    roles = [
        UserRoleBrief(role_id=r.role_id, role_name=r.role_name) for r in (user.roles or [])
    ]
    perms = sorted(user_permission_codes(user))
    if user_is_admin(user) and "admin:manage" not in perms:
        # Ensure admin sees admin:manage even if seed lag
        perms = sorted(set(perms) | {"admin:manage"})
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "status": user.status or "ACTIVE",
        "department_id": user.department_id,
        "department_name": user.department.name if user.department else None,
        "roles": roles,
        "permissions": perms,
        "role_id": roles[0].role_id if roles else None,
        "role_name": roles[0].role_name if roles else None,
    }
