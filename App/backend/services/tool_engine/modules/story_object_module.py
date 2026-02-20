from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolValidationContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import invalid_result, make_result, valid_result
from .common_object_helpers import (
    STORY_TYPE_MAP,
    extract_lang_data,
    obj_schema,
    patch_object_data,
    read_object,
    to_uuid,
)
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement


_ID = {"type": "string", "description": "Object ID"}
_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_STORY_TYPE = {
    "type": "string",
    "enum": ["character", "location", "organization", "lorebook"],
    "description": "Story object type",
}


def _validate_story_type(value: Any, validator_name: str):
    if isinstance(value, str) and value in STORY_TYPE_MAP:
        return valid_result()
    return invalid_result(validator_name, f"Unknown story object type: {value}")


def _validate_story_object_exists(args: dict[str, Any], ctx: ToolValidationContext):
    object_type = args.get("type")
    valid = _validate_story_type(object_type, "validate_story_object_exists")
    if not valid.valid:
        return valid

    try:
        object_id = to_uuid(args.get("id"), "id")
    except ValueError as exc:
        return invalid_result("validate_story_object_exists", str(exc))

    obj = object_service.get_object(
        ctx.db,
        object_type=str(object_type),
        object_id=object_id,
        project_id=ctx.project_id,
        language=ctx.language,
    )
    if obj is None:
        return invalid_result("validate_story_object_exists", f"{object_type} not found: {object_id}")
    return valid_result()


def _validate_patch_story_object(args: dict[str, Any], ctx: ToolValidationContext):
    field = args.get("field")
    if field not in {"name", "description", "content"}:
        return invalid_result("validate_patch_story_object", "field must be one of name|description|content")

    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or not isinstance(new_text, str):
        return invalid_result("validate_patch_story_object", "old and new must be string")

    exists = _validate_story_object_exists(args, ctx)
    if not exists.valid:
        return exists

    object_type = str(args.get("type"))
    object_id = to_uuid(args.get("id"), "id")
    obj = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    rr = apply_single_replacement(str(lang_data.get(str(field)) or ""), old_text, new_text)
    if not rr.success:
        return invalid_result("validate_patch_story_object", rr.reason or rr.code or "Patch failed")

    return valid_result()


def _validate_read_story_object(args: dict[str, Any], ctx: ToolValidationContext):
    object_type = args.get("type")
    if object_type in {"basic_info", "guidelines"}:
        try:
            object_id = to_uuid(args.get("id"), "id")
        except ValueError as exc:
            return invalid_result("validate_read_story_object", str(exc))

        obj = object_service.get_object(
            ctx.db,
            object_type=str(object_type),
            object_id=object_id,
            project_id=ctx.project_id,
            language=ctx.language,
        )
        if obj is None:
            return invalid_result("validate_read_story_object", f"{object_type} not found: {object_id}")
        return valid_result()

    return _validate_story_object_exists(args, ctx)


async def _execute_create_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = str(args.get("type") or "")
    payload = {
        "name": str(args.get("name") or ""),
        "description": str(args.get("description") or ""),
        "content": str(args.get("content") or ""),
    }
    created = object_service.create_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        data=payload,
        language=ctx.language,
        user_request="tool:create_story_object",
        created_by=ctx.user_id,
    )
    return make_result(f"Created {object_type}", object_id=created["id"], object_type=object_type)


async def _execute_delete_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    object_type = str(args.get("type") or "")
    object_service.delete_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        user_id=ctx.user_id,
    )
    return make_result(f"Deleted {object_type}", object_id=str(object_id), object_type=object_type)


async def _execute_read_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = str(args.get("type") or "")
    object_id = to_uuid(args.get("id"), "id")
    obj = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    return make_result("Read successful", object_id=str(object_id), object_type=object_type, data={"object": lang_data})


async def _execute_replace_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = str(args.get("type") or "")
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = dict(lang_data)
    for key in ["name", "description", "content"]:
        if key in args:
            next_data[key] = args[key]

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:replace_story_object",
        created_by=ctx.user_id,
    )
    return make_result(f"Replaced {object_type}", object_id=str(object_id), object_type=object_type)


async def _execute_patch_story_object(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = str(args.get("type") or "")
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:patch_story_object",
        created_by=ctx.user_id,
    )
    return make_result(f"Patched {object_type}", object_id=str(object_id), object_type=object_type)


def register(registry: ToolRegistry) -> None:
    registry.register_tool(
        ToolSpec(
            name="create_story_object",
            description="Create a story object.",
            parameters=obj_schema(
                {"type": _STORY_TYPE, "name": _NAME, "description": _DESC, "content": _CONTENT},
                ["type", "name", "content"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "storyObject"}),
            auto_approve_category="create",
            validators=(lambda args, ctx: _validate_story_type(args.get("type"), "validate_story_type"),),
            executor=_execute_create_story_object,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="delete_story_object",
            description="Delete a story object.",
            parameters=obj_schema({"id": _ID, "type": _STORY_TYPE}, ["id", "type"]),
            tool_sets=frozenset({"agent_agent_mode", "storyObject"}),
            auto_approve_category="delete",
            validators=(_validate_story_object_exists,),
            executor=_execute_delete_story_object,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="read_story_object",
            description="Read a story object.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "type": {"type": "string", "enum": ["character", "location", "organization", "lorebook", "guidelines", "basic_info"]},
                },
                ["id", "type"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category="read",
            validators=(_validate_read_story_object,),
            executor=_execute_read_story_object,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="replace_story_object",
            description="Replace story object fields.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "type": _STORY_TYPE,
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "content": {"type": "string"},
                },
                ["id", "type"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "storyObject", "objectTranslation"}),
            auto_approve_category="replace",
            validators=(_validate_story_object_exists,),
            executor=_execute_replace_story_object,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_story_object",
            description="Patch story object by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "type": _STORY_TYPE,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "type", "field", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "storyObject", "objectTranslation"}),
            auto_approve_category="patch",
            validators=(_validate_patch_story_object,),
            executor=_execute_patch_story_object,
        )
    )
