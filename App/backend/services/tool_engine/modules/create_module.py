from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, make_result, valid_result
from ....services.object_service import object_service
from ....services.outline_service import require_outline_kind
from ....utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE
from .object_access import (
    ensure_outline_parent_kind,
    ensure_story_entity_folder_exists,
    require_story_entity_arg_kind,
    to_uuid,
)
from .shared import filter_allowed_specs, is_agent_write_context, is_outline_journey, is_object_journey, obj_schema


_NAME = {"type": "string", "description": "Name"}
_DESC = {"type": "string", "description": "Description"}
_CONTENT = {"type": "string", "description": "Content"}
_ENTITY_KIND = {"type": "string", "enum": ["character", "location", "organization", "lorebook"]}
_OUTLINE_KIND = {"type": "string", "enum": ["outline", "act", "chapter"]}
_FOLDER_ID = {"type": ["string", "null"], "description": "Parent folder ID. Use null for root."}
_PARENT_ID = {"type": ["string", "null"], "description": "Parent outline ID. Root outlines must use null."}
_POSITION = {"type": "integer", "description": "0-based sibling position."}


@tool_call_module(prefix="create_")
class CreateToolCallModule(ToolCallModule):
    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("create",)

    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not (is_agent_write_context(ctx) or is_object_journey(ctx) or is_outline_journey(ctx)):
            return []

        specs: list[ToolSpec] = []
        if is_agent_write_context(ctx) or is_object_journey(ctx):
            specs.append(
                ToolSpec(
                    name="create_story_entity",
                    description="Create a story entity.",
                    parameters=obj_schema(
                        {"kind": _ENTITY_KIND, "name": _NAME, "description": _DESC, "content": _CONTENT, "folderId": _FOLDER_ID},
                        ["kind", "name", "content"],
                    ),
                    auto_approve_category="create",
                )
            )
            specs.append(
                ToolSpec(
                    name="create_story_entity_folder",
                    description="Create a story entity folder.",
                    parameters=obj_schema(
                        {"name": _NAME, "description": _DESC, "parentId": _FOLDER_ID},
                        ["name"],
                    ),
                    auto_approve_category="create",
                )
            )
        if is_agent_write_context(ctx) or is_outline_journey(ctx):
            specs.extend(
                [
                    ToolSpec(
                        name="create_outline",
                        description="Create an outline, act, or chapter.",
                        parameters=obj_schema(
                            {"kind": _OUTLINE_KIND, "parentId": _PARENT_ID, "position": _POSITION, "name": _NAME, "description": _DESC, "content": _CONTENT},
                            ["kind", "name", "content"],
                        ),
                        auto_approve_category="create",
                    ),
                ]
            )
        return filter_allowed_specs(ctx, specs)

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        try:
            if tool_name == "create_story_entity":
                require_story_entity_arg_kind(args.get("kind"))
                ensure_story_entity_folder_exists(
                    ctx.db,
                    project_id=ctx.project_id,
                    folder_id=args.get("folderId"),
                )
            elif tool_name == "create_story_entity_folder":
                ensure_story_entity_folder_exists(
                    ctx.db,
                    project_id=ctx.project_id,
                    folder_id=args.get("parentId"),
                    field_name="parentId",
                )
            elif tool_name == "create_outline":
                outline_kind = require_outline_kind(args.get("kind"))
                parent_id = args.get("parentId")
                if outline_kind == "outline":
                    if parent_id not in {None, ""}:
                        raise ValueError("Root outlines cannot have parentId")
                elif outline_kind == "act":
                    ensure_outline_parent_kind(
                        ctx.db,
                        project_id=ctx.project_id,
                        outline_id=to_uuid(parent_id, "parentId"),
                        expected_kind="outline",
                    )
                elif outline_kind == "chapter":
                    ensure_outline_parent_kind(
                        ctx.db,
                        project_id=ctx.project_id,
                        outline_id=to_uuid(parent_id, "parentId"),
                        expected_kind="act",
                    )
            return valid_result()
        except ValueError as exc:
            return invalid_result(f"validate_{tool_name}", str(exc))

    async def execute(self, tool_name: str, args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        payload = {
            "name": str(args.get("name") or ""),
            "description": str(args.get("description") or ""),
            "content": str(args.get("content") or ""),
        }

        if tool_name == "create_story_entity":
            kind = require_story_entity_arg_kind(args.get("kind"))
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=STORY_ENTITY_TYPE,
                data=payload,
                language=ctx.language,
                rich_text_format="markdown",
                metadata={"folder_id": args.get("folderId")},
                kind=kind,
                user_request="tool:create_story_entity",
                created_by=ctx.user_id,
            )
            return make_result(
                f"Created {kind}",
                object_id=created["id"],
                object_type=STORY_ENTITY_TYPE,
                data={"kind": kind},
            )

        if tool_name == "create_story_entity_folder":
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type=STORY_ENTITY_FOLDER_TYPE,
                data={
                    "name": str(args.get("name") or ""),
                    "description": str(args.get("description") or ""),
                },
                language=ctx.language,
                metadata={"parent_id": args.get("parentId")},
                user_request="tool:create_story_entity_folder",
                created_by=ctx.user_id,
            )
            return make_result(
                "Created story entity folder",
                object_id=created["id"],
                object_type=STORY_ENTITY_FOLDER_TYPE,
            )

        if tool_name == "create_outline":
            outline_kind = require_outline_kind(args.get("kind"))
            created = object_service.create_object(
                ctx.db,
                project_id=ctx.project_id,
                object_type="outline",
                data=payload,
                language=ctx.language,
                rich_text_format="markdown",
                kind=outline_kind,
                metadata={
                    "parent_id": args.get("parentId"),
                    "position": args.get("position"),
                },
                user_request="tool:create_outline",
                created_by=ctx.user_id,
            )
            return make_result(
                f"Created {outline_kind}",
                object_id=created["id"],
                object_type="outline",
                data={
                    "kind": outline_kind,
                    "manuscriptId": created.get("metadata", {}).get("manuscript_id"),
                },
            )

        raise ValueError(f"Unsupported create tool: {tool_name}")
