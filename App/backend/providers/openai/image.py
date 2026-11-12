from __future__ import annotations

import io
from math import isqrt
import re
from typing import Any

import httpx
from openai import AsyncOpenAI, OpenAIError

from ..shared.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from ..shared.image.contracts import (
    ImageGenerationOutput,
    PreparedImageRequest,
    ResolvedGeometry,
)
from ...schemas.assets import NaturalPromptData


OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY = 16
OPENAI_GPT_IMAGE_2_MAX_EDGE = 3840
OPENAI_GPT_IMAGE_2_TARGET_PIXELS = {
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "4K": 3840 * 2160,
}
OPENAI_IMAGE_MODELS_URL = "https://api.openai.com/v1/models"
_FLEXIBLE_ASPECT_RATIOS = (
    "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
)
_FLEXIBLE_RESOLUTIONS = ("1K", "2K", "4K")
_STANDARD_RESOLUTIONS = ("1024x1024", "1536x1024", "1024x1536")
_GPT_IMAGE_VERSION = re.compile(r"^gpt-image-(\d+)(?:[.-]|$)", re.IGNORECASE)


def describe_model(model_id: str, owned_by: str | None = None) -> ImageModelDescriptor:
    # /models provides identity, not capabilities. Geometry follows the image
    # API family contract; it never determines which model IDs are listed.
    version = _GPT_IMAGE_VERSION.match(model_id)
    flexible = version is not None and int(version.group(1)) >= 2
    geometry = (
        ImageModelGeometrySpec(
            supported_aspect_ratios=_FLEXIBLE_ASPECT_RATIOS,
            supported_resolutions=_FLEXIBLE_RESOLUTIONS,
            default_aspect_ratio="1:1",
            default_resolution="1K",
            resolution_mode="native_tier",
            supported_geometry_pairs={ratio: _FLEXIBLE_RESOLUTIONS for ratio in _FLEXIBLE_ASPECT_RATIOS},
        )
        if flexible else ImageModelGeometrySpec(
            supported_aspect_ratios=("1:1", "3:2", "2:3"),
            supported_resolutions=_STANDARD_RESOLUTIONS,
            default_aspect_ratio="1:1",
            default_resolution="1024x1024",
            resolution_mode="native_exact",
        )
    )
    return ImageModelDescriptor(
        id=model_id,
        name=model_id,
        canonical_slug=model_id,
        owned_by=owned_by,
        prompt_format="natural",
        supports_image_input=True,
        supports_mask_input=True,
        supports_multi_image_input=True,
        geometry=geometry,
        category="image",
        architecture={"input_modalities": ["text", "image"], "output_modalities": ["image"]},
        capabilities={
            "text_to_image": True,
            "image_to_image": True,
            "masking": True,
            "multi_image_edit": True,
            "flexible_resolution": flexible,
        },
    )


async def list_models(
    *,
    provider_config: dict[str, Any],
    runtime_spec: Any,
    models_adapter: str,
) -> list[ImageModelDescriptor]:
    del runtime_spec, models_adapter
    api_key = str(provider_config.get("api_key") or "").strip()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            OPENAI_IMAGE_MODELS_URL,
            headers={"Authorization": f"Bearer {api_key}"},
        )
    response.raise_for_status()
    payload = response.json()
    models: dict[str, ImageModelDescriptor] = {}
    for item in payload["data"]:
        model_id = item["id"]
        if not model_id.lower().startswith(("gpt-image-", "chatgpt-image-")):
            continue
        owned_by = item.get("owned_by")
        models[model_id] = describe_model(model_id, owned_by=owned_by)
    return [models[model_id] for model_id in sorted(models)]


