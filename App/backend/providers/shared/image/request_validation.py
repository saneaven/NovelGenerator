from __future__ import annotations

from typing import Any

from .contracts import ImagePromptPayload, ImageSelection
from ..contracts import ImageModelDescriptor
from ...registry import sanitize_image_settings
from ....schemas.assets import ImageRunRecipe


def _joined_prompt_text(*parts: str | None) -> str:
    return "".join(part or "" for part in parts).strip()


def validate_canonical_recipe(raw: Any) -> dict[str, Any]:
    recipe = ImageRunRecipe.model_validate(raw)
    normalized = recipe.model_dump()
    normalized["provider_settings"] = sanitize_image_settings(
        recipe.provider,
        recipe.provider_settings,
    )
    return normalized


def build_prompt_payload(recipe: ImageRunRecipe, descriptor: ImageModelDescriptor) -> ImagePromptPayload:
    if recipe.prompt_type != descriptor.prompt_type:
        raise ValueError(
            f"Recipe prompt_type '{recipe.prompt_type}' does not match model prompt_type '{descriptor.prompt_type}'"
        )

    if descriptor.prompt_type == "natural":
        prompt = recipe.prompt
        if prompt is None:
            raise ValueError("Natural image models require 'prompt'")
        if not _joined_prompt_text(prompt.prefix, prompt.content, prompt.postfix):
            raise ValueError("Prompt must not be empty")
        return ImagePromptPayload(
            prompt_type=descriptor.prompt_type,
            prompt=prompt,
            style_id=recipe.style_id,
        )

    positive_prompt = recipe.positive_prompt
    if positive_prompt is None:
        raise ValueError("Tag-based image models require 'positive_prompt'")
    if not _joined_prompt_text(
        positive_prompt.prefix,
        positive_prompt.content,
        positive_prompt.postfix,
    ):
        raise ValueError("Positive prompt must not be empty")

    negative_prompt = recipe.negative_prompt
    if negative_prompt is not None and not _joined_prompt_text(
        negative_prompt.prefix,
        negative_prompt.content,
        negative_prompt.postfix,
    ):
        negative_prompt = None

    return ImagePromptPayload(
        prompt_type=descriptor.prompt_type,
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        style_id=recipe.style_id,
    )


def build_image_selection(recipe: ImageRunRecipe) -> ImageSelection:
    return ImageSelection(
        provider=recipe.provider,
        model=recipe.model,
        requested_aspect_ratio=recipe.requested_aspect_ratio,
        requested_image_size=recipe.requested_image_size,
        provider_settings=sanitize_image_settings(recipe.provider, recipe.provider_settings) or {},
    )
