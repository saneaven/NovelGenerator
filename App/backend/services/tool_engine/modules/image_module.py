from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from ....services.image_run_service import (
    IMAGE_OBJECT_TOOL,
    IMAGE_SCENE_TOOL,
    image_run_service,
    resolve_prompt_format,
    resolve_explicit_object_target,
    validate_scene_anchor,
)
from ..contracts import PersistedToolMeta, ToolBinding, ToolBindingMeta, ToolExecutionOutcome, ToolFeatureModule, ToolSpec
from ..registry import tool_feature_module
from ..result_utils import invalid_result, valid_result
from .feature_common import filter_allowed_bindings
from .image_read_module import build_read_image_bindings
from .shared import filter_allowed_specs, is_non_journey, journey_kind, obj_schema


SUBMIT_IMAGE_PROMPT_TOOL = "submit_image_prompt"
ImagePromptFormat = Literal["natural", "positive_negative", "novelai"]
_IMAGE_PROMPT_FORMATS = frozenset({"natural", "positive_negative", "novelai"})
_IMAGE_PROMPT_JOURNEYS = frozenset({"imagePrompt", "sceneImagePrompt"})


def _prompt_format(input_payload: Any) -> ImagePromptFormat:
    payload = input_payload if isinstance(input_payload, dict) else {}
    raw = str(payload.get("promptFormat") or "").strip()
    if raw in _IMAGE_PROMPT_FORMATS:
        return raw  # type: ignore[return-value]
    raise ValueError("promptFormat must be one of: natural, positive_negative, novelai")


def _generation_prompt_format(settings: Any) -> ImagePromptFormat:
    config = getattr(settings, "image_gen_config", None)
    if not isinstance(config, dict):
        raise ValueError("Image generation settings are missing")
    provider_name = str(config.get("provider") or "").strip()
    model_name = str(config.get("model") or "").strip()
    return resolve_prompt_format(provider_name, model_name)


def _prompt_schema_parts(prompt_format: ImagePromptFormat) -> tuple[dict[str, Any], list[str]]:
    if prompt_format == "natural":
        return (
            {
                "prompt": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Natural-language image generation prompt.",
                }
            },
            ["prompt"],
        )

    if prompt_format == "positive_negative":
        return (
            {
                "positive": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Positive image-generation prompt or tags.",
                },
                "negative": {
                    "type": "string",
                    "description": "Negative image-generation prompt or tags. May be empty.",
                },
            },
            ["positive", "negative"],
        )

    character_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "positive": {
                "type": "string",
                "minLength": 1,
                "description": "Positive prompt or tags for this character.",
            },
            "negative": {
                "type": "string",
                "description": "Negative prompt or tags for this character. May be empty.",
            },
        },
        "required": ["positive", "negative"],
    }
    return (
        {
            "positive": {
                "type": "string",
                "minLength": 1,
                "description": "Base positive NovelAI prompt or tags.",
            },
            "negative": {
                "type": "string",
                "description": "Base negative NovelAI prompt or tags. May be empty.",
            },
            "characters": {
                "type": "array",
                "description": "Per-character prompts. May be empty.",
                "items": character_schema,
            },
        },
        ["positive", "negative", "characters"],
    )


def _prompt_schema(
    prompt_format: ImagePromptFormat,
    *,
    extra_properties: dict[str, Any] | None = None,
    extra_required: list[str] | None = None,
) -> dict[str, Any]:
    properties, required = _prompt_schema_parts(prompt_format)
    return obj_schema(
        {**properties, **(extra_properties or {})},
        [*required, *(extra_required or [])],
    )


def _image_prompt_journey_kind(ctx: Any) -> str | None:
    if getattr(ctx.thread, "thread_type", None) != "journey":
        return None
    kind = journey_kind(ctx)
    return kind if kind in _IMAGE_PROMPT_JOURNEYS else None


