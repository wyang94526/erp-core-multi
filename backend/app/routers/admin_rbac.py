"""Admin RBAC endpoints: roles, permissions, users, workflows."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps.auth import get_current_user, require_permission
from app.models import (
    Permission,
    Role,
    User,
    WorkflowDefinition,
    WorkflowStep,
)
from app.schemas import (
    PermissionRead,
    RoleRead,
    UserRead,
    UserRoleBrief,
    UserRolesAssign,
    WorkflowDefinitionCreate,
    WorkflowDefinitionRead,
    WorkflowStepRead,
)

router = APIRouter(prefix="/admin", tags=["admin-rbac"])


def _role_read(role: Role) -> dict:
    return {
        "role_id": role.role_id,
        "role_name": role.role_name,
        "description": role.description,
        "created_at": role.created_at,
        "permissions": sorted(p.code for p in (role.permissions or [])),
    }


def _user_read(user: User) -> dict:
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


def _workflow_read(wf: WorkflowDefinition) -> dict:
    steps = sorted(wf.steps or [], key=lambda s: s.step_number)
    return {
        "id": wf.id,
        "module": wf.module,
        "min_amount": wf.min_amount,
        "max_amount": wf.max_amount,
        "is_active": wf.is_active,
        "name": wf.name,
        "created_at": wf.created_at,
        "steps": [
            WorkflowStepRead(
                id=s.id,
                step_number=s.step_number,
                step_name=s.step_name,
                required_role_id=s.required_role_id,
                required_permission=s.required_permission,
            )
            for s in steps
        ],
    }


@router.get("/roles", response_model=list[RoleRead])
def list_roles(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    roles = (
        db.query(Role)
        .options(joinedload(Role.permissions))
        .order_by(Role.role_name)
        .all()
    )
    return [_role_read(r) for r in roles]


@router.get("/permissions", response_model=list[PermissionRead])
def list_permissions(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[Permission]:
    return db.query(Permission).order_by(Permission.module, Permission.code).all()


@router.get("/users", response_model=list[UserRead])
def list_admin_users(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    users = db.query(User).options(joinedload(User.roles)).order_by(User.full_name).all()
    return [_user_read(u) for u in users]


@router.post("/users/{user_id}/roles", response_model=UserRead)
def assign_user_roles(
    user_id: UUID,
    payload: UserRolesAssign,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    user = (
        db.query(User)
        .options(joinedload(User.roles))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    roles = db.query(Role).filter(Role.role_id.in_(payload.role_ids)).all()
    found = {r.role_id for r in roles}
    missing = set(payload.role_ids) - found
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown roles: {sorted(missing)}")
    user.roles = roles
    db.commit()
    user = (
        db.query(User)
        .options(joinedload(User.roles))
        .filter(User.id == user_id)
        .first()
    )
    return _user_read(user)


@router.get("/workflows", response_model=list[WorkflowDefinitionRead])
def list_workflows(
    module: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    q = db.query(WorkflowDefinition).options(joinedload(WorkflowDefinition.steps))
    if module:
        q = q.filter(WorkflowDefinition.module == module.upper())
    wfs = q.order_by(WorkflowDefinition.module, WorkflowDefinition.min_amount).all()
    return [_workflow_read(w) for w in wfs]


@router.post("/workflows", response_model=WorkflowDefinitionRead, status_code=201)
def create_workflow(
    payload: WorkflowDefinitionCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    if db.get(WorkflowDefinition, payload.id):
        raise HTTPException(status_code=400, detail="Workflow id already exists")
    wf = WorkflowDefinition(
        id=payload.id,
        module=payload.module.upper(),
        min_amount=payload.min_amount,
        max_amount=payload.max_amount,
        is_active=payload.is_active,
        name=payload.name,
    )
    db.add(wf)
    for step in payload.steps:
        db.add(
            WorkflowStep(
                id=step.id,
                workflow_definition_id=payload.id,
                step_number=step.step_number,
                step_name=step.step_name,
                required_role_id=step.required_role_id,
                required_permission=step.required_permission,
            )
        )
    db.commit()
    wf = (
        db.query(WorkflowDefinition)
        .options(joinedload(WorkflowDefinition.steps))
        .filter(WorkflowDefinition.id == payload.id)
        .first()
    )
    return _workflow_read(wf)
