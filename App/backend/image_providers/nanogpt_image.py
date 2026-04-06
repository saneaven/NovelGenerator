from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

import httpx

from .base import BaseImageProvider, ImageGenerationResult, MaskImageData, ReferenceImageData
from .registry import ImageProviderRegistry
from ..services.image_model_catalog_service import image_model_catalog_service


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


@ImageProviderRegistry.register
class NanoGPTImageProvider(BaseImageProvider):
    @property
    def name(self) -> str:
        return "nanogpt"

    @property
    def display_name(self) -> str:
        return "NanoGPT Image"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def supports_image_input(self) -> bool:
        return True

    async def get_models(self) -> Dict:
        return {
            "data": await image_model_catalog_service.list_models("nanogpt", self.config),
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "",
        size: str = "1024x1024",
        aspect_ratio: str = "1:1",
        image_size: str = "1K",
        resolved_native_size: str = "1024x1024",
        quality: str = "auto",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict[str, Any]] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
        mask_image: Optional[MaskImageData] = None,
    ) -> ImageGenerationResult:
        del size, aspect_ratio, image_size, quality, n, positive_prompt, negative_prompt

        if not self.validate_config():
            return ImageGenerationResult(success=False, error="NanoGPT client not initialized. Check API key.")
        if not prompt:
            return ImageGenerationResult(success=False, error="Prompt is required for NanoGPT image generation.")

        settings = provider_settings or {}
        payload: dict[str, Any] = {
            "prompt": prompt,
            "model": model,
            "size": resolved_native_size,
            "response_format": "b64_json",
            "n": 1,
        }

        if reference_images:
            if len(reference_images) == 1:
                payload["imageDataUrl"] = _bytes_to_data_url(reference_images[0].image_data)
            else:
                payload["imageDataUrls"] = [_bytes_to_data_url(item.image_data) for item in reference_images]
        if mask_image is not None:
            payload["maskDataUrl"] = _bytes_to_data_url(mask_image.image_data)

        for key in ("strength", "guidance_scale", "num_inference_steps", "seed", "kontext_max_mode"):
            value = settings.get(key)
            if value is not None:
                payload[key] = value

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    NANOGPT_IMAGE_GENERATIONS_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as exc:
            return ImageGenerationResult(success=False, error=f"NanoGPT API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationResult(success=False, error=f"Unexpected error: {exc}")

        items = body.get("data")
        if not isinstance(items, list) or not items:
            return ImageGenerationResult(success=False, error="No image data in NanoGPT response")
        decoded = _decode_image_item(items[0] if isinstance(items[0], dict) else {})
        if decoded is None:
            return ImageGenerationResult(success=False, error="NanoGPT response did not include b64 image data")
        image_data, image_format = decoded
        return ImageGenerationResult(
            success=True,
            image_data=image_data,
            revised_prompt=str(body.get("revised_prompt") or "").strip() or None,
            format=image_format,
        )
