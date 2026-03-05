from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolValidationContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import invalid_result, make_result, valid_result
from .common_object_helpers import (
    extract_lang_data,
    latest_version_data,
    obj_schema,
    patch_object_data,
    read_object,
    to_uuid,
)
from ....models.db_models import Act, Outline
from ....services.object_service import object_service
from ....services.patch_utils import apply_single_replacement


_ID = {"type": "string", "description": "Object ID"}
_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}


def _resolve_outline_object_type(tool_name: str, args: dict[str, Any]) -> str | None:
    if tool_name in {"delete_outline", "replace_outline", "patch_outline"}:
        return "outline"
    if tool_name in {"delete_outline_act", "replace_outline_act", "patch_outline_act"}:
        return "act"
    if tool_name in {"delete_outline_chapter", "replace_outline_chapter", "patch_outline_chapter"}:
        return "chapter"
    if tool_name == "read_outline":
        raw = args.get("type")
        if raw in {"outline", "act", "chapter"}:
            return str(raw)
        return "outline"
    return None


def _validate_positive_order(args: dict[str, Any], validator_name: str):
    if "order" not in args:
        return valid_result()
    order = args.get("order")
    if isinstance(order, int) and order > 0:
        return valid_result()
    return invalid_result(validator_name, "order must be a positive integer")


def _make_exists_validator(tool_name: str):
    def _validator(args: dict[str, Any], ctx: ToolValidationContext):
        object_type = _resolve_outline_object_type(tool_name, args)
        if object_type is None:
            return valid_result()

        try:
            object_id = to_uuid(args.get("id"), "id")
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}_exists", str(exc))

        obj = object_service.get_object(
            ctx.db,
            object_type=object_type,
            object_id=object_id,
            project_id=ctx.project_id,
            language=ctx.language,
        )
        if obj is None:
            return invalid_result(f"validate_{tool_name}_exists", f"{object_type} not found: {object_id}")
        return valid_result()

    return _validator


def _validate_outline_parent_exists(args: dict[str, Any], ctx: ToolValidationContext):
    try:
        outline_id = to_uuid(args.get("outlineId"), "outlineId")
    except ValueError as exc:
        return invalid_result("validate_outline_parent_exists", str(exc))

    row = ctx.db.query(Outline).filter(Outline.id == outline_id, Outline.project_id == ctx.project_id).first()
    if row is None:
        return invalid_result("validate_outline_parent_exists", f"Parent outline not found: {outline_id}")
    return valid_result()


def _validate_act_parent_exists(args: dict[str, Any], ctx: ToolValidationContext):
    try:
        act_id = to_uuid(args.get("actId"), "actId")
    except ValueError as exc:
        return invalid_result("validate_act_parent_exists", str(exc))

    row = (
        ctx.db.query(Act)
        .join(Outline, Outline.id == Act.outline_id)
        .filter(Act.id == act_id, Outline.project_id == ctx.project_id)
        .first()
    )
    if row is None:
        return invalid_result("validate_act_parent_exists", f"Parent act not found: {act_id}")
    return valid_result()


def _validate_chapter_act_id_if_present(args: dict[str, Any], ctx: ToolValidationContext):
    if "actId" not in args:
        return valid_result()
    return _validate_act_parent_exists({"actId": args.get("actId")}, ctx)


def _make_patch_validator(tool_name: str, field_values: set[str]):
    def _validator(args: dict[str, Any], ctx: ToolValidationContext):
        field = args.get("field")
        if field not in field_values:
            return invalid_result(f"validate_{tool_name}", f"field must be one of {', '.join(sorted(field_values))}")

        old_text = args.get("old")
        new_text = args.get("new")
        if not isinstance(old_text, str) or not isinstance(new_text, str):
            return invalid_result(f"validate_{tool_name}", "old and new must be string")

        exists = _make_exists_validator(tool_name)(args, ctx)
        if not exists.valid:
            return exists

        object_type = _resolve_outline_object_type(tool_name, args)
        if object_type is None:
            return valid_result()

        object_id = to_uuid(args.get("id"), "id")
        data = latest_version_data(ctx.db, object_type=object_type, object_id=object_id, language=ctx.language)
        current_value = str(data.get(str(field)) or "")
        rr = apply_single_replacement(current_value, old_text, new_text)
        if not rr.success:
            return invalid_result(f"validate_{tool_name}", rr.reason or rr.code or "Patch failed")

        if tool_name in {"patch_outline_act", "patch_outline_chapter"}:
            order_validation = _validate_positive_order(args, f"validate_{tool_name}_order")
            if not order_validation.valid:
                return order_validation
        if tool_name == "patch_outline_chapter":
            act_validation = _validate_chapter_act_id_if_present(args, ctx)
            if not act_validation.valid:
                return act_validation

        return valid_result()

    return _validator


