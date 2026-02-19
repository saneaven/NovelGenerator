from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import event
from sqlalchemy.orm import Session

from ..utils.object_type_aliases import externalize_object_type
from .runtime_event_dispatcher import runtime_event_dispatcher

logger = logging.getLogger(__name__)

_PENDING_OBJECT_CHANGES_KEY = "_pending_object_changes"
_HOOKS_REGISTERED = False

_ACTION_PRIORITY = {
    "updated": 1,
    "created": 2,
    "deleted": 3,
}


@dataclass(frozen=True)
class _ChangeKey:
    project_id: str
    object_type: str
    object_id: str


def _as_non_empty_str(value: UUID | str | Any, *, field_name: str) -> str:
    if isinstance(value, UUID):
        return str(value)
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} must be a non-empty value")
    return text


def _normalize_action(action: str) -> str:
    text = str(action or "").strip().lower()
    if text not in _ACTION_PRIORITY:
        raise ValueError(f"Unsupported object change action: {action}")
    return text


def queue_object_change(
    db: Session,
    *,
    project_id: UUID | str,
    object_type: str,
    object_id: UUID | str,
    action: str,
) -> None:
    project_id_str = _as_non_empty_str(project_id, field_name="project_id")
    object_id_str = _as_non_empty_str(object_id, field_name="object_id")
    object_type_text = _as_non_empty_str(object_type, field_name="object_type")
    normalized_action = _normalize_action(action)
    external_type = externalize_object_type(object_type_text)

    pending = db.info.setdefault(_PENDING_OBJECT_CHANGES_KEY, {})
    if not isinstance(pending, dict):
        pending = {}
        db.info[_PENDING_OBJECT_CHANGES_KEY] = pending

    key = _ChangeKey(
        project_id=project_id_str,
        object_type=external_type,
        object_id=object_id_str,
    )
    current_action = pending.get(key)
    if current_action is None:
        pending[key] = normalized_action
        return

    if _ACTION_PRIORITY[normalized_action] >= _ACTION_PRIORITY.get(str(current_action), 0):
        pending[key] = normalized_action


async def _emit_object_change_batch(project_id: str, changes: list[dict[str, str]]) -> None:
    try:
        await runtime_event_dispatcher.emit_project_event(
            project_id=project_id,
            event_name="object:changed",
            data={
                "batch_id": str(uuid4()),
                "changes": changes,
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to emit object:changed SSE event for project %s", project_id)


def _after_commit(session: Session) -> None:
    pending = session.info.pop(_PENDING_OBJECT_CHANGES_KEY, None)
    if not pending or not isinstance(pending, dict):
        return

    grouped_changes: dict[str, list[dict[str, str]]] = defaultdict(list)
    for key, action in pending.items():
        if not isinstance(key, _ChangeKey):
            continue
        action_text = str(action or "").strip().lower()
        if action_text not in _ACTION_PRIORITY:
            continue
        grouped_changes[key.project_id].append(
            {
                "action": action_text,
                "object_type": key.object_type,
                "object_id": key.object_id,
            }
        )

    if not grouped_changes:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop for object:changed dispatch; falling back to sync emit")
        for project_id, changes in grouped_changes.items():
            asyncio.run(_emit_object_change_batch(project_id, changes))
        return

    for project_id, changes in grouped_changes.items():
        loop.create_task(_emit_object_change_batch(project_id, changes))


def _after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_OBJECT_CHANGES_KEY, None)


def register_object_change_event_hooks() -> None:
    global _HOOKS_REGISTERED
    if _HOOKS_REGISTERED:
        return

    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_rollback", _after_rollback)
    _HOOKS_REGISTERED = True
