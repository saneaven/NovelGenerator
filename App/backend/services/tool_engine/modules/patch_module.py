from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from .manuscript_access import patch_manuscript, validate_patch_args as validate_manuscript_patch, ensure_manuscript_exists
from .object_access import (
    ensure_act_parent_exists,
    extract_lang_data,
    get_primary_object_id,
    patch_object_field,
    read_object,
    require_story_object_type,
    to_uuid,
)
from .shared import (
    filter_allowed_specs,
    is_agent_write_context,
    is_manuscript_journey,
    is_outline_journey,
    is_story_object_journey,
    obj_schema,
)


_ID = {"type": "string", "description": "Object ID"}
_TEXT_PATCH = {"old": {"type": "string"}, "new": {"type": "string"}}


def _positive_order(value: Any) -> None:
    if value is None:
        return
    if isinstance(value, int) and value > 0:
        return
    raise ValueError("order must be a positive integer")


@tool_call_module(prefix="patch_")
class PatchToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("patch",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not (
            is_agent_write_context(ctx)
            or is_story_object_journey(ctx)
            or is_outline_journey(ctx)
            or is_manuscript_journey(ctx)
        ):
            return []

        specs: list[ToolSpec] = []
        if is_agent_write_context(ctx) or is_story_object_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="patch_story_object",
                        description="Patch story object by single replacement.",
                        parameters=obj_schema(
                            {"id": _ID, "type": {"type": "string", "enum": ["character", "location", "organization", "lorebook"]}, "field": {"type": "string", "enum": ["name", "description", "content"]}, **_TEXT_PATCH},
                            ["id", "type", "field", "old", "new"],
                        ),
                        auto_approve_category="patch",
                    ),
                    ToolSpec(
                        name="patch_basic_info",
                        description="Patch basic info by single replacement.",
                        parameters=obj_schema(
                            {"field": {"type": "string", "enum": ["title", "logline"]}, **_TEXT_PATCH},
                            ["field", "old", "new"],
                        ),
                        auto_approve_category="patch",
                    ),
                    ToolSpec(
                        name="patch_guidelines",
                        description="Patch guidelines by single replacement.",
                        parameters=obj_schema(
                            {"field": {"type": "string", "enum": ["authorNote"]}, **_TEXT_PATCH},
                            ["field", "old", "new"],
                        ),
                        auto_approve_category="patch",
                    ),
                ]
            )

        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="patch_outline",
                        description="Patch outline by single replacement.",
                        parameters=obj_schema({"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, **_TEXT_PATCH}, ["id", "field", "old", "new"]),
                        auto_approve_category="patch",
                    ),
                    ToolSpec(
                        name="patch_outline_act",
                        description="Patch act by single replacement.",
                        parameters=obj_schema({"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, "order": {"type": "integer"}, **_TEXT_PATCH}, ["id", "field", "old", "new"]),
                        auto_approve_category="patch",
                    ),
                    ToolSpec(
                        name="patch_outline_chapter",
                        description="Patch chapter by single replacement.",
                        parameters=obj_schema({"id": _ID, "field": {"type": "string", "enum": ["name", "description", "content"]}, "actId": {"type": "string"}, "order": {"type": "integer"}, **_TEXT_PATCH}, ["id", "field", "old", "new"]),
                        auto_approve_category="patch",
                    ),
                ]
            )

        if is_agent_write_context(ctx) or is_manuscript_journey(ctx):
            specs.append(
                ToolSpec(
                    name="patch_manuscript",
                    description="Patch manuscript by single replacement.",
                    parameters=obj_schema({"id": _ID, **_TEXT_PATCH}, ["id", "old", "new"]),
                    auto_approve_category="patch",
                )
            )

        return filter_allowed_specs(ctx, specs)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            if tool_name == "patch_basic_info":
                field = args.get("field")
                if field not in {"title", "logline"}:
                    raise ValueError("field must be one of title|logline")
                object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
                current = read_object(ctx.db, project_id=ctx.project_id, object_type="basic_info", object_id=object_id, language=ctx.language)
                patch_object_field(
                    extract_lang_data(current, ctx.language),
                    field=str(field),
                    old=str(args.get("old") or ""),
                    new=str(args.get("new") or ""),
                )
                return valid_result()

            if tool_name == "patch_guidelines":
                if args.get("field") != "authorNote":
                    raise ValueError("field must be authorNote")
                object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
                current = read_object(ctx.db, project_id=ctx.project_id, object_type="guidelines", object_id=object_id, language=ctx.language)
                patch_object_field(extract_lang_data(current, ctx.language), field="authorNote", old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()

            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "patch_story_object":
                field = args.get("field")
                if field not in {"name", "description", "content"}:
                    raise ValueError("field must be one of name|description|content")
                object_type = require_story_object_type(args.get("type"))
                current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
                patch_object_field(extract_lang_data(current, ctx.language), field=str(field), old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()

            if tool_name in {"patch_outline", "patch_outline_act", "patch_outline_chapter"}:
                field = args.get("field")
                if field not in {"name", "description", "content"}:
                    raise ValueError("field must be one of name|description|content")
                object_type = {
                    "patch_outline": "outline",
                    "patch_outline_act": "act",
                    "patch_outline_chapter": "chapter",
                }[tool_name]
                _positive_order(args.get("order"))
                if tool_name == "patch_outline_chapter" and args.get("actId"):
                    ensure_act_parent_exists(ctx.db, project_id=ctx.project_id, act_id=to_uuid(args.get("actId"), "actId"))
                current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
                patch_object_field(extract_lang_data(current, ctx.language), field=str(field), old=str(args.get("old") or ""), new=str(args.get("new") or ""))
                return valid_result()

            if tool_name == "patch_manuscript":
                ensure_manuscript_exists(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
                await validate_manuscript_patch(args=args, ctx=ctx, object_id=object_id)
                return valid_result()

            return invalid_result("validate_patch_tool_name", f"Unsupported patch tool: {tool_name}")
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if tool_name == "patch_basic_info":
            field = str(args.get("field") or "")
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            current = read_object(ctx.db, project_id=ctx.project_id, object_type="basic_info", object_id=object_id, language=ctx.language)
            next_data = patch_object_field(extract_lang_data(current, ctx.language), field=field, old=str(args.get("old") or ""), new=str(args.get("new") or ""))
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="basic_info",
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                user_request="tool:patch_basic_info",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result("Patched basic_info", object_id=str(object_id), object_type="basic_info")

        if tool_name == "patch_guidelines":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            current = read_object(ctx.db, project_id=ctx.project_id, object_type="guidelines", object_id=object_id, language=ctx.language)
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field="authorNote",
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="guidelines",
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                user_request="tool:patch_guidelines",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result("Patched guidelines", object_id=str(object_id), object_type="guidelines")

        object_id = to_uuid(args.get("id"), "id")

        if tool_name == "patch_story_object":
            object_type = require_story_object_type(args.get("type"))
            current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(args.get("field") or ""),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                user_request="tool:patch_story_object",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result(f"Patched {object_type}", object_id=str(object_id), object_type=object_type)

        if tool_name in {"patch_outline", "patch_outline_act", "patch_outline_chapter"}:
            object_type = {
                "patch_outline": "outline",
                "patch_outline_act": "act",
                "patch_outline_chapter": "chapter",
            }[tool_name]
            current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
            next_data = patch_object_field(
                extract_lang_data(current, ctx.language),
                field=str(args.get("field") or ""),
                old=str(args.get("old") or ""),
                new=str(args.get("new") or ""),
            )
            metadata: dict[str, Any] = {}
            if tool_name in {"patch_outline_act", "patch_outline_chapter"} and isinstance(args.get("order"), int):
                metadata["order"] = int(args["order"])
            if tool_name == "patch_outline_chapter" and isinstance(args.get("actId"), str) and args.get("actId"):
                metadata["act_id"] = args["actId"]
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

        if tool_name == "patch_manuscript":
            await patch_manuscript(
                args=args,
                ctx=ctx,
                object_id=object_id,
                user_request="tool:patch_manuscript",
                create_new_version=True,
            )
            return make_result("Patched manuscript", object_id=str(object_id), object_type="manuscript")

        raise ValueError(f"Unsupported patch tool: {tool_name}")
