"""Authentication / RBAC dependencies.

Identity is provided via the ``X-User-Id`` header (UUID of a ``users`` row).
If omitted, falls back to the first Admin user (or any user) so local demos
keep working.

JWT follow-up: replace header resolution in ``get_current_user`` with Bearer
token decode; leave permission helpers unchanged.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Permission, Role, User


def user_role_ids(user: User) -> set[str]:
    return {r.role_id for r in (user.roles or [])}


def user_is_admin(user: User) -> bool:
    return "ROLE-ADMIN" in user_role_ids(user) or any(
        (r.role_name or "").lower() == "admin" for r in (user.roles or [])
    )


def user_permission_codes(user: User) -> set[str]:
    codes: set[str] = set()
    for role in user.roles or []:
        for perm in role.permissions or []:
            codes.add(perm.code)
    return codes


def get_current_user(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> User:
    """Resolve the acting user. Swap this function body for JWT later."""
    role_opts = joinedload(User.roles).joinedload(Role.permissions)
    dept_opt = joinedload(User.department)

    user: User | None = None
    if x_user_id:
        try:
            user_uuid = UUID(x_user_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid X-User-Id header",
            ) from exc
        user = (
            db.query(User)
            .options(role_opts, dept_opt)
            .filter(User.id == user_uuid)
            .first()
        )
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found for X-User-Id",
            )
    else:
        # Prefer an Admin via user_roles join
        user = (
            db.query(User)
            .options(role_opts, dept_opt)
            .join(User.roles)
            .filter(Role.role_id == "ROLE-ADMIN")
            .first()
        )
        if user is None:
            user = db.query(User).options(role_opts, dept_opt).first()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No users available; seed the database first",
            )

    if (user.status or "ACTIVE").upper() != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return user


def require_permission(code: str) -> Callable:
    """FastAPI dependency factory: require a permission code (Admin bypass)."""

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user_is_admin(user):
            return user
        if code not in user_permission_codes(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission '{code}'",
            )
        return user

    return _checker


def require_any_permission(*codes: str) -> Callable:
    def _checker(user: User = Depends(get_current_user)) -> User:
        if user_is_admin(user):
            return user
        perms = user_permission_codes(user)
        if not any(c in perms for c in codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing one of permissions: {', '.join(codes)}",
            )
        return user

    return _checker


def user_can_pass_step(
    user: User,
    *,
    required_role_id: str | None,
    required_permission: str | None,
) -> bool:
    if user_is_admin(user):
        return True
    role_ok = bool(required_role_id and required_role_id in user_role_ids(user))
    perm_ok = bool(
        required_permission and required_permission in user_permission_codes(user)
    )
    return role_ok or perm_ok
