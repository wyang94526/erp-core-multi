# @author: Wendy Yang
# @date: 2026-10-10

"""Create the first administrator when a database has none."""

from __future__ import annotations

from fastapi import HTTPException

from app.config import get_settings
from app.database import SessionLocal
from app.models import Department, Role, User
from app.security_questions import (
    DEFAULT_SECURITY_ANSWER,
    DEFAULT_SECURITY_QUESTION,
    normalize_security_answer,
)
from app.services.auth import decode_access_token, hash_password
from app.services.companies import ensure_user_membership

_PASSWORD_CHANGE_ALLOWED = {
    "/health",
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/change-password",
    "/api/v1/auth/security-question",
    "/api/v1/auth/reset-password",
    "/api/v1/auth/security-questions",
    "/api/v1/auth/me",
    "/api/v1/company-profile/public",
}


def ensure_bootstrap_admin() -> None:
    """Insert ROLE-ADMIN for a new database. Leave an existing administrator unchanged."""
    settings = get_settings()
    name = (settings.bootstrap_admin_name or "Admin").strip() or "Admin"

    db = SessionLocal()
    try:
        role = db.query(Role).filter(Role.role_id == "ROLE-ADMIN").one_or_none()
        if role is None:
            print("bootstrap admin skipped: ROLE-ADMIN is not configured", flush=True)
            return
        already_admin = (
            db.query(User.id)
            .join(User.roles)
            .filter(Role.role_id == "ROLE-ADMIN")
            .first()
        )
        if already_admin is not None:
            return

        department = db.query(Department).filter(Department.id == "DEPT-ADMIN").one_or_none()
        user = User(
            email=None,
            full_name=name,
            password_hash=hash_password(settings.bootstrap_admin_password),
            security_question=DEFAULT_SECURITY_QUESTION,
            security_answer_hash=hash_password(
                normalize_security_answer(DEFAULT_SECURITY_ANSWER)
            ),
            status="ACTIVE",
            department_id=department.id if department is not None else None,
            must_change_password=True,
        )
        user.roles = [role]
        db.add(user)
        db.flush()
        ensure_user_membership(db, user)
        db.commit()
        print(f"created bootstrap administrator {name} with no email", flush=True)
    finally:
        db.close()


def password_change_required(path: str, authorization: str | None) -> bool:
    """True when this request must wait until the signed-in user changes password."""
    if path in _PASSWORD_CHANGE_ALLOWED or not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return False
    try:
        payload = decode_access_token(token)
    except HTTPException:
        return False
    user_id = payload.get("sub")
    if not user_id:
        return False
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        return bool(user and user.must_change_password)
    finally:
        db.close()
