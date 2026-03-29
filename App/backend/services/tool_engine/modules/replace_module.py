from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from ....utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE
from .manuscript_access import ensure_manuscript_exists, replace_manuscript
from .object_access import (
    ensure_outline_parent_kind,
    ensure_story_entity_folder_exists,
    extract_lang_data,
    get_primary_object_id,
    read_object,
    read_story_entity_folder,
    read_story_entity,
    to_uuid,
)
from .shared import (
    filter_allowed_specs,
    is_agent_write_context,
    is_manuscript_journey,
    is_object_journey,
    is_outline_journey,
    obj_schema,
)


_ID = {"type": "string", "description": "Object ID"}
_FOLDER_ID = {"type": ["string", "null"], "description": "Parent folder ID. Use null for root."}
_PARENT_ID = {"type": ["string", "null"], "description": "Parent outline ID. Root outlines use null."}
_POSITION = {"type": "integer", "description": "0-based sibling position."}


def _non_negative_position(value: Any) -> None:
    if value is None:
        return
    if isinstance(value, int) and value >= 0:
        return
    raise ValueError("position must be a non-negative integer")


def _has_any_story_entity_folder_replace_field(args: dict[str, Any]) -> bool:
    return any(key in args for key in ("name", "description", "parentId", "position"))


