from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ....models.db_models import Outline, StoryEntityFolder
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement
from ....services.outline_service import require_outline_kind
from ....services.rich_text.registry import get_rich_text_fields
from ....utils.story_entities import (
    STORY_ENTITY_FOLDER_TYPE,
    STORY_ENTITY_KINDS,
    STORY_ENTITY_TYPE,
    require_story_entity_kind,
)


STORY_ENTITY_KIND_VALUES = tuple(STORY_ENTITY_KINDS)


def to_uuid(value: Any, field_name: str) -> UUID:
    try:
        return UUID(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Invalid {field_name}: {value}") from exc


def require_story_entity_arg_kind(value: Any) -> str:
    try:
        return require_story_entity_kind(value)
    except ValueError as exc:
        raise ValueError(f"Unknown story entity kind: {value}") from exc


def extract_lang_data(obj: dict[str, Any], language: str) -> dict[str, Any]:
    data = obj.get("data", {})
    if isinstance(data.get(language), dict):
        return data[language]
    for val in data.values() if isinstance(data, dict) else []:
        if isinstance(val, dict):
            return val
    return {}


def get_primary_object_id(db: Session, project_id: UUID, object_type: str) -> UUID:
    rows = object_service.list_objects(db, project_id=project_id, object_type=object_type)
    if not rows:
        raise ValueError(f"No {object_type} object found in project")
    return to_uuid(rows[0]["id"], "id")


def read_object(
    db: Session,
    *,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
    rich_text_format: str | None = None,
) -> dict[str, Any]:
    kwargs = {"rich_text_format": rich_text_format} if rich_text_format is not None else {}
    obj = object_service.get_object(
        db,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
        language=language,
        **kwargs,
    )
    if obj is None:
        raise ValueError(f"{object_type} not found: {object_id}")
    return obj


def read_story_entity(
    db: Session,
    *,
    project_id: UUID,
    object_id: UUID,
    language: str,
    kind: Any,
    rich_text_format: str | None = None,
) -> dict[str, Any]:
    expected_kind = require_story_entity_arg_kind(kind)
    obj = read_object(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_TYPE,
        object_id=object_id,
        language=language,
        rich_text_format=rich_text_format,
    )
    actual_kind = str(obj.get("kind") or "").strip()
    if actual_kind and actual_kind != expected_kind:
        raise ValueError(f"Story entity kind mismatch: expected {expected_kind}, got {actual_kind}")
    return obj


def read_story_entity_folder(
    db: Session,
    *,
    project_id: UUID,
    object_id: UUID,
    language: str,
    rich_text_format: str | None = None,
) -> dict[str, Any]:
    return read_object(
        db,
        project_id=project_id,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        object_id=object_id,
        language=language,
        rich_text_format=rich_text_format,
    )


def runtime_rich_text_kwargs(object_type: str) -> dict[str, str]:
    if get_rich_text_fields(object_type):
        return {"rich_text_format": "markdown"}
    return {}


def read_runtime_object(
    db: Session,
    *,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
) -> dict[str, Any]:
    return read_object(
        db,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        language=language,
        **runtime_rich_text_kwargs(object_type),
    )


def read_runtime_story_entity(
    db: Session,
    *,
    project_id: UUID,
    object_id: UUID,
    language: str,
    kind: Any,
) -> dict[str, Any]:
    return read_story_entity(
        db,
        project_id=project_id,
        object_id=object_id,
        language=language,
        kind=kind,
        **runtime_rich_text_kwargs(STORY_ENTITY_TYPE),
    )


def ensure_outline_parent_exists(db: Session, *, project_id: UUID, outline_id: UUID) -> None:
    row = db.query(Outline).filter(Outline.id == outline_id, Outline.project_id == project_id).first()
    if row is None:
        raise ValueError(f"Parent outline not found: {outline_id}")


def ensure_outline_parent_kind(
    db: Session,
    *,
    project_id: UUID,
    outline_id: UUID,
    expected_kind: str,
) -> None:
    required_kind = require_outline_kind(expected_kind)
    row = (
        db.query(Outline)
        .filter(Outline.id == outline_id, Outline.project_id == project_id)
        .first()
    )
    if row is None:
        raise ValueError(f"Parent outline not found: {outline_id}")
    if row.kind != required_kind:
        raise ValueError(f"Parent outline must be kind={required_kind}")


def ensure_story_entity_folder_exists(
    db: Session,
    *,
    project_id: UUID,
    folder_id: Any,
    field_name: str = "folderId",
) -> None:
    if folder_id is None:
        return
    parsed_folder_id = to_uuid(folder_id, field_name)
    row = (
        db.query(StoryEntityFolder)
        .filter(StoryEntityFolder.id == parsed_folder_id, StoryEntityFolder.project_id == project_id)
        .first()
    )
    if row is None:
        raise ValueError(f"Story entity folder not found: {parsed_folder_id}")


def patch_text(current: str, *, old: str, new: str) -> str:
    rr = apply_single_replacement(current, old, new)
    if not rr.success:
        raise ValueError(rr.reason or rr.code or "Patch failed")
    return rr.content


def patch_object_field(current: dict[str, Any], *, field: str, old: str, new: str) -> dict[str, Any]:
    updated = dict(current)
    updated[field] = patch_text(str(current.get(field) or ""), old=old, new=new)
    return updated
