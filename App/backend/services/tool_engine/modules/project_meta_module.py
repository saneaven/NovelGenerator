from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolValidationContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import invalid_result, make_result, valid_result
from .common_object_helpers import (
    extract_lang_data,
    get_primary_object_id,
    obj_schema,
    patch_object_data,
    read_object,
    to_uuid,
)
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement


_ID = {"type": "string", "description": "Object ID"}


def _validate_basic_info_exists(args: dict[str, Any], ctx: ToolValidationContext):
    _ = args
    rows = object_service.list_objects(ctx.db, project_id=ctx.project_id, object_type="basic_info")
    if not rows:
        return invalid_result("validate_basic_info_exists", "No basic info found in project")
    return valid_result()


def _validate_guidelines_exists(args: dict[str, Any], ctx: ToolValidationContext):
    raw_id = args.get("id")
    try:
        object_id = to_uuid(raw_id, "id")
    except ValueError as exc:
        return invalid_result("validate_guidelines_exists", str(exc))

    obj = object_service.get_object(
        ctx.db,
        object_type="guidelines",
        object_id=object_id,
        project_id=ctx.project_id,
        language=ctx.language,
    )
    if obj is None:
        return invalid_result("validate_guidelines_exists", f"guidelines not found: {object_id}")
    return valid_result()


def _validate_patch_basic_info(args: dict[str, Any], ctx: ToolValidationContext):
    field = args.get("field")
    if field not in {"title", "logline", "genre"}:
        return invalid_result("validate_patch_basic_info", "field must be one of title|logline|genre")

    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or not isinstance(new_text, str):
        return invalid_result("validate_patch_basic_info", "old and new must be string")

    rows = object_service.list_objects(ctx.db, project_id=ctx.project_id, object_type="basic_info")
    if not rows:
        return invalid_result("validate_patch_basic_info", "No basic info found in project")

    try:
        object_id = to_uuid(rows[0]["id"], "id")
    except ValueError as exc:
        return invalid_result("validate_patch_basic_info", str(exc))

    obj = read_object(ctx.db, ctx.project_id, "basic_info", object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    current_value = str(lang_data.get(field) or "")
    rr = apply_single_replacement(current_value, old_text, new_text)
    if not rr.success:
        return invalid_result("validate_patch_basic_info", rr.reason or rr.code or "Patch failed")

    return valid_result()


def _validate_patch_guidelines(args: dict[str, Any], ctx: ToolValidationContext):
    field = args.get("field")
    if field != "authorNote":
        return invalid_result("validate_patch_guidelines", "field must be authorNote")

    old_text = args.get("old")
    new_text = args.get("new")
    if not isinstance(old_text, str) or not isinstance(new_text, str):
        return invalid_result("validate_patch_guidelines", "old and new must be string")

    raw_id = args.get("id")
    try:
        object_id = to_uuid(raw_id, "id")
    except ValueError as exc:
        return invalid_result("validate_patch_guidelines", str(exc))

    obj = object_service.get_object(
        ctx.db,
        object_type="guidelines",
        object_id=object_id,
        project_id=ctx.project_id,
        language=ctx.language,
    )
    if obj is None:
        return invalid_result("validate_patch_guidelines", f"guidelines not found: {object_id}")

    lang_data = extract_lang_data(obj, ctx.language)
    rr = apply_single_replacement(str(lang_data.get("authorNote") or ""), old_text, new_text)
    if not rr.success:
        return invalid_result("validate_patch_guidelines", rr.reason or rr.code or "Patch failed")

    return valid_result()


async def _execute_replace_basic_info(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
    current = read_object(ctx.db, ctx.project_id, "basic_info", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = dict(lang_data)
    for key in ["title", "logline", "genre"]:
        if key in args:
            next_data[key] = args[key]

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="basic_info",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:replace_basic_info",
        created_by=ctx.user_id,
    )
    return make_result("Replaced basic_info", object_id=str(object_id), object_type="basic_info")


async def _execute_patch_basic_info(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
    current = read_object(ctx.db, ctx.project_id, "basic_info", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="basic_info",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:patch_basic_info",
        created_by=ctx.user_id,
    )
    return make_result("Patched basic_info", object_id=str(object_id), object_type="basic_info")


async def _execute_replace_guidelines(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, "guidelines", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = dict(lang_data)
    if "authorNote" in args:
        next_data["authorNote"] = args.get("authorNote")

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="guidelines",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:replace_guidelines",
        created_by=ctx.user_id,
    )
    return make_result("Replaced guidelines", object_id=str(object_id), object_type="guidelines")


async def _execute_patch_guidelines(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, "guidelines", object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="guidelines",
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        user_request="tool:patch_guidelines",
        created_by=ctx.user_id,
    )
    return make_result("Patched guidelines", object_id=str(object_id), object_type="guidelines")


def register(registry: ToolRegistry) -> None:
    registry.register_tool(
        ToolSpec(
            name="replace_basic_info",
            description="Replace project basic info.",
            parameters=obj_schema(
                {"title": {"type": "string"}, "logline": {"type": "string"}, "genre": {"type": "string"}},
                [],
            ),
            tool_sets=frozenset({"agent_agent_mode", "storyObject", "objectTranslation"}),
            auto_approve_category="replace",
            validators=(_validate_basic_info_exists,),
            executor=_execute_replace_basic_info,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_basic_info",
            description="Patch basic info by single replacement.",
            parameters=obj_schema(
                {
                    "field": {"type": "string", "enum": ["title", "logline", "genre"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["field", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "storyObject", "objectTranslation"}),
            auto_approve_category="patch",
            validators=(_validate_patch_basic_info,),
            executor=_execute_patch_basic_info,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="replace_guidelines",
            description="Replace guidelines.",
            parameters=obj_schema({"id": _ID, "authorNote": {"type": "string"}}, ["id", "authorNote"]),
            tool_sets=frozenset({"agent_agent_mode", "storyObject", "objectTranslation"}),
            auto_approve_category="replace",
            validators=(_validate_guidelines_exists,),
            executor=_execute_replace_guidelines,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_guidelines",
            description="Patch guidelines by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["authorNote"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "storyObject", "objectTranslation"}),
            auto_approve_category="patch",
            validators=(_validate_patch_guidelines,),
            executor=_execute_patch_guidelines,
        )
    )
