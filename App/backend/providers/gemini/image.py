from __future__ import annotations

import base64
from typing import Any

from google import genai
from google.genai import errors, types

from ..shared.image.contracts import ImageGenerationOutput, PreparedImageRequest


class GeminiImageAdapter:
    def __init__(self, provider_config: dict[str, Any]):
        self._api_key = str(provider_config.get("api_key") or "").strip()
        self._client = genai.Client(api_key=self._api_key) if self._api_key else None

    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        if self._client is None:
            return ImageGenerationOutput(success=False, error="Gemini client not initialized. Check API key.")

        prompt = request.prompt_payload.prompt
        if prompt is None:
            return ImageGenerationOutput(success=False, error="Prompt is required for Gemini image generation.")

        image_config = types.ImageConfig(
            aspect_ratio=request.resolved_geometry.resolved_aspect_ratio,
            image_size=request.resolved_geometry.resolved_image_size,
        )
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            image_config=image_config,
        )

        if request.reference_images:
            content_parts: list[types.Part] = []
            for reference in request.reference_images:
                content_parts.append(
                    types.Part.from_bytes(
                        data=reference.image_data,
                        mime_type=reference.mime_type,
                    )
                )
            content_parts.append(types.Part.from_text(text=f"{prompt.prefix}{prompt.content}{prompt.postfix}"))
            contents: Any = content_parts
        else:
            contents = f"{prompt.prefix}{prompt.content}{prompt.postfix}"

        try:
            response = await self._client.aio.models.generate_content(
                model=request.model_descriptor.id,
                contents=contents,
                config=config,
            )
        except errors.APIError as exc:
            return ImageGenerationOutput(success=False, error=f"Gemini API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationOutput(success=False, error=f"Unexpected error: {exc}")

        for part in list(getattr(response, "parts", []) or []):
            if getattr(part, "inline_data", None):
                inline_data = part.inline_data
                image_data = inline_data.data
                mime_type = inline_data.mime_type or "image/png"
                image_b64 = (
                    base64.b64encode(image_data).decode("utf-8")
                    if isinstance(image_data, bytes)
                    else image_data
                )
                format_map = {
                    "image/png": "png",
                    "image/jpeg": "jpeg",
                    "image/webp": "webp",
                }
                return ImageGenerationOutput(
                    success=True,
                    image_b64=image_b64,
                    width=1024,
                    height=1024,
                    format=format_map.get(mime_type, "png"),
                )

        text_content = "".join(
            part.text
            for part in list(getattr(response, "parts", []) or [])
            if getattr(part, "text", None)
        )
        if text_content:
            return ImageGenerationOutput(
                success=False,
                error=f"No image generated. Model response: {text_content[:500]}",
            )
        return ImageGenerationOutput(success=False, error="No image data in response")


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return GeminiImageAdapter(provider_config)
