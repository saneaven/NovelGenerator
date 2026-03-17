from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PENDING_ASSET_CHANGES_KEY = "_pending_asset_changes"
_HOOKS_REGISTERED = False

_ACTION_PRIORITY = {
    "updated": 1,
    "created": 2,
    "deleted": 3,
}


@dataclass(frozen=True)
class _ProjectAssetsKey:
    user_id: str
    project_id: str


@dataclass(frozen=True)
class _ObjectAssetLinksKey:
    user_id: str
    project_id: str
    object_type: str
    object_id: str


@dataclass(frozen=True)
class _SceneAssetsKey:
    user_id: str
    project_id: str
    manuscript_id: str | None


AssetChangeKey = _ProjectAssetsKey | _ObjectAssetLinksKey | _SceneAssetsKey


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
        raise ValueError(f"Unsupported asset change action: {action}")
    return text


def _normalize_optional_uuid(value: UUID | str | Any | None, *, field_name: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return str(value)
    text = str(value).strip()
    if not text:
        raise ValueError(f"{field_name} must be None or a non-empty value")
    return text


def queue_asset_change(
    db: Session,
    *,
    user_id: UUID | str,
    project_id: UUID | str,
    scope: str,
    action: str,
    object_type: str | None = None,
    object_id: UUID | str | None = None,
    manuscript_id: UUID | str | None = None,
) -> None:
    user_id_str = _as_non_empty_str(user_id, field_name="user_id")
    project_id_str = _as_non_empty_str(project_id, field_name="project_id")
    normalized_action = _normalize_action(action)
    normalized_scope = str(scope or "").strip().lower()

    if normalized_scope == "project_assets":
        key = _ProjectAssetsKey(user_id=user_id_str, project_id=project_id_str)
    elif normalized_scope == "object_asset_links":
        object_type_text = _as_non_empty_str(object_type, field_name="object_type")
        object_id_text = _as_non_empty_str(object_id, field_name="object_id")
        key = _ObjectAssetLinksKey(
            user_id=user_id_str,
            project_id=project_id_str,
            object_type=object_type_text,
            object_id=object_id_text,
        )
    elif normalized_scope == "scene_assets":
        key = _SceneAssetsKey(
            user_id=user_id_str,
            project_id=project_id_str,
            manuscript_id=_normalize_optional_uuid(manuscript_id, field_name="manuscript_id"),
        )
    else:
        raise ValueError(f"Unsupported asset change scope: {scope}")

    pending = db.info.setdefault(_PENDING_ASSET_CHANGES_KEY, {})
    if not isinstance(pending, dict):
        pending = {}
        db.info[_PENDING_ASSET_CHANGES_KEY] = pending

    current_action = pending.get(key)
    if current_action is None:
        pending[key] = normalized_action
        return

    if _ACTION_PRIORITY[normalized_action] >= _ACTION_PRIORITY.get(str(current_action), 0):
        pending[key] = normalized_action


def queue_project_assets_change(
    db: Session,
    *,
    user_id: UUID | str,
    project_id: UUID | str,
    action: str = "updated",
) -> None:
    queue_asset_change(
        db,
        user_id=user_id,
        project_id=project_id,
        scope="project_assets",
        action=action,
    )


def queue_object_assets_change(
    db: Session,
    *,
    user_id: UUID | str,
    project_id: UUID | str,
    object_type: str,
    object_id: UUID | str,
    action: str = "updated",
) -> None:
    queue_asset_change(
        db,
        user_id=user_id,
        project_id=project_id,
        scope="object_asset_links",
        action=action,
        object_type=object_type,
        object_id=object_id,
    )


def queue_scene_assets_change(
    db: Session,
    *,
    user_id: UUID | str,
    project_id: UUID | str,
    manuscript_id: UUID | str | None,
    action: str = "updated",
) -> None:
    queue_asset_change(
        db,
        user_id=user_id,
        project_id=project_id,
        scope="scene_assets",
        action=action,
        manuscript_id=manuscript_id,
    )


async def _emit_asset_change_batch(user_id: str, project_id: str, changes: list[dict[str, Any]]) -> None:
    try:
        from .runtime_event_dispatcher import runtime_event_dispatcher

        await runtime_event_dispatcher.emit_project_event(
            user_id=user_id,
            project_id=project_id,
            event_name="asset:changed",
            data={
                "batch_id": str(uuid4()),
                "changes": changes,
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to emit asset:changed SSE event for project %s", project_id)


def _serialize_change(key: AssetChangeKey, action: str) -> dict[str, Any]:
    if isinstance(key, _ProjectAssetsKey):
        return {
            "scope": "project_assets",
            "action": action,
        }
    if isinstance(key, _ObjectAssetLinksKey):
        return {
            "scope": "object_asset_links",
            "action": action,
            "object_type": key.object_type,
            "object_id": key.object_id,
        }
    return {
        "scope": "scene_assets",
        "action": action,
        "manuscript_id": key.manuscript_id,
    }


def _after_commit(session: Session) -> None:
    pending = session.info.pop(_PENDING_ASSET_CHANGES_KEY, None)
    if not pending or not isinstance(pending, dict):
        return

    grouped_changes: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for key, action in pending.items():
        if not isinstance(key, (_ProjectAssetsKey, _ObjectAssetLinksKey, _SceneAssetsKey)):
            continue
        action_text = str(action or "").strip().lower()
        if action_text not in _ACTION_PRIORITY:
            continue
        grouped_changes[(key.user_id, key.project_id)].append(_serialize_change(key, action_text))

    if not grouped_changes:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop for asset:changed dispatch; falling back to sync emit")
        for (user_id, project_id), changes in grouped_changes.items():
            asyncio.run(_emit_asset_change_batch(user_id, project_id, changes))
        return

    for (user_id, project_id), changes in grouped_changes.items():
        loop.create_task(_emit_asset_change_batch(user_id, project_id, changes))


def _after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_ASSET_CHANGES_KEY, None)


def register_asset_change_event_hooks() -> None:
    global _HOOKS_REGISTERED
    if _HOOKS_REGISTERED:
        return

    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_rollback", _after_rollback)
    _HOOKS_REGISTERED = True