def _image_specs(ctx: Any) -> list[ToolSpec]:
    image_prompt_journey = _image_prompt_journey_kind(ctx)
    if image_prompt_journey is not None:
        prompt_format = _prompt_format(ctx.input_payload)
        return filter_allowed_specs(
            ctx,
            [
                ToolSpec(
                    name=SUBMIT_IMAGE_PROMPT_TOOL,
                    description=f"Submit the completed {prompt_format} image prompt.",
                    parameters=_prompt_schema(prompt_format),
                    auto_approve_category=None,
                    execution_policy="immediate",
                    ends_run=True,
                )
            ],
        )

    if not is_non_journey(ctx):
        return []

    prompt_format = _generation_prompt_format(ctx.settings)
    return filter_allowed_specs(
        ctx,
        [
            ToolSpec(
                name=IMAGE_OBJECT_TOOL,
                description="Generate an image for a specific story entity or basic info entry.",
                parameters=_prompt_schema(
                    prompt_format,
                    extra_properties={
                        "ratio": {"type": "string", "description": "Desired aspect ratio such as 1:1 or 16:9."},
                        "image_size": {"type": "string", "description": "Optional image size tier such as 1K, 2K, or 4K."},
                        "object_id": {"type": "string", "description": "Target object UUID."},
                    },
                    extra_required=["ratio", "object_id"],
                ),
                auto_approve_category=None,
                execution_policy="approval",
                ends_run=False,
            ),
            ToolSpec(
                name=IMAGE_SCENE_TOOL,
                description="Generate a scene image and insert it before a specific manuscript text anchor.",
                parameters=_prompt_schema(
                    prompt_format,
                    extra_properties={
                        "ratio": {"type": "string", "description": "Desired aspect ratio such as 1:1 or 16:9."},
                        "image_size": {"type": "string", "description": "Optional image size tier such as 1K, 2K, or 4K."},
                        "manuscript_id": {"type": "string", "description": "Target manuscript UUID."},
                        "insert_before": {"type": "string", "description": "Exact manuscript text anchor to insert the image before."},
                    },
                    extra_required=["ratio", "manuscript_id", "insert_before"],
                ),
                auto_approve_category=None,
                execution_policy="approval",
                ends_run=False,
            ),
        ],
    )


def _validate_prompt_arguments(
    args: dict[str, Any],
    *,
    prompt_format: ImagePromptFormat,
    validator_name: str,
    extra_fields: frozenset[str] = frozenset(),
):
    _, required_fields = _prompt_schema_parts(prompt_format)
    prompt_fields = frozenset(required_fields)
    unknown = sorted(set(args) - prompt_fields - extra_fields)
    if unknown:
        return invalid_result(validator_name, f"Unknown prompt parameters: {', '.join(unknown)}")

    if prompt_format == "natural":
        prompt = args.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            return invalid_result(validator_name, "prompt must be a non-blank string")
        return None

    positive = args.get("positive")
    negative = args.get("negative")
    if not isinstance(positive, str) or not positive.strip():
        return invalid_result(validator_name, "positive must be a non-blank string")
    if not isinstance(negative, str):
        return invalid_result(validator_name, "negative must be a string")

    if prompt_format == "positive_negative":
        return None

    characters = args.get("characters")
    if not isinstance(characters, list):
        return invalid_result(validator_name, "characters must be an array")
    for index, character in enumerate(characters):
        if not isinstance(character, dict):
            return invalid_result(validator_name, f"characters[{index}] must be an object")
        unknown_character_fields = sorted(set(character) - {"positive", "negative"})
        if unknown_character_fields:
            return invalid_result(
                validator_name,
                f"Unknown parameters for characters[{index}]: {', '.join(unknown_character_fields)}",
            )
        character_positive = character.get("positive")
        character_negative = character.get("negative")
        if not isinstance(character_positive, str) or not character_positive.strip():
            return invalid_result(
                validator_name,
                f"characters[{index}].positive must be a non-blank string",
            )
        if not isinstance(character_negative, str):
            return invalid_result(
                validator_name,
                f"characters[{index}].negative must be a string",
            )
    return None


def _validate_ratio(args: dict[str, Any], validator_name: str):
    ratio = args.get("ratio")
    if not isinstance(ratio, str) or not ratio.strip():
        return invalid_result(validator_name, "ratio must be a non-empty string")
    return None