class OpenAIImageAdapter:
    def __init__(self, provider_config: dict[str, Any]):
        self._api_key = str(provider_config.get("api_key") or "").strip()
        self._client = AsyncOpenAI(api_key=self._api_key) if self._api_key else None

    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        if self._client is None:
            return ImageGenerationOutput(
                success=False,
                error="OpenAI client not initialized. Check API key.",
            )

        prompt_data = request.prompt_payload.prompt_data
        if not isinstance(prompt_data, NaturalPromptData):
            return ImageGenerationOutput(
                success=False,
                error="Natural prompt data is required for OpenAI image generation.",
            )
        prompt = prompt_data.prompt

        settings = request.provider_settings
        output_format = str(settings.get("output_format") or "png")
        moderation = str(settings.get("moderation") or "auto")
        quality = str(settings.get("quality") or "medium")
        size = str(request.resolved_geometry.resolved_native_size or "1024x1024").strip() or "1024x1024"

        width, height = 1024, 1024
        if "x" in size:
            try:
                width_text, height_text = size.split("x", 1)
                width = int(width_text)
                height = int(height_text)
            except ValueError:
                width, height = 1024, 1024

        try:
            if request.reference_images:
                images = [
                    self._build_upload_image(reference.image_data, index)
                    for index, reference in enumerate(request.reference_images)
                ]
                params = {
                    "model": request.model_descriptor.id,
                    "image": images if len(images) > 1 else images[0],
                    "prompt": f"{prompt.prefix}{prompt.content}{prompt.postfix}",
                    "size": size,
                    "quality": quality,
                    "n": 1,
                    "background": settings.get("background", "auto"),
                    "output_format": output_format,
                    "moderation": moderation,
                }
                if request.mask_image is not None:
                    params["mask"] = self._build_upload_image(request.mask_image.image_data, "mask")
                if output_format in {"jpeg", "webp"}:
                    params["output_compression"] = settings.get("output_compression", 90)
                response = await self._client.images.edit(**params)  # type: ignore[arg-type]
            else:
                params = {
                    "model": request.model_descriptor.id,
                    "prompt": f"{prompt.prefix}{prompt.content}{prompt.postfix}",
                    "n": 1,
                    "size": size,
                    "quality": quality,
                    "background": settings.get("background", "auto"),
                    "output_format": output_format,
                    "moderation": moderation,
                }
                if output_format in {"jpeg", "webp"}:
                    params["output_compression"] = settings.get("output_compression", 90)
                response = await self._client.images.generate(**params)
        except OpenAIError as exc:
            return ImageGenerationOutput(success=False, error=f"OpenAI API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationOutput(success=False, error=f"Unexpected error: {exc}")

        if not response.data:
            return ImageGenerationOutput(success=False, error="No image data in response")

        item = response.data[0]
        return ImageGenerationOutput(
            success=True,
            image_b64=item.b64_json,
            revised_prompt=getattr(item, "revised_prompt", None),
            width=width,
            height=height,
            format=output_format,
        )

    def _build_upload_image(self, image_data: bytes, index: int | str) -> io.BytesIO:
        file_like = io.BytesIO(image_data)
        file_like.name = f"reference_{index}.png"
        return file_like


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return OpenAIImageAdapter(provider_config)


def _gcd(left: int, right: int) -> int:
    while right:
        left, right = right, left % right
    return left or 1


def _lcm(left: int, right: int) -> int:
    return abs(left * right) // _gcd(left, right)


def _parse_ratio_pair(raw: str) -> tuple[int, int]:
    left, right = str(raw).split(":", 1)
    return int(left), int(right)


def _resolve_openai_native_size(*, aspect_ratio: str, image_size: str) -> str:
    width_ratio, height_ratio = _parse_ratio_pair(aspect_ratio)
    reduced_divisor = _gcd(width_ratio, height_ratio)
    width_ratio //= reduced_divisor
    height_ratio //= reduced_divisor

    target_pixels = OPENAI_GPT_IMAGE_2_TARGET_PIXELS.get(image_size, OPENAI_GPT_IMAGE_2_TARGET_PIXELS["1K"])
    width_step = OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY // _gcd(width_ratio, OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY)
    height_step = OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY // _gcd(height_ratio, OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY)
    scale_step = _lcm(width_step, height_step)
    pixels_per_scale = width_ratio * height_ratio
    approx_scale = isqrt(target_pixels // pixels_per_scale)
    lower_scale = (approx_scale // scale_step) * scale_step
    upper_scale = ((approx_scale + scale_step - 1) // scale_step) * scale_step
    if lower_scale == 0:
        lower_scale = scale_step
    if upper_scale == 0:
        upper_scale = scale_step
    candidate_scales = {lower_scale, upper_scale}
    best_scale = min(
        candidate_scales,
        key=lambda scale: abs((width_ratio * scale * height_ratio * scale) - target_pixels),
    )
    max_scale = (OPENAI_GPT_IMAGE_2_MAX_EDGE // max(width_ratio, height_ratio) // scale_step) * scale_step
    if best_scale > max_scale:
        best_scale = max_scale
    width = width_ratio * best_scale
    height = height_ratio * best_scale
    return f"{width}x{height}"


async def resolve_geometry(
    *,
    provider_config: dict[str, Any],
    runtime_spec: Any,
    descriptor: Any,
    requested_aspect_ratio: str,
    requested_image_size: str,
    resolved_geometry: ResolvedGeometry,
) -> ResolvedGeometry:
    del provider_config, runtime_spec, requested_aspect_ratio, requested_image_size
    if descriptor.geometry.resolution_mode == "native_exact":
        return resolved_geometry
    return ResolvedGeometry(
        requested_aspect_ratio=resolved_geometry.requested_aspect_ratio,
        requested_image_size=resolved_geometry.requested_image_size,
        resolved_aspect_ratio=resolved_geometry.resolved_aspect_ratio,
        resolved_image_size=resolved_geometry.resolved_image_size,
        resolved_native_size=_resolve_openai_native_size(
            aspect_ratio=resolved_geometry.resolved_aspect_ratio,
            image_size=resolved_geometry.resolved_image_size,
        ),
    )
