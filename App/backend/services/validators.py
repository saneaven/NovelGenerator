from __future__ import annotations

from dataclasses import dataclass
import inspect
from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import (
    Act,
    BasicInfo,
    Chapter,
    Guidelines,
    Character,
    Location,
    LorebookEntry,
    Manuscript,
    Organization,
    Outline,
    RunModel,
)
from ..models.translation_models import ObjectVersion
from .patch_utils import apply_single_replacement
from .sidecar_client import SidecarClient, SidecarConversionError, SidecarUnavailableError
from .tool_schemas import ToolSchemaDef, get_tool_schema


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


@dataclass
class ValidationResult:
    valid: bool
    reason: str | None = None
    validator: str | None = None


@dataclass
class ValidationContext:
    db: Session
    run: RunModel
    allowed_tool_names: set[str] | None
    schema_by_name: dict[str, ToolSchemaDef]
    rag_search_enabled: bool
    sidecar: SidecarClient | None = None


Validator = Callable[[dict[str, Any], str, ValidationContext], ValidationResult | Awaitable[ValidationResult]]


def valid_result() -> ValidationResult:
    return ValidationResult(valid=True)


def invalid_result(validator: str, reason: str) -> ValidationResult:
    return ValidationResult(valid=False, reason=reason, validator=validator)


def _schema_for(tool_name: str, ctx: ValidationContext) -> ToolSchemaDef | None:
    if tool_name in ctx.schema_by_name:
        return ctx.schema_by_name[tool_name]
    return get_tool_schema(tool_name)


def _resolve_object_type(args: dict[str, Any], tool_name: str) -> str | None:
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


def _parse_required_field(args: dict[str, Any], name: str) -> str | None:
    value = args.get(name)
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _load_object_for_project(db: Session, *, object_type: str, object_id: UUID, project_id: UUID) -> Any | None:
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


def _latest_version_data(db: Session, *, object_type: str, object_id: UUID, language: str) -> dict[str, Any]:
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