@tool_feature_module()
class ImageFeatureModule(ToolFeatureModule):
    feature_key = "image"

    def list_bindings(self, ctx) -> list[ToolBinding]:
        image_prompt_journey = _image_prompt_journey_kind(ctx)
        if image_prompt_journey is None and not is_non_journey(ctx):
            return []
        prompt_format = (
            _prompt_format(ctx.input_payload)
            if image_prompt_journey is not None
            else _generation_prompt_format(ctx.settings)
        )
        bindings: list[ToolBinding] = []
        for spec in _image_specs(ctx):
            tool_name = spec.name

            if tool_name == SUBMIT_IMAGE_PROMPT_TOOL:
                target_kind = "scene_image" if image_prompt_journey == "sceneImagePrompt" else "object_image"

                async def _validate_submit(args, _validation_ctx, _prompt_format=prompt_format):
                    invalid = _validate_prompt_arguments(
                        args,
                        prompt_format=_prompt_format,
                        validator_name="validate_submit_image_prompt",
                    )
                    return invalid if invalid is not None else valid_result()

                async def _execute_submit(_args, _execution_ctx):
                    return ToolExecutionOutcome(lifecycle="applied")

                bindings.append(
                    ToolBinding(
                        spec=spec,
                        meta=ToolBindingMeta(
                            feature_key="image",
                            category="generate",
                            op="generate",
                            target_kind=target_kind,
                        ),
                        validate=_validate_submit,
                        execute=_execute_submit,
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
                continue

            target_kind = "object_image" if tool_name == IMAGE_OBJECT_TOOL else "scene_image"

            async def _validate(args, validation_ctx, _tool_name=tool_name, _prompt_format=prompt_format):
                validator_name = (
                    "validate_generate_object_image"
                    if _tool_name == IMAGE_OBJECT_TOOL
                    else "validate_generate_scene_image"
                )
                prompt_invalid = _validate_prompt_arguments(
                    args,
                    prompt_format=_prompt_format,
                    validator_name=validator_name,
                    extra_fields=(
                        frozenset({"ratio", "image_size", "object_id"})
                        if _tool_name == IMAGE_OBJECT_TOOL
                        else frozenset({"ratio", "image_size", "manuscript_id", "insert_before"})
                    ),
                )
                if prompt_invalid is not None:
                    return prompt_invalid
                ratio_invalid = _validate_ratio(args, validator_name)
                if ratio_invalid is not None:
                    return ratio_invalid

                if _tool_name == IMAGE_OBJECT_TOOL:
                    raw_object_id = args.get("object_id")
                    if not isinstance(raw_object_id, str) or not raw_object_id.strip():
                        return invalid_result(validator_name, "object_id must be a non-empty string")
                    try:
                        resolve_explicit_object_target(
                            validation_ctx.db,
                            project_id=validation_ctx.project_id,
                            language=validation_ctx.language,
                            object_id=UUID(raw_object_id),
                        )
                        return valid_result()
                    except (TypeError, ValueError) as exc:
                        return invalid_result(validator_name, str(exc))

                raw_manuscript_id = args.get("manuscript_id")
                if not isinstance(raw_manuscript_id, str) or not raw_manuscript_id.strip():
                    return invalid_result(validator_name, "manuscript_id must be a non-empty string")
                anchor = args.get("insert_before")
                if not isinstance(anchor, str) or not anchor.strip():
                    return invalid_result(validator_name, "insert_before must be a non-empty string")
                try:
                    await validate_scene_anchor(
                        validation_ctx.db,
                        project_id=validation_ctx.project_id,
                        manuscript_id=UUID(raw_manuscript_id),
                        language=validation_ctx.language,
                        anchor=anchor,
                    )
                    return valid_result()
                except (TypeError, ValueError) as exc:
                    return invalid_result(validator_name, str(exc))

            async def _execute(args, execution_ctx):
                _ = args
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

        if image_prompt_journey is None:
            bindings.extend(build_read_image_bindings(ctx))
        return filter_allowed_bindings(ctx, bindings)