@tool_call_module(prefix="replace_")
class ReplaceToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("replace",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not (
            is_agent_write_context(ctx)
            or is_object_journey(ctx)
            or is_outline_journey(ctx)
            or is_manuscript_journey(ctx)
        ):
            return []

        specs: list[ToolSpec] = []
        if is_agent_write_context(ctx) or is_object_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="replace_story_entity",
                        description="Replace story entity fields.",
                        parameters=obj_schema(
                            {
                                "id": _ID,
                                "kind": {"type": "string", "enum": ["character", "location", "organization", "lorebook"]},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "content": {"type": "string"},
                                "folderId": _FOLDER_ID,
                            },
                            ["id", "kind"],
                        ),
                        auto_approve_category="replace",
                    ),
                    ToolSpec(
                        name="replace_story_entity_folder",
                        description="Replace story entity folder fields.",
                        parameters=obj_schema(
                            {
                                "id": _ID,
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "parentId": _FOLDER_ID,
                                "position": _POSITION,
                            },
                            ["id"],
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
                        parameters=obj_schema({"authorNote": {"type": "string"}}, ["authorNote"]),
                        auto_approve_category="replace",
                    ),
                ]
            )

        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="replace_outline",
                        description="Replace outline item fields.",
                        parameters=obj_schema(
                            {
                                "id": _ID,
                                "parentId": _PARENT_ID,
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "content": {"type": "string"},
                                "position": _POSITION,
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

            if tool_name == "replace_guidelines":
                get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
                return valid_result()

            object_id = to_uuid(args.get("id"), "id")
            if tool_name == "replace_story_entity":
                read_story_entity(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                    kind=args.get("kind"),
                    rich_text_format="markdown",
                )
                ensure_story_entity_folder_exists(
                    ctx.db,
                    project_id=ctx.project_id,
                    folder_id=args.get("folderId"),
                )
                return valid_result()
            elif tool_name == "replace_story_entity_folder":
                if not _has_any_story_entity_folder_replace_field(args):
                    raise ValueError("replace_story_entity_folder requires at least one of name, description, parentId, or position")
                _non_negative_position(args.get("position"))
                read_story_entity_folder(
                    ctx.db,
                    project_id=ctx.project_id,
                    object_id=object_id,
                    language=ctx.language,
                )
                ensure_story_entity_folder_exists(
                    ctx.db,
                    project_id=ctx.project_id,
                    folder_id=args.get("parentId"),
                    field_name="parentId",
                )
                return valid_result()
            elif tool_name == "replace_outline":
                object_type = "outline"
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

            if tool_name == "replace_outline":
                _non_negative_position(args.get("position"))
                if args.get("parentId"):
                    current = read_object(
                        ctx.db,
                        project_id=ctx.project_id,
                        object_type="outline",
                        object_id=object_id,
                        language=ctx.language,
                        rich_text_format="markdown",
                    )
                    current_kind = str(current.get("kind") or "")
                    if current_kind == "act":
                        ensure_outline_parent_kind(
                            ctx.db,
                            project_id=ctx.project_id,
                            outline_id=to_uuid(args.get("parentId"), "parentId"),
                            expected_kind="outline",
                        )
                    elif current_kind == "chapter":
                        ensure_outline_parent_kind(
                            ctx.db,
                            project_id=ctx.project_id,
                            outline_id=to_uuid(args.get("parentId"), "parentId"),
                            expected_kind="act",
                        )

            read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                language=ctx.language,
                rich_text_format="markdown",
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

        if tool_name == "replace_guidelines":
            object_id = get_primary_object_id(ctx.db, ctx.project_id, "guidelines")
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="guidelines",
                object_id=object_id,
                language=ctx.language,
                rich_text_format="markdown",
            )
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
                rich_text_format="markdown",
                user_request="tool:replace_guidelines",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result("Replaced guidelines", object_id=str(object_id), object_type="guidelines")

        object_id = to_uuid(args.get("id"), "id")

        if tool_name == "replace_story_entity":
            kind = str(args.get("kind") or "")
            object_type = STORY_ENTITY_TYPE
            metadata = {"folder_id": args.get("folderId")} if "folderId" in args else None
            current = read_story_entity(
                ctx.db,
                project_id=ctx.project_id,
                object_id=object_id,
                language=ctx.language,
                kind=kind,
                rich_text_format="markdown",
            )
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
                rich_text_format="markdown",
                metadata=metadata,
                kind=kind,
                user_request="tool:replace_story_entity",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result(
                f"Replaced {kind}",
                object_id=str(object_id),
                object_type=object_type,
                data={"kind": kind},
            )

        if tool_name == "replace_story_entity_folder":
            object_type = STORY_ENTITY_FOLDER_TYPE
            current = read_story_entity_folder(
                ctx.db,
                project_id=ctx.project_id,
                object_id=object_id,
                language=ctx.language,
            )
            content_fields_present = any(key in args for key in ("name", "description"))
            next_data = dict(extract_lang_data(current, ctx.language)) if content_fields_present else {}
            for key in ("name", "description"):
                if key in args:
                    next_data[key] = args[key]
            metadata: dict[str, Any] = {}
            if isinstance(args.get("position"), int):
                metadata["display_order"] = int(args["position"])
            if "parentId" in args:
                metadata["parent_id"] = args.get("parentId")
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                metadata=metadata or None,
                user_request="tool:replace_story_entity_folder",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result(
                "Replaced story entity folder",
                object_id=str(object_id),
                object_type=object_type,
            )

        if tool_name == "replace_outline":
            object_type = "outline"
            current = read_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                language=ctx.language,
                rich_text_format="markdown",
            )
            next_data = dict(extract_lang_data(current, ctx.language))
            for key in ["name", "description", "content"]:
                if key in args:
                    next_data[key] = args[key]
            metadata: dict[str, Any] = {}
            if isinstance(args.get("position"), int):
                metadata["position"] = int(args["position"])
            if "parentId" in args:
                metadata["parent_id"] = args.get("parentId")
            object_service.update_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=object_type,
                object_id=object_id,
                data=next_data,
                language=ctx.language,
                rich_text_format="markdown",
                metadata=metadata or None,
                user_request=f"tool:{tool_name}",
                created_by=ctx.user_id,
                create_new_version=True,
            )
            return make_result(
                "Replaced outline",
                object_id=str(object_id),
                object_type=object_type,
                data={"kind": current.get("kind")},
            )

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