async def _execute_create_outline(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    payload = {
        "name": str(args.get("name") or ""),
        "description": str(args.get("description") or ""),
        "content": str(args.get("content") or ""),
    }
    created = object_service.create_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="outline",
        data=payload,
        language=ctx.language,
        user_request="tool:create_outline",
        created_by=ctx.user_id,
    )
    return make_result("Created outline", object_id=created["id"], object_type="outline")


async def _execute_create_outline_act(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    payload = {
        "name": str(args.get("name") or ""),
        "description": str(args.get("description") or ""),
        "content": str(args.get("content") or ""),
    }
    created = object_service.create_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="act",
        data=payload,
        language=ctx.language,
        metadata={"outline_id": str(args.get("outlineId") or "")},
        user_request="tool:create_outline_act",
        created_by=ctx.user_id,
    )
    return make_result("Created act", object_id=created["id"], object_type="act")


async def _execute_create_outline_chapter(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    payload = {
        "name": str(args.get("name") or ""),
        "description": str(args.get("description") or ""),
        "content": str(args.get("content") or ""),
    }
    created = object_service.create_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="chapter",
        data=payload,
        language=ctx.language,
        metadata={"act_id": str(args.get("actId") or "")},
        user_request="tool:create_outline_chapter",
        created_by=ctx.user_id,
    )
    manuscript_id = created.get("metadata", {}).get("manuscript_id")
    return make_result(
        "Created chapter",
        object_id=created["id"],
        object_type="chapter",
        data={"manuscriptId": manuscript_id},
    )


async def _execute_delete_outline(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    object_service.delete_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="outline",
        object_id=object_id,
        user_id=ctx.user_id,
    )
    return make_result("Deleted outline", object_id=str(object_id), object_type="outline")


async def _execute_delete_outline_act(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    object_service.delete_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="act",
        object_id=object_id,
        user_id=ctx.user_id,
    )
    return make_result("Deleted act", object_id=str(object_id), object_type="act")


async def _execute_delete_outline_chapter(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_id = to_uuid(args.get("id"), "id")
    object_service.delete_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type="chapter",
        object_id=object_id,
        user_id=ctx.user_id,
    )
    return make_result("Deleted chapter", object_id=str(object_id), object_type="chapter")


