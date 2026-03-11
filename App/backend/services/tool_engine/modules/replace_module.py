from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from .manuscript_access import ensure_manuscript_exists, replace_manuscript
from .object_access import (
    STORY_OBJECT_TYPES,
    ensure_act_parent_exists,
    extract_lang_data,
    get_primary_object_id,
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


def _positive_order(value: Any) -> None:
    if value is None:
        return
    if isinstance(value, int) and value > 0:
        return
    raise ValueError("order must be a positive integer")


@tool_call_module(prefix="replace_")
class ReplaceToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("replace",)

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
                        name="replace_story_object",
                        description="Replace story object fields.",
                        parameters=obj_schema(
                            {
                                "id": _ID,
                                "type": {"type": "string", "enum": list(STORY_OBJECT_TYPES)},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "content": {"type": "string"},
                            },
                            ["id", "type"],
                        ),
                        auto_approve_category="replace",
                    ),
                    ToolSpec(
                        name="replace_basic_info",
                        description="Replace project basic info.",
                        parameters=obj_schema(
                            {
                                "title": {"type": "string"},
                                "logline": {"type": "string"},
                                "genres": {"type": "array", "items": {"type": "string"}},
                                "tags": {"type": "array", "items": {"type": "string"}},
                            },
                            [],
                        ),
                        auto_approve_category="replace",
                    ),
                    ToolSpec(
                        name="replace_guidelines",
                        description="Replace guidelines.",
                        parameters=obj_schema({"id": _ID, "authorNote": {"type": "string"}}, ["id", "authorNote"]),
                        auto_approve_category="replace",
                    ),
                ]
            )

        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="replace_outline",
                        description="Replace outline fields.",
                        parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
                        auto_approve_category="replace",
                    ),
                    ToolSpec(
                        name="replace_outline_act",
                        description="Replace act fields.",
                        parameters=obj_schema(
                            {"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}, "order": {"type": "integer"}},
                            ["id"],
                        ),
                        auto_approve_category="replace",
                    ),
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
                        auto_approve_category="replace",
                    ),
                ]
            )

        if is_agent_write_context(ctx) or is_manuscript_journey(ctx):
            specs.append(
                ToolSpec(
                    name="replace_manuscript",
                    description="Replace full manuscript content.",
                    parameters=obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
                    auto_approve_category="replace",
                )
            )

        return filter_allowed_specs(ctx, specs)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            if tool_name == "replace_basic_info":
                get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
                return valid_result()

            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "replace_story_object":
                object_type = require_story_object_type(args.get("type"))
            elif tool_name == "replace_guidelines":
                object_type = "guidelines"
            elif tool_name == "replace_outline":
                object_type = "outline"
            elif tool_name == "replace_outline_act":
                object_type = "act"
                _positive_order(args.get("order"))
            elif tool_name == "replace_outline_chapter":
                object_type = "chapter"
                _positive_order(args.get("order"))
                if args.get("actId"):
                    ensure_act_parent_exists(
                        ctx.db,
                        project_id=ctx.project_id,
                        act_id=to_uuid(args.get("actId"), "actId"),
                    )
            elif tool_name == "replace_manuscript":
                ensure_manuscript_exists(
                    db=ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                )
                return valid_result()
            else:
                return invalid_result("validate_replace_tool_name", f"Unsupported replace tool: {tool_name}")

            read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                language=ctx.language,
            )
            return valid_result()
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if tool_name == "replace_basic_info":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="basic_info",
                object_id=object_id,
                language=ctx.language,
            )
            next_data = dict(extract_lang_data(current, ctx.language))
            for key in ["title", "logline", "genres", "tags"]:
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
                create_new_version=True,
            )
            return make_result("Replaced basic_info", object_id=str(object_id), object_type="basic_info")

        object_id = to_uuid(args.get("id"), "id")

        if tool_name == "replace_story_object":
            object_type = require_story_object_type(args.get("type"))
            current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
            next_data = dict(extract_lang_data(current, ctx.language))
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
                create_new_version=True,
            )
            return make_result(f"Replaced {object_type}", object_id=str(object_id), object_type=object_type)

        if tool_name == "replace_guidelines":
            current = read_object(ctx.db, project_id=ctx.project_id, object_type="guidelines", object_id=object_id, language=ctx.language)
            next_data = dict(extract_lang_data(current, ctx.language))
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
                create_new_version=True,
            )
            return make_result("Replaced guidelines", object_id=str(object_id), object_type="guidelines")

        if tool_name in {"replace_outline", "replace_outline_act", "replace_outline_chapter"}:
            object_type = {
                "replace_outline": "outline",
                "replace_outline_act": "act",
                "replace_outline_chapter": "chapter",
            }[tool_name]
            current = read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
            next_data = dict(extract_lang_data(current, ctx.language))
            for key in ["name", "description", "content"]:
                if key in args:
                    next_data[key] = args[key]
            metadata: dict[str, Any] = {}
            if tool_name in {"replace_outline_act", "replace_outline_chapter"} and isinstance(args.get("order"), int):
                metadata["order"] = int(args["order"])
            if tool_name == "replace_outline_chapter" and isinstance(args.get("actId"), str) and args.get("actId"):
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
            return make_result(f"Replaced {object_type}", object_id=str(object_id), object_type=object_type)

        if tool_name == "replace_manuscript":
            await replace_manuscript(
                args=args,
                ctx=ctx,
                object_id=object_id,
                user_request="tool:replace_manuscript",
                create_new_version=True,
            )
            return make_result("Replaced manuscript", object_id=str(object_id), object_type="manuscript")

        raise ValueError(f"Unsupported replace tool: {tool_name}")