def validate_tool_schema(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    schema = _schema_for(tool_name, ctx)
    if schema is None:
        if tool_name.startswith("call_"):
            return valid_result()
        return invalid_result("validate_tool_schema", f"Unknown tool: {tool_name}")

    required = schema.parameters.get("required")
    properties = schema.parameters.get("properties")

    req_list = required if isinstance(required, list) else []
    prop_map = properties if isinstance(properties, dict) else {}

    for param in req_list:
        value = args.get(param)
        if value is None:
            return invalid_result("validate_tool_schema", f"Missing required parameter: {param}")
        if isinstance(value, str) and not value.strip():
            return invalid_result("validate_tool_schema", f"Required parameter cannot be empty: {param}")

    for key, value in args.items():
        schema_prop = prop_map.get(key)
        if not isinstance(schema_prop, dict):
            continue
        enum_vals = schema_prop.get("enum")
        if isinstance(enum_vals, list) and value not in enum_vals:
            return invalid_result(
                "validate_tool_schema",
                f"Invalid value for {key}: {value}. Expected one of: {', '.join(str(v) for v in enum_vals)}",
            )

    return valid_result()


def validate_tool_allowed_in_session(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    _ = args
    if not ctx.allowed_tool_names:
        return valid_result()
    if tool_name in ctx.allowed_tool_names:
        return valid_result()
    return invalid_result("validate_tool_allowed_in_session", f"Tool not available in this session: {tool_name}")


def validate_sub_agent_call_input(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    _ = ctx
    if not tool_name.startswith("call_"):
        return valid_result()
    value = args.get("input")
    if not isinstance(value, str) or not value.strip():
        return invalid_result("validate_sub_agent_call_input", 'call_* tools require a non-empty string field "input".')
    return valid_result()


def validate_type_mapping(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    _ = ctx
    raw_type = args.get("type")
    if not isinstance(raw_type, str):
        return valid_result()

    if "story_object" in tool_name and raw_type not in STORY_TYPE_MAP:
        return invalid_result("validate_type_mapping", f"Unknown story object type: {raw_type}")

    if "_translation" in tool_name and raw_type not in ALL_OBJECT_TYPE_MAP:
        return invalid_result("validate_type_mapping", f"Unknown object type for translation: {raw_type}")

    return valid_result()


def validate_required_id(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    _ = ctx
    if tool_name.startswith("create_"):
        return valid_result()
    value = _parse_required_field(args, "id")
    if value is None:
        return invalid_result("validate_required_id", f"Missing required id for {tool_name}")
    return valid_result()


def validate_patch_required_fields(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    _ = ctx
    if not tool_name.startswith("patch_"):
        return valid_result()

    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or new_text is None:
        return invalid_result("validate_patch_required_fields", f"Missing required fields (old, new) for {tool_name}")

    if "manuscript" not in tool_name:
        field = args.get("field")
        if not isinstance(field, str) or not field.strip():
            return invalid_result("validate_patch_required_fields", f"Missing required field 'field' for {tool_name}")

    return valid_result()


def validate_rag_search_enabled(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    _ = args
    if tool_name != "rag_search":
        return valid_result()
    if not ctx.rag_search_enabled:
        return invalid_result("validate_rag_search_enabled", "Embeddings are disabled (Settings > Search & Memory)")
    return valid_result()


async def validate_object_exists(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    if tool_name.startswith("create_"):
        return valid_result()

    obj_id = _parse_required_field(args, "id")
    if obj_id is None:
        if tool_name == "patch_basic_info":
            # patch_basic_info has no id and is validated by project-level basic_info presence.
            basic = ctx.db.query(BasicInfo).filter(BasicInfo.project_id == ctx.run.project_id).first()
            if basic is None:
                return invalid_result("validate_object_exists", "No basic info found")
            return valid_result()
        return valid_result()

    object_type = _resolve_object_type(args, tool_name)
    if object_type is None:
        return invalid_result("validate_object_exists", f"Cannot determine object type for {tool_name}")

    try:
        object_uuid = UUID(obj_id)
    except (TypeError, ValueError):
        return invalid_result("validate_object_exists", f"Invalid object id format: {obj_id}")

    obj = _load_object_for_project(
        ctx.db,
        object_type=object_type,
        object_id=object_uuid,
        project_id=ctx.run.project_id,
    )
    if obj is None:
        return invalid_result("validate_object_exists", f"Object with id {obj_id} not found")
    return valid_result()


async def validate_patch_applicable(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    if not tool_name.startswith("patch_"):
        return valid_result()

    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or new_text is None:
        return valid_result()

    if tool_name == "patch_basic_info":
        field = args.get("field")
        if not isinstance(field, str):
            return valid_result()
        basic = ctx.db.query(BasicInfo).filter(BasicInfo.project_id == ctx.run.project_id).first()
        if basic is None:
            return invalid_result("validate_patch_applicable", "No basic info found to patch")
        data = _latest_version_data(ctx.db, object_type="basic_info", object_id=basic.id, language=ctx.run.language)
        current = data.get(field)
        current_value = current if isinstance(current, str) else ""
        rr = apply_single_replacement(current_value, old_text, str(new_text))
        if not rr.success:
            return invalid_result(
                "validate_patch_applicable",
                f"Patch validation failed: [{field}] {rr.reason or rr.code or 'unknown'}",
            )
        return valid_result()

    object_type = _resolve_object_type(args, tool_name)
    obj_id = _parse_required_field(args, "id")
    if object_type is None or obj_id is None:
        return valid_result()

    try:
        object_uuid = UUID(obj_id)
    except (TypeError, ValueError):
        return valid_result()

    if object_type == "manuscript":
        if ctx.sidecar is None:
            return invalid_result("validate_patch_applicable", "SIDECAR_ERROR: sidecar client unavailable")

        data = _latest_version_data(ctx.db, object_type="manuscript", object_id=object_uuid, language=ctx.run.language)
        doc = data.get("doc")
        if not isinstance(doc, dict):
            return invalid_result("validate_patch_applicable", "MANUSCRIPT_EMPTY")

        try:
            markdown = await ctx.sidecar.doc_to_markdown(doc)
        except SidecarUnavailableError:
            return invalid_result("validate_patch_applicable", "SIDECAR_ERROR: unavailable")
        except SidecarConversionError as exc:
            return invalid_result("validate_patch_applicable", f"SIDECAR_ERROR: {exc}")

        rr = apply_single_replacement(markdown, old_text, str(new_text))
        if not rr.success:
            return invalid_result(
                "validate_patch_applicable",
                rr.code or rr.reason or "patch failed",
            )
        return valid_result()

    data = _latest_version_data(ctx.db, object_type=object_type, object_id=object_uuid, language=ctx.run.language)
    field = args.get("field")
    if not isinstance(field, str):
        return invalid_result("validate_patch_applicable", "Missing field for patch validation")

    current = data.get(field)
    current_value = current if isinstance(current, str) else ""
    rr = apply_single_replacement(current_value, old_text, str(new_text))
    if not rr.success:
        return invalid_result(
            "validate_patch_applicable",
            f"Patch validation failed: [{field}] {rr.reason or rr.code or 'unknown'}",
        )
    return valid_result()


async def validate_outline_parent_exists(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    if tool_name != "create_outline_act":
        return valid_result()

    outline_id = _parse_required_field(args, "outlineId")
    if outline_id is None:
        return invalid_result("validate_outline_parent_exists", "Missing outlineId for create_outline_act")

    try:
        outline_uuid = UUID(outline_id)
    except (TypeError, ValueError):
        return invalid_result("validate_outline_parent_exists", "Invalid outlineId format")

    outline = ctx.db.query(Outline).filter(Outline.id == outline_uuid, Outline.project_id == ctx.run.project_id).first()
    if outline is None:
        return invalid_result("validate_outline_parent_exists", f"Parent outline not found: {outline_id}")

    return valid_result()


async def validate_act_parent_exists(args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    if tool_name != "create_outline_chapter":
        return valid_result()

    act_id = _parse_required_field(args, "actId")
    if act_id is None:
        return invalid_result("validate_act_parent_exists", "Missing actId for create_outline_chapter")

    try:
        act_uuid = UUID(act_id)
    except (TypeError, ValueError):
        return invalid_result("validate_act_parent_exists", "Invalid actId format")

    act = (
        ctx.db.query(Act)
        .join(Outline, Outline.id == Act.outline_id)
        .filter(Act.id == act_uuid, Outline.project_id == ctx.run.project_id)
        .first()
    )
    if act is None:
        return invalid_result("validate_act_parent_exists", f"Parent act not found: {act_id}")

    return valid_result()


GLOBAL_VALIDATORS: list[Validator] = [
    validate_tool_schema,
    validate_tool_allowed_in_session,
    validate_sub_agent_call_input,
]


TOOL_VALIDATORS: dict[str, list[Validator]] = {
    "create_story_object": [validate_type_mapping],
    "delete_story_object": [validate_type_mapping, validate_required_id, validate_object_exists],
    "create_outline": [],
    "delete_outline": [validate_required_id, validate_object_exists],
    "create_outline_act": [validate_outline_parent_exists],
    "delete_outline_act": [validate_required_id, validate_object_exists],
    "create_outline_chapter": [validate_act_parent_exists],
    "delete_outline_chapter": [validate_required_id, validate_object_exists],
    "replace_basic_info": [],
    "replace_guidelines": [validate_required_id, validate_object_exists],
    "replace_story_object": [validate_type_mapping, validate_required_id, validate_object_exists],
    "replace_manuscript": [validate_required_id, validate_object_exists],
    "replace_outline": [validate_required_id, validate_object_exists],
    "replace_outline_act": [validate_required_id, validate_object_exists],
    "replace_outline_chapter": [validate_required_id, validate_object_exists],
    "patch_basic_info": [validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "patch_guidelines": [validate_required_id, validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "patch_story_object": [validate_type_mapping, validate_required_id, validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "patch_manuscript": [validate_required_id, validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "patch_outline": [validate_required_id, validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "patch_outline_act": [validate_required_id, validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "patch_outline_chapter": [validate_required_id, validate_patch_required_fields, validate_object_exists, validate_patch_applicable],
    "read_story_object": [validate_type_mapping, validate_required_id, validate_object_exists],
    "read_outline": [validate_required_id, validate_object_exists],
    "read_manuscript": [validate_required_id, validate_object_exists],
    "rag_search": [validate_rag_search_enabled],
    "keyword_search": [],
}


async def run_validator_chain(validators: list[Validator], args: dict[str, Any], tool_name: str, ctx: ValidationContext) -> ValidationResult:
    for validator in validators:
        maybe = validator(args, tool_name, ctx)
        result = await maybe if inspect.isawaitable(maybe) else maybe
        if not result.valid:
            return result
    return valid_result()
