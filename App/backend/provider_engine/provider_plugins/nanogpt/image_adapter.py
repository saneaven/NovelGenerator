from __future__ import annotations

import base64
from typing import Any

import httpx

from ....image_engine.contracts import ImageGenerationOutput, PreparedImageRequest


NANOGPT_IMAGE_GENERATIONS_URL = "https://nano-gpt.com/v1/images/generations"


def _guess_mime_type(image_data: bytes) -> str:
    if image_data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _bytes_to_data_url(image_data: bytes) -> str:
    mime_type = _guess_mime_type(image_data)
    encoded = base64.b64encode(image_data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _decode_image_item(item: dict[str, Any]) -> tuple[bytes, str] | None:
    b64 = item.get("b64_json")
    if isinstance(b64, str) and b64.strip():
        return base64.b64decode(b64), "png"
    return None


class NanoGPTImageAdapter:
    def __init__(self, provider_config: dict[str, Any]):
        self._api_key = str(provider_config.get("api_key") or "").strip()

    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        if not self._api_key:
            return ImageGenerationOutput(
                success=False,
                error="NanoGPT client not initialized. Check API key.",
            )

        prompt = request.prompt_payload.prompt
        if prompt is None:
            return ImageGenerationOutput(
                success=False,
                error="Prompt is required for NanoGPT image generation.",
            )

        settings = request.provider_settings
        payload: dict[str, Any] = {
            "prompt": f"{prompt.prefix}{prompt.content}{prompt.postfix}",
            "model": request.model_descriptor.id,
            "size": request.resolved_geometry.resolved_native_size,
            "response_format": "b64_json",
            "n": 1,
        }

        if request.reference_images:
            if len(request.reference_images) == 1:
                payload["imageDataUrl"] = _bytes_to_data_url(request.reference_images[0].image_data)
            else:
                payload["imageDataUrls"] = [
                    _bytes_to_data_url(item.image_data)
                    for item in request.reference_images
                ]
        if request.mask_image is not None:
            payload["maskDataUrl"] = _bytes_to_data_url(request.mask_image.image_data)

        for key in ("strength", "guidance_scale", "num_inference_steps", "seed", "kontext_max_mode"):
            value = settings.get(key)
            if value is not None:
                payload[key] = value

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    NANOGPT_IMAGE_GENERATIONS_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            return ImageGenerationOutput(success=False, error=f"NanoGPT API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationOutput(success=False, error=f"Unexpected error: {exc}")

        items = body.get("data")
        if not isinstance(items, list) or not items:
            return ImageGenerationOutput(success=False, error="No image data in NanoGPT response")
        decoded = _decode_image_item(items[0] if isinstance(items[0], dict) else {})
        if decoded is None:
            return ImageGenerationOutput(
                success=False,
                error="NanoGPT response did not include b64 image data",
            )
        image_data, image_format = decoded
        return ImageGenerationOutput(
            success=True,
            image_data=image_data,
            revised_prompt=str(body.get("revised_prompt") or "").strip() or None,
            format=image_format,
        )
