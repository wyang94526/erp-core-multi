from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Role, User
from app.schemas import UserCreate, UserRead, UserRoleBrief, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


def _serialize_user(user: User) -> dict:
    roles = [
        UserRoleBrief(role_id=r.role_id, role_name=r.role_name) for r in (user.roles or [])
    ]
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "status": user.status or "ACTIVE",
        "department_id": user.department_id,
        "roles": roles,
        "role_id": roles[0].role_id if roles else None,
        "created_at": user.created_at,
    }


def _assign_roles(db: Session, user: User, role_ids: list[str]) -> None:
    if not role_ids:
        user.roles = []
        return
    roles = db.query(Role).filter(Role.role_id.in_(role_ids)).all()
    found = {r.role_id for r in roles}
    missing = set(role_ids) - found
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown roles: {sorted(missing)}")
    user.roles = roles


@router.get("", response_model=list[UserRead])
def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[dict]:
    users = (
        db.query(User)
        .options(joinedload(User.roles))
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_serialize_user(u) for u in users]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> dict:
    data = payload.model_dump(exclude={"role_ids", "role_id"})
    user = User(**data)
    db.add(user)
    db.flush()
    role_ids = list(payload.role_ids or [])
    if payload.role_id and payload.role_id not in role_ids:
        role_ids.append(payload.role_id)
    _assign_roles(db, user, role_ids)
    db.commit()
    user = (
        db.query(User)
        .options(joinedload(User.roles))
        .filter(User.id == user.id)
        .first()
    )
    return _serialize_user(user)


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: UUID, db: Session = Depends(get_db)) -> dict:
    user = (
        db.query(User)
        .options(joinedload(User.roles))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_user(user)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(user_id: UUID, payload: UserUpdate, db: Session = Depends(get_db)) -> dict:
    user = (
        db.query(User)
        .options(joinedload(User.roles))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    data = payload.model_dump(exclude_unset=True, exclude={"role_ids", "role_id"})
    for key, value in data.items():
        setattr(user, key, value)
    if payload.role_ids is not None or payload.role_id is not None:
        role_ids = list(payload.role_ids or [])
        if payload.role_id and payload.role_id not in role_ids:
            role_ids.append(payload.role_id)
        _assign_roles(db, user, role_ids)
    db.commit()
    user = (
        db.query(User)
        .options(joinedload(User.roles))
        .filter(User.id == user_id)
        .first()
    )
    return _serialize_user(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: UUID, db: Session = Depends(get_db)) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
