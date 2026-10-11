# @author: Wendy Yang
# @date: 2026-10-11

"""Active company for the current request, used when numbering documents."""

from __future__ import annotations

from contextvars import ContextVar, Token
from uuid import UUID

from fastapi import Request

from app.database import SessionLocal
from app.models import UserCompany
from app.services.auth import decode_access_token

_company_id: ContextVar[UUID | None] = ContextVar("document_company_id", default=None)


def current_document_company_id() -> UUID | None:
    return _company_id.get()


def set_document_company(company_id: UUID | None) -> Token:
    return _company_id.set(company_id)


def reset_document_company(token: Token) -> None:
    _company_id.reset(token)


def bind_request_company(request: Request) -> Token | None:
    """Use X-Company-Id when the signed-in user belongs to that company."""
    header = (request.headers.get("x-company-id") or "").strip()
    authorization = request.headers.get("authorization") or ""
    scheme, _, raw = authorization.partition(" ")
    if not header or scheme.lower() != "bearer" or not raw.strip():
        return None
    try:
        payload = decode_access_token(raw.strip())
        user_id = UUID(str(payload.get("sub")))
        company_id = UUID(header)
    except Exception:
        return None
    db = SessionLocal()
    try:
        member = (
            db.query(UserCompany.user_id)
            .filter(UserCompany.user_id == user_id, UserCompany.company_id == company_id)
            .first()
        )
    finally:
        db.close()
    if member is None:
        return None
    return set_document_company(company_id)
