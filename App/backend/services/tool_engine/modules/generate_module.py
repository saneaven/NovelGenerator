from __future__ import annotations

from typing import Any
from uuid import UUID

from ..contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from ..contracts import ToolCallModule, ToolSpec
from ..registry import tool_call_module
from ..result_utils import invalid_result, valid_result
from ....services.image_run_service import (
    IMAGE_OBJECT_TOOL,
    IMAGE_SCENE_TOOL,
    image_run_service,
    resolve_explicit_object_target,
    validate_scene_anchor,
)
from .shared import filter_allowed_specs, is_non_journey, obj_schema


def _validate_prompt_and_ratio(args: dict[str, Any], validator_name: str):
    prompt = args.get("prompt")
    ratio = args.get("ratio")
    if not isinstance(prompt, str) or not prompt.strip():
        return invalid_result(validator_name, "prompt must be a non-empty string")
    if not isinstance(ratio, str) or not ratio.strip():
        return invalid_result(validator_name, "ratio must be a non-empty string")
    return None


@tool_call_module(prefix="generate_")
class GenerateToolCallModule(ToolCallModule):
    def list_tools(self, ctx: ToolModuleContext) -> list[ToolSpec]:
        if not is_non_journey(ctx):
            return []
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name=IMAGE_OBJECT_TOOL,
                    description="Generate an image for a specific story entity or basic info entry.",
                    parameters=obj_schema(
                        {
                            "prompt": {"type": "string", "description": "Image generation prompt."},
                            "ratio": {"type": "string", "description": "Desired aspect ratio such as 1:1 or 16:9."},
                            "image_size": {"type": "string", "description": "Optional image size tier such as 1K, 2K, or 4K."},
                            "object_id": {"type": "string", "description": "Target object UUID."},
                        },
                        ["prompt", "ratio", "object_id"],
                    ),
                    auto_approve_category=None,
                ),
                ToolSpec(
                    name=IMAGE_SCENE_TOOL,
                    description="Generate a scene image and insert it before a specific manuscript text anchor.",
                    parameters=obj_schema(
                        {
                            "prompt": {"type": "string", "description": "Image generation prompt."},
                            "ratio": {"type": "string", "description": "Desired aspect ratio such as 1:1 or 16:9."},
                            "image_size": {"type": "string", "description": "Optional image size tier such as 1K, 2K, or 4K."},
                            "manuscript_id": {"type": "string", "description": "Target manuscript UUID."},
                            "insert_before": {"type": "string", "description": "Exact manuscript text anchor to insert the image before."},
                        },
                        ["prompt", "ratio", "manuscript_id", "insert_before"],
                    ),
                    auto_approve_category=None,
                ),
            ],
        )

    async def validate(self, tool_name: str, args: dict[str, Any], ctx: ToolValidationContext):
        if tool_name == IMAGE_OBJECT_TOOL:
            base = _validate_prompt_and_ratio(args, "validate_generate_object_image")
            if base is not None:
                return base
            raw_object_id = args.get("object_id")
            if not isinstance(raw_object_id, str) or not raw_object_id.strip():
                return invalid_result("validate_generate_object_image", "object_id must be a non-empty string")
            try:
                resolve_explicit_object_target(
                    ctx.db,
                    project_id=ctx.project_id,
                    language=ctx.language,
                    object_id=UUID(raw_object_id),
                )
                return valid_result()
            except ValueError as exc:
                return invalid_result("validate_generate_object_image", str(exc))

        if tool_name == IMAGE_SCENE_TOOL:
            base = _validate_prompt_and_ratio(args, "validate_generate_scene_image")
            if base is not None:
                return base
            raw_manuscript_id = args.get("manuscript_id")
            if not isinstance(raw_manuscript_id, str) or not raw_manuscript_id.strip():
                return invalid_result("validate_generate_scene_image", "manuscript_id must be a non-empty string")
            anchor = args.get("insert_before")
            if not isinstance(anchor, str) or not anchor.strip():
                return invalid_result("validate_generate_scene_image", "insert_before must be a non-empty string")
            try:
                await validate_scene_anchor(
                    ctx.db,
                    project_id=ctx.project_id,
                    manuscript_id=UUID(raw_manuscript_id),
                    language=ctx.language,
                    anchor=anchor,
                )
                return valid_result()
            except ValueError as exc:
                return invalid_result("validate_generate_scene_image", str(exc))

        return invalid_result("validate_generate_tool_name", f"Unsupported generate tool: {tool_name}")

    async def execute(self, tool_name: str, _args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
        if ctx.tool_call_row is None:
            raise ValueError("Tool call row missing for image generation")
        if tool_name not in {IMAGE_OBJECT_TOOL, IMAGE_SCENE_TOOL}:
            raise ValueError(f"Unsupported generate tool: {tool_name}")
        image_run = await image_run_service.create_tool_preview_run(
            ctx.db,
            tool_call=ctx.tool_call_row,
            user_id=ctx.user_id,
            language=ctx.language,
        )
        return {
            "success": True,
            "message": "Image generation started.",
            "image_run_id": str(image_run.id),
            "data": {"image_run_id": str(image_run.id)},
        }
