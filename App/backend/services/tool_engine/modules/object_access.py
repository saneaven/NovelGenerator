from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ....models.db_models import Act, Outline
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement


STORY_OBJECT_TYPES = ("character", "location", "organization", "lorebook")


def to_uuid(value: Any, field_name: str) -> UUID:
    try:
        return UUID(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Invalid {field_name}: {value}") from exc


def require_story_object_type(value: Any) -> str:
    if isinstance(value, str) and value in STORY_OBJECT_TYPES:
        return value
    raise ValueError(f"Unknown story object type: {value}")


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
) -> dict[str, Any]:
    obj = object_service.get_object(
        db,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
        language=language,
    )
    if obj is None:
        raise ValueError(f"{object_type} not found: {object_id}")
    return obj


def ensure_outline_parent_exists(db: Session, *, project_id: UUID, outline_id: UUID) -> None:
    row = db.query(Outline).filter(Outline.id == outline_id, Outline.project_id == project_id).first()
    if row is None:
        raise ValueError(f"Parent outline not found: {outline_id}")


def ensure_act_parent_exists(db: Session, *, project_id: UUID, act_id: UUID) -> None:
    row = (
        db.query(Act)
        .join(Outline, Outline.id == Act.outline_id)
        .filter(Act.id == act_id, Outline.project_id == project_id)
        .first()
    )
    if row is None:
        raise ValueError(f"Parent act not found: {act_id}")


def patch_text(current: str, *, old: str, new: str) -> str:
    rr = apply_single_replacement(current, old, new)
    if not rr.success:
        raise ValueError(rr.reason or rr.code or "Patch failed")
    return rr.content


def patch_object_field(current: dict[str, Any], *, field: str, old: str, new: str) -> dict[str, Any]:
    updated = dict(current)
    updated[field] = patch_text(str(current.get(field) or ""), old=old, new=new)
    return updated
