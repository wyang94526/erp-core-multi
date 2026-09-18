# @author: Wendy Yang
# @date: 2026-09-19

"""AI chat API — JWT-protected assistant endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.agent import run_chat
from app.ai.context import AiRequestContext, clear_ai_context, set_ai_context
from app.ai.pending_actions import pop_pending_action
from app.ai.tools import execute_confirmed_action
from app.database import get_db
from app.deps.auth import get_current_user
from app.models import User

router = APIRouter(prefix="/ai", tags=["ai"])


class AiPageContext(BaseModel):
    route: str | None = None
    sales_order_id: str | None = None
    purchase_order_id: str | None = None
    subcontract_order_id: str | None = None
    item_id: str | None = None
    entity_id: str | None = None
    entity_type: str | None = None


class AiChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    page_context: AiPageContext | dict[str, Any] | None = None


class AiPendingAction(BaseModel):
    action_id: str
    action_type: str
    summary: str
    payload: dict[str, Any] | None = None


class AiChatResponse(BaseModel):
    conversation_id: str
    reply: str
    pending_action: AiPendingAction | None = None


class AiConfirmRequest(BaseModel):
    action_id: str
    conversation_id: str | None = None


class AiConfirmResponse(BaseModel):
    reply: str
    result: dict[str, Any] | None = None


@router.post("/chat", response_model=AiChatResponse)
def chat(
    payload: AiChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    page_ctx: dict[str, Any] = {}
    if payload.page_context is not None:
        if isinstance(payload.page_context, AiPageContext):
            page_ctx = payload.page_context.model_dump(exclude_none=True)
        else:
            page_ctx = dict(payload.page_context)

    set_ai_context(
        AiRequestContext(
            db=db,
            user=user,
            page_context=page_ctx,
            conversation_id=payload.conversation_id or "",
        )
    )
    try:
        result = run_chat(
            message=payload.message.strip(),
            conversation_id=payload.conversation_id,
            page_context=page_ctx,
        )
    finally:
        clear_ai_context()

    pending = result.get("pending_action")
    return {
        "conversation_id": result["conversation_id"],
        "reply": result["reply"],
        "pending_action": pending,
    }


@router.post("/confirm", response_model=AiConfirmResponse)
def confirm_action(
    payload: AiConfirmRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    action = pop_pending_action(payload.action_id, str(user.id))
    if action is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pending action not found or expired",
        )
    try:
        result = execute_confirmed_action(db, user, action.action_type, action.payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    reply = f"Confirmed. {action.summary}."
    if action.action_type == "create_draft_sales_order" and result:
        reply = (
            f"Draft sales order **{result.get('sales_order_id')}** created "
            f"(status {result.get('status')}, total {result.get('total_amount')})."
        )
    elif action.action_type == "create_draft_purchase_order" and result:
        reply = (
            f"Draft purchase order **{result.get('po_number')}** created "
            f"(status {result.get('status')}, total {result.get('grand_total')})."
        )
    return {"reply": reply, "result": result}
