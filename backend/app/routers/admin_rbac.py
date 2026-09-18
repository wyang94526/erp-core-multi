# @author: Wendy Yang
# @date: 2026-09-19

"""Admin RBAC endpoints: roles, permissions, users, workflows."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
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
    PermissionCreate,
    PermissionRead,
    PermissionUpdate,
    RoleCreate,
    RoleRead,
    RoleUpdate,
    UserRead,
    UserRoleBrief,
    UserRolesAssign,
    WorkflowDefinitionCreate,
    WorkflowDefinitionRead,
    WorkflowDefinitionUpdate,
    WorkflowStepCreate,
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


def _load_permissions_by_codes(db: Session, codes: list[str]) -> list[Permission]:
    if not codes:
        return []
    perms = db.query(Permission).filter(Permission.code.in_(codes)).all()
    found = {p.code for p in perms}
    missing = set(codes) - found
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Unknown permission codes: {sorted(missing)}"
        )
    return perms


def _validate_workflow_steps(db: Session, steps: list[WorkflowStepCreate]) -> None:
    seen_numbers: set[int] = set()
    seen_ids: set[str] = set()
    for step in steps:
        if step.step_number in seen_numbers:
            raise HTTPException(
                status_code=400, detail=f"Duplicate step_number: {step.step_number}"
            )
        seen_numbers.add(step.step_number)
        if step.id in seen_ids:
            raise HTTPException(status_code=400, detail=f"Duplicate step id: {step.id}")
        seen_ids.add(step.id)
        if not step.required_role_id and not step.required_permission:
            raise HTTPException(
                status_code=400,
                detail=f"Step {step.id} needs required_role_id or required_permission",
            )
        if step.required_role_id and db.get(Role, step.required_role_id) is None:
            raise HTTPException(
                status_code=400, detail=f"Unknown role: {step.required_role_id}"
            )


def _replace_workflow_steps(
    db: Session, workflow_id: str, steps: list[WorkflowStepCreate]
) -> None:
    _validate_workflow_steps(db, steps)
    db.query(WorkflowStep).filter(WorkflowStep.workflow_definition_id == workflow_id).delete()
    for step in steps:
        db.add(
            WorkflowStep(
                id=step.id,
                workflow_definition_id=workflow_id,
                step_number=step.step_number,
                step_name=step.step_name,
                required_role_id=step.required_role_id,
                required_permission=step.required_permission,
            )
        )


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------


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


@router.post("/roles", response_model=RoleRead, status_code=201)
def create_role(
    payload: RoleCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    if db.get(Role, payload.role_id) is not None:
        raise HTTPException(status_code=400, detail="Role id already exists")
    if (
        db.query(Role)
        .filter(Role.role_name == payload.role_name)
        .first()
        is not None
    ):
        raise HTTPException(status_code=400, detail="Role name already exists")
    role = Role(
        role_id=payload.role_id,
        role_name=payload.role_name,
        description=payload.description,
    )
    role.permissions = _load_permissions_by_codes(db, payload.permission_codes)
    db.add(role)
    db.commit()
    role = (
        db.query(Role)
        .options(joinedload(Role.permissions))
        .filter(Role.role_id == payload.role_id)
        .first()
    )
    return _role_read(role)


@router.patch("/roles/{role_id}", response_model=RoleRead)
def update_role(
    role_id: str,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    role = (
        db.query(Role)
        .options(joinedload(Role.permissions))
        .filter(Role.role_id == role_id)
        .first()
    )
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    data = payload.model_dump(exclude_unset=True)
    if "role_name" in data and data["role_name"] is not None:
        clash = (
            db.query(Role)
            .filter(Role.role_name == data["role_name"], Role.role_id != role_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="Role name already exists")
        role.role_name = data["role_name"]
    if "description" in data:
        role.description = data["description"]
    if "permission_codes" in data and data["permission_codes"] is not None:
        role.permissions = _load_permissions_by_codes(db, data["permission_codes"])
    db.commit()
    role = (
        db.query(Role)
        .options(joinedload(Role.permissions))
        .filter(Role.role_id == role_id)
        .first()
    )
    return _role_read(role)


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(
    role_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> Response:
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    in_use = (
        db.query(WorkflowStep)
        .filter(WorkflowStep.required_role_id == role_id)
        .first()
    )
    if in_use:
        raise HTTPException(
            status_code=400,
            detail="Role is referenced by workflow steps; reassign those steps first",
        )
    try:
        db.delete(role)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="Role cannot be deleted because it is still in use"
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


@router.get("/permissions", response_model=list[PermissionRead])
def list_permissions(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[Permission]:
    return db.query(Permission).order_by(Permission.module, Permission.code).all()


@router.post("/permissions", response_model=PermissionRead, status_code=201)
def create_permission(
    payload: PermissionCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> Permission:
    if db.get(Permission, payload.id) is not None:
        raise HTTPException(status_code=400, detail="Permission id already exists")
    if db.query(Permission).filter(Permission.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Permission code already exists")
    perm = Permission(**payload.model_dump())
    db.add(perm)
    db.commit()
    db.refresh(perm)
    return perm


@router.patch("/permissions/{permission_id}", response_model=PermissionRead)
def update_permission(
    permission_id: str,
    payload: PermissionUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> Permission:
    perm = db.get(Permission, permission_id)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] is not None:
        clash = (
            db.query(Permission)
            .filter(Permission.code == data["code"], Permission.id != permission_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="Permission code already exists")
    for key, value in data.items():
        setattr(perm, key, value)
    db.commit()
    db.refresh(perm)
    return perm


@router.delete("/permissions/{permission_id}", status_code=204)
def delete_permission(
    permission_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> Response:
    perm = db.get(Permission, permission_id)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    db.delete(perm)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------


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
    _validate_workflow_steps(db, payload.steps)
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


@router.patch("/workflows/{workflow_id}", response_model=WorkflowDefinitionRead)
def update_workflow(
    workflow_id: str,
    payload: WorkflowDefinitionUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> dict:
    wf = (
        db.query(WorkflowDefinition)
        .options(joinedload(WorkflowDefinition.steps))
        .filter(WorkflowDefinition.id == workflow_id)
        .first()
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    data = payload.model_dump(exclude_unset=True)
    if "module" in data and data["module"] is not None:
        wf.module = data["module"].upper()
    if "min_amount" in data and data["min_amount"] is not None:
        wf.min_amount = data["min_amount"]
    if "max_amount" in data:
        wf.max_amount = data["max_amount"]
    if "is_active" in data and data["is_active"] is not None:
        wf.is_active = data["is_active"]
    if "name" in data:
        wf.name = data["name"]
    if "steps" in data and data["steps"] is not None:
        step_models = [WorkflowStepCreate(**s) for s in data["steps"]]
        _replace_workflow_steps(db, workflow_id, step_models)
    db.commit()
    wf = (
        db.query(WorkflowDefinition)
        .options(joinedload(WorkflowDefinition.steps))
        .filter(WorkflowDefinition.id == workflow_id)
        .first()
    )
    return _workflow_read(wf)


@router.delete("/workflows/{workflow_id}", status_code=204)
def delete_workflow(
    workflow_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("admin:manage")),
) -> Response:
    wf = db.get(WorkflowDefinition, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(wf)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
