"""Request-scoped AI execution context (DB session, user, page)."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.models import User


@dataclass
class AiRequestContext:
    db: Session
    user: User
    page_context: dict[str, Any] = field(default_factory=dict)
    conversation_id: str = ""


_ai_ctx: ContextVar[AiRequestContext | None] = ContextVar("ai_request_context", default=None)


def set_ai_context(ctx: AiRequestContext) -> None:
    _ai_ctx.set(ctx)


def get_ai_context() -> AiRequestContext:
    ctx = _ai_ctx.get()
    if ctx is None:
        raise RuntimeError("AI request context is not set")
    return ctx


def clear_ai_context() -> None:
    _ai_ctx.set(None)
