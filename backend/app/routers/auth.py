# @author: Wendy Yang
# @date: 2026-09-19

"""Authentication endpoints: register, login, change/reset password, and session restore."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import func
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
    RegistrationCountryRead,
    UserRoleBrief,
)
from app.security_questions import normalize_security_answer
from app.services.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.services.companies import assign_local_company, registration_countries

router = APIRouter(prefix="/auth", tags=["auth"])

DEFAULT_REGISTER_ROLE = "ROLE-UNASSIGNED"
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
        "email": user.email or None,
        "full_name": user.full_name,
        "status": user.status or "ACTIVE",
        "department_id": user.department_id,
        "department_name": user.department.name if user.department else None,
        "roles": roles,
        "permissions": perms,
        "role_id": roles[0].role_id if roles else None,
        "role_name": roles[0].role_name if roles else None,
        "has_security_question": bool(user.security_question and user.security_answer_hash),
        "must_change_password": bool(user.must_change_password),
        "country": user.country,
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


@router.get("/countries", response_model=list[RegistrationCountryRead])
def list_registration_countries(db: Session = Depends(get_db)) -> list[dict]:
    return registration_countries(db)


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
        country=payload.country.strip(),
        status="ACTIVE",
    )
    user.roles = [role]
    db.add(user)
    db.flush()
    membership = assign_local_company(db, user)
    db.commit()

    user = _load_user(db, user.id)
    assert user is not None
    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_current_user(user),
        "company_id": membership.company_id,
    }


@router.post("/login", response_model=AuthTokenResponse)
def login(payload: AuthLoginRequest, db: Session = Depends(get_db)) -> dict:
    identifier = payload.email.strip()
    query = db.query(User).options(
        joinedload(User.roles).joinedload(Role.permissions),
        joinedload(User.department),
    )
    if "@" in identifier:
        user = query.filter(func.lower(User.email) == identifier.lower()).first()
    else:
        user = query.filter(
            User.email.is_(None),
            func.lower(User.full_name) == identifier.lower(),
            User.must_change_password.is_(True),
        ).first()
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

    company_id = None
    if (user.country or "").strip():
        membership = assign_local_company(db, user)
        db.commit()
        company_id = membership.company_id
        user = _load_user(db, user.id)
        assert user is not None

    token = create_access_token(user_id=user.id, email=user.email or "")
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _serialize_current_user(user),
        "company_id": company_id,
    }


def _parse_work_email(value: str) -> str:
    try:
        parsed = TypeAdapter(EmailStr).validate_python(value.strip())
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a valid work email",
        ) from exc
    return str(parsed).lower()


def _user_from_bearer(authorization: str | None, db: Session) -> User | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        payload = decode_access_token(token)
    except HTTPException:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id).first()


@router.post("/change-password", response_model=AuthChangePasswordResponse)
def change_password(
    payload: AuthChangePasswordRequest,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict:
    """Change password using work email + current password.

    The initial administrator has no email yet. That signed-in user sets the
    work email on this same request.
    """
    user = _user_from_bearer(authorization, db)
    if user is None:
        if not payload.email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or current password",
            )
        user = db.query(User).filter(func.lower(User.email) == payload.email.strip().lower()).first()
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
    if not (user.email or "").strip():
        if not (payload.email or "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Work email is required",
            )
        new_email = _parse_work_email(payload.email or "")
        taken = (
            db.query(User)
            .filter(func.lower(User.email) == new_email, User.id != user.id)
            .first()
        )
        if taken is not None:
            raise HTTPException(status_code=400, detail="Email is already registered")
        user.email = new_email

    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
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
    user.must_change_password = False
    db.add(user)
    db.commit()
    return {"message": "Password reset successfully"}


@router.get("/me", response_model=CurrentUserRead)
def me(user: User = Depends(get_current_user)) -> dict:
    return _serialize_current_user(user)
