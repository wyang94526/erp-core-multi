# @author: Wendy Yang
# @date: 2026-09-19

"""In-memory pending write actions awaiting user confirmation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from uuid import uuid4


@dataclass
class PendingAction:
    action_id: str
    user_id: str
    action_type: str
    summary: str
    payload: dict[str, Any]
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_LOCK = Lock()
_PENDING: dict[str, PendingAction] = {}
_TTL = timedelta(minutes=30)


def create_pending_action(
    *,
    user_id: str,
    action_type: str,
    summary: str,
    payload: dict[str, Any],
) -> PendingAction:
    action = PendingAction(
        action_id=str(uuid4()),
        user_id=str(user_id),
        action_type=action_type,
        summary=summary,
        payload=payload,
    )
    with _LOCK:
        _PENDING[action.action_id] = action
    return action


def pop_pending_action(action_id: str, user_id: str) -> PendingAction | None:
    with _LOCK:
        _expire_locked()
        action = _PENDING.get(action_id)
        if action is None:
            return None
        if action.user_id != str(user_id):
            return None
        del _PENDING[action_id]
        return action


def get_pending_action(action_id: str, user_id: str) -> PendingAction | None:
    with _LOCK:
        _expire_locked()
        action = _PENDING.get(action_id)
        if action is None or action.user_id != str(user_id):
            return None
        return action


def _expire_locked() -> None:
    now = datetime.now(timezone.utc)
    expired = [k for k, v in _PENDING.items() if now - v.created_at > _TTL]
    for key in expired:
        del _PENDING[key]
