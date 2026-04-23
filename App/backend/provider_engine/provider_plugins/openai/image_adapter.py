from __future__ import annotations

import io
from typing import Any

from openai import AsyncOpenAI, OpenAIError

from ....image_engine.contracts import (
    ImageGenerationOutput,
    PreparedImageRequest,
)


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
        size = (
            str(request.resolved_geometry.resolved_native_size or "1024x1024").strip()
            or "1024x1024"
        )

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
                    self._build_upload_image(ref.image_data, index)
                    for index, ref in enumerate(request.reference_images)
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
                    params["mask"] = self._build_upload_image(
                        request.mask_image.image_data,
                        "mask",
                    )
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