async def _execute_read_outline(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type = _resolve_outline_object_type("read_outline", args) or "outline"
    object_id = to_uuid(args.get("id"), "id")
    obj = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(obj, ctx.language)
    return make_result("Read successful", object_id=str(object_id), object_type=object_type, data={"object": lang_data})


def _prepare_outline_replace_or_patch(
    *,
    tool_name: str,
    args: dict[str, Any],
    ctx: ToolExecutionContext,
) -> tuple[str, Any, dict[str, Any], dict[str, Any], dict[str, Any]]:
    object_type = _resolve_outline_object_type(tool_name, args)
    if object_type is None:
        raise ValueError(f"Unsupported outline tool: {tool_name}")

    object_id = to_uuid(args.get("id"), "id")
    current = read_object(ctx.db, ctx.project_id, object_type, object_id, ctx.language)
    lang_data = extract_lang_data(current, ctx.language)

    metadata: dict[str, Any] = {}
    if object_type in {"act", "chapter"} and isinstance(args.get("order"), int):
        metadata["order"] = int(args["order"])
    if object_type == "chapter" and isinstance(args.get("actId"), str) and args.get("actId"):
        metadata["act_id"] = args["actId"]

    return object_type, object_id, current, lang_data, metadata


async def _execute_replace_outline(tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type, object_id, _, lang_data, metadata = _prepare_outline_replace_or_patch(
        tool_name=tool_name,
        args=args,
        ctx=ctx,
    )

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
        metadata=metadata or None,
        user_request=f"tool:{tool_name}",
        created_by=ctx.user_id,
        create_new_version=True,
    )
    return make_result(f"Replaced {object_type}", object_id=str(object_id), object_type=object_type)


async def _execute_patch_outline(tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    object_type, object_id, _, lang_data, metadata = _prepare_outline_replace_or_patch(
        tool_name=tool_name,
        args=args,
        ctx=ctx,
    )

    next_data = patch_object_data(lang_data, args)

    object_service.update_object(
        ctx.db,
        project_id=ctx.project_id,
        object_type=object_type,
        object_id=object_id,
        data=next_data,
        language=ctx.language,
        metadata=metadata or None,
        user_request=f"tool:{tool_name}",
        created_by=ctx.user_id,
        create_new_version=True,
    )
    return make_result(f"Patched {object_type}", object_id=str(object_id), object_type=object_type)


async def _execute_replace_outline_root(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    return await _execute_replace_outline("replace_outline", args, ctx)


async def _execute_replace_outline_act(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    return await _execute_replace_outline("replace_outline_act", args, ctx)


async def _execute_replace_outline_chapter(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    return await _execute_replace_outline("replace_outline_chapter", args, ctx)


async def _execute_patch_outline_root(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    return await _execute_patch_outline("patch_outline", args, ctx)


async def _execute_patch_outline_act(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    return await _execute_patch_outline("patch_outline_act", args, ctx)


async def _execute_patch_outline_chapter(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    return await _execute_patch_outline("patch_outline_chapter", args, ctx)


def register(registry: ToolRegistry) -> None:
    registry.register_tool(
        ToolSpec(
            name="create_outline",
            description="Create an outline.",
            parameters=obj_schema({"name": _NAME, "description": _DESC, "content": _CONTENT}, ["name", "content"]),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="create",
            validators=(),
            executor=_execute_create_outline,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="delete_outline",
            description="Delete an outline.",
            parameters=obj_schema({"id": _ID}, ["id"]),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="delete",
            validators=(_make_exists_validator("delete_outline"),),
            executor=_execute_delete_outline,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="create_outline_act",
            description="Create an act in outline.",
            parameters=obj_schema(
                {"outlineId": {"type": "string"}, "name": _NAME, "description": _DESC, "content": _CONTENT},
                ["outlineId", "name", "content"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="create",
            validators=(_validate_outline_parent_exists,),
            executor=_execute_create_outline_act,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="delete_outline_act",
            description="Delete an act.",
            parameters=obj_schema({"id": _ID}, ["id"]),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="delete",
            validators=(_make_exists_validator("delete_outline_act"),),
            executor=_execute_delete_outline_act,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="create_outline_chapter",
            description="Create a chapter in act.",
            parameters=obj_schema(
                {"actId": {"type": "string"}, "name": _NAME, "description": _DESC, "content": _CONTENT},
                ["actId", "name", "content"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="create",
            validators=(_validate_act_parent_exists,),
            executor=_execute_create_outline_chapter,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="delete_outline_chapter",
            description="Delete a chapter.",
            parameters=obj_schema({"id": _ID}, ["id"]),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="delete",
            validators=(_make_exists_validator("delete_outline_chapter"),),
            executor=_execute_delete_outline_chapter,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="read_outline",
            description="Read an outline object.",
            parameters=obj_schema({"id": _ID, "type": {"type": "string", "enum": ["outline", "act", "chapter"]}}, ["id", "type"]),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category="read",
            validators=(_make_exists_validator("read_outline"),),
            executor=_execute_read_outline,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="replace_outline",
            description="Replace outline fields.",
            parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="replace",
            validators=(_make_exists_validator("replace_outline"),),
            executor=_execute_replace_outline_root,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="replace_outline_act",
            description="Replace act fields.",
            parameters=obj_schema(
                {"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}, "order": {"type": "integer"}},
                ["id"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="replace",
            validators=(_make_exists_validator("replace_outline_act"), lambda args, ctx: _validate_positive_order(args, "validate_replace_outline_act_order")),
            executor=_execute_replace_outline_act,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="replace_outline_chapter",
            description="Replace chapter fields.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "actId": {"type": "string"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "content": {"type": "string"},
                    "order": {"type": "integer"},
                },
                ["id"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="replace",
            validators=(
                _make_exists_validator("replace_outline_chapter"),
                lambda args, ctx: _validate_positive_order(args, "validate_replace_outline_chapter_order"),
                _validate_chapter_act_id_if_present,
            ),
            executor=_execute_replace_outline_chapter,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_outline",
            description="Patch outline by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="patch",
            validators=(_make_patch_validator("patch_outline", {"name", "description", "content"}),),
            executor=_execute_patch_outline_root,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_outline_act",
            description="Patch act by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                    "order": {"type": "integer"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="patch",
            validators=(_make_patch_validator("patch_outline_act", {"name", "description", "content"}),),
            executor=_execute_patch_outline_act,
        )
    )

    registry.register_tool(
        ToolSpec(
            name="patch_outline_chapter",
            description="Patch chapter by single replacement.",
            parameters=obj_schema(
                {
                    "id": _ID,
                    "field": {"type": "string", "enum": ["name", "description", "content"]},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                    "actId": {"type": "string"},
                    "order": {"type": "integer"},
                },
                ["id", "field", "old", "new"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "outline"}),
            auto_approve_category="patch",
            validators=(_make_patch_validator("patch_outline_chapter", {"name", "description", "content"}),),
            executor=_execute_patch_outline_chapter,
        )
    )
