from __future__ import annotations

from typing import Any

from .contracts import ImagePromptPayload, ImageSelection
from ..contracts import ImageModelDescriptor
from ...registry import sanitize_image_settings
from ....schemas.assets import (
    ImageRunRecipe,
    NaturalPromptData,
    NovelAIPromptData,
    PositiveNegativePromptData,
    StyledPrompt,
)


def _styled_prompt_text(prompt: StyledPrompt) -> str:
    return f"{prompt.prefix}{prompt.content}{prompt.postfix}".strip()


def _provider_setting_flags(recipe: ImageRunRecipe) -> dict[str, bool]:
    return {
        "hasReferenceImages": bool(recipe.reference_images),
        "kontext_model": "kontext" in recipe.model.lower(),
    }


def validate_canonical_recipe(raw: Any) -> dict[str, Any]:
    recipe = ImageRunRecipe.model_validate(raw)
    normalized = recipe.model_dump()
    normalized["provider_settings"] = sanitize_image_settings(
        recipe.provider,
        recipe.provider_settings,
        flags=_provider_setting_flags(recipe),
    )
    return normalized


def build_prompt_payload(recipe: ImageRunRecipe, descriptor: ImageModelDescriptor) -> ImagePromptPayload:
    if recipe.prompt_format != descriptor.prompt_format:
        raise ValueError(
            f"Recipe prompt_format '{recipe.prompt_format}' does not match "
            f"model prompt_format '{descriptor.prompt_format}'"
        )

    prompt_data = recipe.prompt_data
    if descriptor.prompt_format == "natural":
        if not isinstance(prompt_data, NaturalPromptData):
            raise ValueError("Natural image models require natural prompt_data")
        if not _styled_prompt_text(prompt_data.prompt):
            raise ValueError("Prompt must not be empty")
        return ImagePromptPayload(
            prompt_format=descriptor.prompt_format,
            prompt_data=prompt_data,
            style_id=recipe.style_id,
        )

    if descriptor.prompt_format == "positive_negative":
        if not isinstance(prompt_data, PositiveNegativePromptData):
            raise ValueError(
                "Positive/negative image models require positive_negative prompt_data"
            )
    elif descriptor.prompt_format == "novelai":
        if not isinstance(prompt_data, NovelAIPromptData):
            raise ValueError("NovelAI image models require novelai prompt_data")
        if any(not character.positive.strip() for character in prompt_data.characters):
            raise ValueError("NovelAI character positive prompt must not be blank")
    else:
        raise ValueError(f"Unsupported prompt format '{descriptor.prompt_format}'")

    if not _styled_prompt_text(prompt_data.positive):
        raise ValueError("Positive prompt must not be empty")

    return ImagePromptPayload(
        prompt_format=descriptor.prompt_format,
        prompt_data=prompt_data,
        style_id=recipe.style_id,
    )


def build_image_selection(recipe: ImageRunRecipe) -> ImageSelection:
    return ImageSelection(
        provider=recipe.provider,
        model=recipe.model,
        requested_aspect_ratio=recipe.requested_aspect_ratio,
        requested_image_size=recipe.requested_image_size,
        provider_settings=sanitize_image_settings(
            recipe.provider,
            recipe.provider_settings,
            flags=_provider_setting_flags(recipe),
        ) or {},
    )
