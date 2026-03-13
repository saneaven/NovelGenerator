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
    extract_lang_data,
    get_primary_object_id,
    read_object,
    require_story_object_type,
    to_uuid,
)
from .shared import filter_allowed_specs, is_translation_journey, obj_schema


_ID = {"type": "string", "description": "Object ID"}


@tool_call_module(prefix="translate_")
class TranslateToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("translate",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not is_translation_journey(ctx):
            return []
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name="translate_story_object",
                    description="Translate story object fields.",
                    parameters=obj_schema(
                        {"id": _ID, "type": {"type": "string", "enum": list(STORY_OBJECT_TYPES)}, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}},
                        ["id", "type"],
                    ),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_basic_info",
                    description="Translate project basic info.",
                    parameters=obj_schema(
                        {
                            "title": {"type": "string"},
                            "logline": {"type": "string"},
                            "genres": {"type": "array", "items": {"type": "string"}},
                            "tags": {"type": "array", "items": {"type": "string"}},
                        },
                        [],
                    ),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_guidelines",
                    description="Translate guidelines.",
                    parameters=obj_schema({"authorNote": {"type": "string"}}, ["authorNote"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_outline",
                    description="Translate outline fields.",
                    parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_outline_act",
                    description="Translate act fields.",
                    parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_outline_chapter",
                    description="Translate chapter fields.",
                    parameters=obj_schema({"id": _ID, "name": {"type": "string"}, "description": {"type": "string"}, "content": {"type": "string"}}, ["id"]),
                    auto_approve_category="translate",
                ),
                ToolSpec(
                    name="translate_manuscript",
                    description="Translate full manuscript content.",
                    parameters=obj_schema({"id": _ID, "content": {"type": "string"}}, ["id", "content"]),
                    auto_approve_category="translate",
                ),
            ],
        )

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            if tool_name == "translate_basic_info":
                get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
                return valid_result()
            if tool_name == "translate_guidelines":
                get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
                return valid_result()
            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "translate_story_object":
                object_type = require_story_object_type(args.get("type"))
            elif tool_name == "translate_outline":
                object_type = "outline"
            elif tool_name == "translate_outline_act":
                object_type = "act"
            elif tool_name == "translate_outline_chapter":
                object_type = "chapter"
            elif tool_name == "translate_manuscript":
                ensure_manuscript_exists(db=ctx.db, project_id=ctx.project_id, object_id=object_id, language=ctx.language)
                return valid_result()
            else:
                return invalid_result("validate_translate_tool_name", f"Unsupported translate tool: {tool_name}")
            read_object(ctx.db, project_id=ctx.project_id, object_type=object_type, object_id=object_id, language=ctx.language)
            return valid_result()
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if tool_name == "translate_basic_info":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "basic_info")
            current = read_object(ctx.db, project_id=ctx.project_id, object_type="basic_info", object_id=object_id, language=ctx.language)
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
                user_request="tool:translate_basic_info",
                created_by=ctx.user_id,
                create_new_version=False,
            )
            return make_result("Translated basic_info", object_id=str(object_id), object_type="basic_info")

        if tool_name == "translate_guidelines":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
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
                user_request="tool:translate_guidelines",
                created_by=ctx.user_id,
                create_new_version=False,
            )
            return make_result("Translated guidelines", object_id=str(object_id), object_type="guidelines")

        object_id = to_uuid(args.get("id"), "id")

        if tool_name == "translate_story_object":
            object_type = require_story_object_type(args.get("type"))
        elif tool_name == "translate_outline":
            object_type = "outline"
        elif tool_name == "translate_outline_act":
            object_type = "act"
        elif tool_name == "translate_outline_chapter":
            object_type = "chapter"
        elif tool_name == "translate_manuscript":
            await replace_manuscript(
                args=args,
                ctx=ctx,
                object_id=object_id,
                user_request="tool:translate_manuscript",
                create_new_version=False,
            )
            return make_result("Translated manuscript", object_id=str(object_id), object_type="manuscript")
        else:
            raise ValueError(f"Unsupported translate tool: {tool_name}")

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
            user_request=f"tool:{tool_name}",
            created_by=ctx.user_id,
            create_new_version=False,
        )
        return make_result(f"Translated {object_type}", object_id=str(object_id), object_type=object_type)
