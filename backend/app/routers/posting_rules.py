# @author: Wendy Yang
# @date: 2026-09-19

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_permission
from app.models import User
from app.schemas import PostingRuleRead, PostingRuleUpdate
from app.services import posting_rules as posting_rule_service

router = APIRouter(prefix="/posting-rules", tags=["posting-rules"])


@router.get("", response_model=list[PostingRuleRead])
def list_posting_rules(
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:view")),
):
    return posting_rule_service.list_posting_rules(db)


@router.patch("/{rule_id}", response_model=PostingRuleRead)
def update_posting_rule(
    rule_id: UUID,
    payload: PostingRuleUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:create")),
):
    result = posting_rule_service.update_posting_rule(
        db, rule_id, payload.model_dump(exclude_unset=True)
    )
    db.commit()
    return result


@router.post("/{rule_id}/reset", response_model=PostingRuleRead, status_code=status.HTTP_200_OK)
def reset_posting_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("journal:create")),
):
    result = posting_rule_service.reset_posting_rule(db, rule_id)
    db.commit()
    return result
