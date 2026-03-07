from __future__ import annotations

from typing import Any

from ..contexts import ToolExecutionContext, ToolValidationContext
from ..contracts import ToolSpec
from ..registry import ToolRegistry
from ..result_utils import invalid_result, valid_result
from .common_object_helpers import obj_schema
from ....services.agent_image_tool_service import (
    IMAGE_OBJECT_TOOL,
    IMAGE_SCENE_TOOL,
    build_object_image_session,
    build_scene_image_session,
    generate_preview_for_tool_call,
)


def _validate_prompt_and_ratio(args: dict[str, Any], validator_name: str):
    prompt = args.get("prompt")
    ratio = args.get("ratio")
    if not isinstance(prompt, str) or not prompt.strip():
        return invalid_result(validator_name, "prompt must be a non-empty string")
    if not isinstance(ratio, str) or not ratio.strip():
        return invalid_result(validator_name, "ratio must be a non-empty string")
    return None


def _object_validator(args: dict[str, Any], ctx: ToolValidationContext):
    base = _validate_prompt_and_ratio(args, "validate_generate_object_image")
    if base is not None:
        return base
    try:
        exec_ctx = ToolExecutionContext(
            db=ctx.db,
            thread=ctx.thread,
            run=ctx.run,
            tool_call_row=None,  # type: ignore[arg-type]
            user_id=ctx.user_id,
            project_id=ctx.project_id,
            language=ctx.language,
            sidecar=ctx.sidecar,
            preset_id=ctx.preset_id,
            invocation_mode=ctx.invocation_mode,
            allowed_tool_names=ctx.allowed_tool_names,
            allowed_sub_agent_ids=ctx.allowed_sub_agent_ids,
        )
        build_object_image_session(args, exec_ctx)
        return valid_result()
    except ValueError as exc:
        return invalid_result("validate_generate_object_image", str(exc))


def _scene_validator(args: dict[str, Any], ctx: ToolValidationContext):
    base = _validate_prompt_and_ratio(args, "validate_generate_scene_image")
    if base is not None:
        return base
    anchor = args.get("insert_before")
    if not isinstance(anchor, str) or not anchor.strip():
        return invalid_result("validate_generate_scene_image", "insert_before must be a non-empty string")

    async def _run() -> Any:
        try:
            exec_ctx = ToolExecutionContext(
                db=ctx.db,
                thread=ctx.thread,
                run=ctx.run,
                tool_call_row=None,  # type: ignore[arg-type]
                user_id=ctx.user_id,
                project_id=ctx.project_id,
                language=ctx.language,
                sidecar=ctx.sidecar,
                preset_id=ctx.preset_id,
                invocation_mode=ctx.invocation_mode,
                allowed_tool_names=ctx.allowed_tool_names,
                allowed_sub_agent_ids=ctx.allowed_sub_agent_ids,
            )
            await build_scene_image_session(args, exec_ctx)
            return valid_result()
        except ValueError as exc:
            return invalid_result("validate_generate_scene_image", str(exc))

    return _run()


async def _execute_object_image(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    extra_content = build_object_image_session(args, ctx)
    if ctx.tool_call_row is None:
        raise ValueError("Tool call row missing for image generation")
    ctx.tool_call_row.extra_content = extra_content
    result = await generate_preview_for_tool_call(
        ctx.db,
        tool_call=ctx.tool_call_row,
        user_id=ctx.user_id,
    )
    return {
        "__continue_as": "working",
        "__extra_content": ctx.tool_call_row.extra_content if isinstance(ctx.tool_call_row.extra_content, dict) else extra_content,
        **result,
    }


async def _execute_scene_image(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    extra_content = await build_scene_image_session(args, ctx)
    if ctx.tool_call_row is None:
        raise ValueError("Tool call row missing for image generation")
    ctx.tool_call_row.extra_content = extra_content
    result = await generate_preview_for_tool_call(
        ctx.db,
        tool_call=ctx.tool_call_row,
        user_id=ctx.user_id,
    )
    return {
        "__continue_as": "working",
        "__extra_content": ctx.tool_call_row.extra_content if isinstance(ctx.tool_call_row.extra_content, dict) else extra_content,
        **result,
    }


def register(registry: ToolRegistry) -> None:
    registry.register_tool(
        ToolSpec(
            name=IMAGE_OBJECT_TOOL,
            description="Prepare an object image generation workflow for a story object or basic info entry.",
            parameters=obj_schema(
                {
                    "prompt": {"type": "string", "description": "Image generation prompt."},
                    "ratio": {"type": "string", "description": "Desired aspect ratio such as 1:1 or 16:9."},
                    "object_id": {"type": "string", "description": "Optional object UUID to target explicitly."},
                },
                ["prompt", "ratio"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category=None,
            validators=(_object_validator,),
            executor=_execute_object_image,
        )
    )
    registry.register_tool(
        ToolSpec(
            name=IMAGE_SCENE_TOOL,
            description="Prepare a scene image generation workflow and insert the result before a manuscript text anchor.",
            parameters=obj_schema(
                {
                    "prompt": {"type": "string", "description": "Image generation prompt."},
                    "ratio": {"type": "string", "description": "Desired aspect ratio such as 1:1 or 16:9."},
                    "insert_before": {"type": "string", "description": "Exact manuscript text anchor to insert the image before."},
                },
                ["prompt", "ratio", "insert_before"],
            ),
            tool_sets=frozenset({"agent_agent_mode", "agent_plan_mode"}),
            auto_approve_category=None,
            validators=(_scene_validator,),
            executor=_execute_scene_image,
        )
    )
