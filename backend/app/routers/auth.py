"""Authentication endpoints: register, login, change/reset password, and session restore."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps.auth import get_current_user, user_is_admin, user_permission_codes
from app.models import Role, SecurityQuestionOption, User
from app.schemas import (
    AuthChangePasswordRequest,
    AuthChangePasswordResponse,
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthResetPasswordRequest,
    AuthResetPasswordResponse,
    AuthSecurityQuestionLookupRequest,
    AuthSecurityQuestionLookupResponse,
    AuthSecurityQuestionsResponse,
    AuthTokenResponse,
    CurrentUserRead,
    UserRoleBrief,
)
from app.security_questions import normalize_security_answer
from app.services.auth import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

DEFAULT_REGISTER_ROLE = "ROLE-SALES-REP"
CUSTOM_QUESTION_SENTINEL = "__custom__"


def _serialize_current_user(user: User) -> dict:
    roles = [
        UserRoleBrief(role_id=r.role_id, role_name=r.role_name) for r in (user.roles or [])
    ]
    perms = sorted(user_permission_codes(user))
    if user_is_admin(user) and "admin:manage" not in perms:
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
        "has_security_question": bool(user.security_question and user.security_answer_hash),
    }


def _load_user(db: Session, user_id) -> User | None:
    return (
        db.query(User)
        .options(
            joinedload(User.roles).joinedload(Role.permissions),
            joinedload(User.department),
        )
        .filter(User.id == user_id)
        .first()
    )


def _active_catalog_questions(db: Session) -> list[str]:
    rows = (
        db.query(SecurityQuestionOption)
        .filter(SecurityQuestionOption.is_active.is_(True))
        .order_by(SecurityQuestionOption.sort_order, SecurityQuestionOption.id)
        .all()
    )
    return [r.question_text for r in rows]


def _resolve_security_question(question: str) -> str:
    """Accept a catalog question or a custom free-text question."""
    cleaned = " ".join(question.strip().split())
    if not cleaned or cleaned == CUSTOM_QUESTION_SENTINEL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security question is required",
        )
    if len(cleaned) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security question is too short",
        )
    return cleaned


def _hash_security_answer(answer: str) -> str:
    return hash_password(normalize_security_answer(answer))


def _verify_security_answer(answer: str, answer_hash: str | None) -> bool:
    if not answer_hash:
        return False
    return verify_password(normalize_security_answer(answer), answer_hash)


@router.get("/security-questions", response_model=AuthSecurityQuestionsResponse)
def list_security_questions(db: Session = Depends(get_db)) -> dict:
    return {"questions": _active_catalog_questions(db)}


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: AuthRegisterRequest, db: Session = Depends(get_db)) -> dict:
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email is already registered")

    role = db.query(Role).filter(Role.role_id == DEFAULT_REGISTER_ROLE).first()
    if role is None:
        raise HTTPException(
            status_code=500,
            detail=f"Default role {DEFAULT_REGISTER_ROLE} is not configured",
        )

    question = _resolve_security_question(payload.security_question)

    user = User(
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        security_question=question,
        security_answer_hash=_hash_security_answer(payload.security_answer),
        status="ACTIVE",
    )
    user.roles = [role]
    db.add(user)
    db.commit()

    user = _load_user(db, user.id)
    assert user is not None
    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_current_user(user),
    }


@router.post("/login", response_model=AuthTokenResponse)
def login(payload: AuthLoginRequest, db: Session = Depends(get_db)) -> dict:
    email = payload.email.strip().lower()
    user = (
        db.query(User)
        .options(
            joinedload(User.roles).joinedload(Role.permissions),
            joinedload(User.department),
        )
        .filter(User.email == email)
        .first()
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if (user.status or "ACTIVE").upper() != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_current_user(user),
    }


@router.post("/change-password", response_model=AuthChangePasswordResponse)
def change_password(
    payload: AuthChangePasswordRequest, db: Session = Depends(get_db)
) -> dict:
    """Change password using work email + current password."""
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or current password",
        )
    if (user.status or "ACTIVE").upper() != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password",
        )

    user.password_hash = hash_password(payload.new_password)
    db.add(user)
    db.commit()
    return {"message": "Password updated successfully"}


@router.post(
    "/security-question",
    response_model=AuthSecurityQuestionLookupResponse,
)
def lookup_security_question(
    payload: AuthSecurityQuestionLookupRequest, db: Session = Depends(get_db)
) -> dict:
    """Return the security question for a work email (forgot-password step 1)."""
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if (
        user is None
        or not user.security_question
        or not user.security_answer_hash
        or (user.status or "ACTIVE").upper() != "ACTIVE"
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No recovery question is available for this email",
        )
    return {"email": user.email, "security_question": user.security_question}


@router.post("/reset-password", response_model=AuthResetPasswordResponse)
def reset_password(
    payload: AuthResetPasswordRequest, db: Session = Depends(get_db)
) -> dict:
    """Reset password after verifying the security-question answer."""
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not _verify_security_answer(
        payload.security_answer, user.security_answer_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect security answer",
        )
    if (user.status or "ACTIVE").upper() != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    user.password_hash = hash_password(payload.new_password)
    db.add(user)
    db.commit()
    return {"message": "Password reset successfully"}


@router.get("/me", response_model=CurrentUserRead)
def me(user: User = Depends(get_current_user)) -> dict:
    return _serialize_current_user(user)
