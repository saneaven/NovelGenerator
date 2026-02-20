from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ....models.db_models import (
    Act,
    BasicInfo,
    Chapter,
    Character,
    Guidelines,
    Location,
    LorebookEntry,
    Manuscript,
    Organization,
    Outline,
)
from ....models.translation_models import ObjectVersion
from ...object_service import object_service
from ...patch_utils import apply_single_replacement


STORY_TYPE_MAP: dict[str, str] = {
    "character": "character",
    "location": "location",
    "organization": "organization",
    "lorebook": "lorebook",
}

ALL_OBJECT_TYPE_MAP: dict[str, str] = {
    **STORY_TYPE_MAP,
    "basic_info": "basic_info",
    "guidelines": "guidelines",
    "outline": "outline",
    "act": "act",
    "chapter": "chapter",
    "manuscript": "manuscript",
}


def obj_schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
    }


def to_uuid(value: Any, field_name: str) -> UUID:
    try:
        return UUID(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Invalid {field_name}: {value}") from exc


def parse_required_field(args: dict[str, Any], name: str) -> str | None:
    value = args.get(name)
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def content_to_doc(content: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": content}],
            }
        ],
    }


def get_primary_object_id(db: Session, project_id: UUID, object_type: str) -> UUID:
    rows = object_service.list_objects(db, project_id=project_id, object_type=object_type)
    if not rows:
        raise ValueError(f"No {object_type} object found in project")
    return to_uuid(rows[0]["id"], "id")


def read_object(
    db: Session,
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


def extract_lang_data(obj: dict[str, Any], language: str) -> dict[str, Any]:
    data = obj.get("data", {})
    if isinstance(data.get(language), dict):
        return data[language]
    for val in data.values() if isinstance(data, dict) else []:
        if isinstance(val, dict):
            return val
    return {}


def resolve_object_type(args: dict[str, Any], tool_name: str) -> str | None:
    raw_type = args.get("type")
    type_value = raw_type if isinstance(raw_type, str) else None

    if tool_name == "read_story_object" and type_value:
        if type_value in {"basic_info", "guidelines"}:
            return type_value
        return STORY_TYPE_MAP.get(type_value)

    if tool_name == "read_outline" and type_value:
        if type_value in {"outline", "act", "chapter"}:
            return type_value
        return None

    if tool_name == "read_manuscript":
        return "manuscript"

    if "story_object" in tool_name and type_value:
        return STORY_TYPE_MAP.get(type_value)

    if "outline_act" in tool_name:
        return "act"
    if "outline_chapter" in tool_name:
        return "chapter"
    if tool_name in {"patch_outline", "replace_outline", "delete_outline"}:
        return "outline"

    if "basic_info" in tool_name:
        return "basic_info"
    if "guidelines" in tool_name:
        return "guidelines"
    if "manuscript" in tool_name:
        return "manuscript"

    if type_value in ALL_OBJECT_TYPE_MAP:
        return ALL_OBJECT_TYPE_MAP[type_value]
    return None


def load_object_for_project(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    project_id: UUID,
) -> Any | None:
    if object_type == "basic_info":
        return db.query(BasicInfo).filter(BasicInfo.id == object_id, BasicInfo.project_id == project_id).first()
    if object_type == "guidelines":
        return db.query(Guidelines).filter(Guidelines.id == object_id, Guidelines.project_id == project_id).first()
    if object_type == "character":
        return db.query(Character).filter(Character.id == object_id, Character.project_id == project_id).first()
    if object_type == "location":
        return db.query(Location).filter(Location.id == object_id, Location.project_id == project_id).first()
    if object_type == "organization":
        return db.query(Organization).filter(Organization.id == object_id, Organization.project_id == project_id).first()
    if object_type == "lorebook":
        return db.query(LorebookEntry).filter(LorebookEntry.id == object_id, LorebookEntry.project_id == project_id).first()
    if object_type == "outline":
        return db.query(Outline).filter(Outline.id == object_id, Outline.project_id == project_id).first()
    if object_type == "act":
        return (
            db.query(Act)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Act.id == object_id, Outline.project_id == project_id)
            .first()
        )
    if object_type == "chapter":
        return (
            db.query(Chapter)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Chapter.id == object_id, Outline.project_id == project_id)
            .first()
        )
    if object_type == "manuscript":
        return (
            db.query(Manuscript)
            .join(Chapter, Chapter.id == Manuscript.chapter_id)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Manuscript.id == object_id, Outline.project_id == project_id)
            .first()
        )
    return None


def latest_version_data(db: Session, *, object_type: str, object_id: UUID, language: str) -> dict[str, Any]:
    latest = (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )
    if latest is None or not isinstance(latest.data, dict):
        return {}
    if isinstance(latest.data.get(language), dict):
        return latest.data[language]
    for v in latest.data.values():
        if isinstance(v, dict):
            return v
    return {}


def patch_object_data(current: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    field = args.get("field")
    old = str(args.get("old") or "")
    new = str(args.get("new") or "")

    if not isinstance(field, str) or not field.strip():
        raise ValueError("patch_* requires non-empty field")

    current_value = str(current.get(field) or "")
    result = apply_single_replacement(current_value, old, new)
    if not result.success:
        raise ValueError(result.reason or "Failed to patch field")

    updated = dict(current)
    updated[field] = result.content
    return updated
