from __future__ import annotations

import io
from math import isqrt
from typing import Any

from openai import AsyncOpenAI, OpenAIError

from ..shared.image.contracts import (
    ImageGenerationOutput,
    PreparedImageRequest,
    ResolvedGeometry,
)


OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY = 16
OPENAI_GPT_IMAGE_2_MAX_EDGE = 3840
OPENAI_GPT_IMAGE_2_TARGET_PIXELS = {
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "4K": 3840 * 2160,
}


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

        prompt = request.prompt_payload.prompt
        if prompt is None:
            return ImageGenerationOutput(
                success=False,
                error="Prompt is required for OpenAI image generation.",
            )

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
    del provider_config, runtime_spec, descriptor, requested_aspect_ratio, requested_image_size
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
