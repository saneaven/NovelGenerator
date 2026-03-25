from __future__ import annotations

from ....services.image_run_service import IMAGE_OBJECT_TOOL, IMAGE_SCENE_TOOL, image_run_service
from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule
from ..registry import tool_feature_module
from .feature_common import filter_allowed_bindings, legacy_specs_by_name
from .generate_module import GenerateToolCallModule


_GENERATE = GenerateToolCallModule()


@tool_feature_module()
class ImageFeatureModule(ToolFeatureModule):
    feature_key = "image"

    def list_bindings(self, ctx) -> list:
        specs = legacy_specs_by_name(_GENERATE, ctx)
        bindings = []
        for name, target_kind in (
            (IMAGE_OBJECT_TOOL, "object_image"),
            (IMAGE_SCENE_TOOL, "scene_image"),
        ):
            spec = specs.get(name)
            if spec is None:
                continue
            async def _validate(args, validation_ctx, _tool_name=name):
                return await _GENERATE.validate(_tool_name, args, validation_ctx)

            async def _execute(args, execution_ctx):
                if execution_ctx.tool_call_row is None:
                    raise ValueError("Tool call row missing for image generation")
                image_run = await image_run_service.create_tool_preview_run(
                    execution_ctx.db,
                    tool_call=execution_ctx.tool_call_row,
                    user_id=execution_ctx.user_id,
                    language=execution_ctx.language,
                )
                execution_ctx.tool_call_row.image_run_id = image_run.id
                return ToolExecutionOutcome(
                    lifecycle="working",
                    result={
                        "success": True,
                        "message": "Image generation started.",
                        "image_run_id": str(image_run.id),
                        "data": {"image_run_id": str(image_run.id)},
                    },
                    image_run_id=image_run.id,
                )

            bindings.append(
                ToolBinding(
                    spec=spec,
                    meta=ToolBindingMeta(
                        feature_key="image",
                        category="generate",
                        op="generate",
                        target_kind=target_kind,
                    ),
                    validate=_validate,
                    execute=_execute,
                    build_persisted_meta=lambda _ctx, _args, _target_kind=target_kind: PersistedToolMeta(
                        feature_key="image",
                        category="generate",
                        op="generate",
                        target_kind=_target_kind,
                        target_id=None,
                        merge_key=None,
                    ),
                )
            )
        return filter_allowed_bindings(ctx, bindings)
