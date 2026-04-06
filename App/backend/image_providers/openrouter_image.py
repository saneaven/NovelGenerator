"""OpenRouter image generation provider."""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

import httpx

from .base import BaseImageProvider, ImageGenerationResult, MaskImageData, ReferenceImageData
from .registry import ImageProviderRegistry
from ..services.image_model_catalog_service import image_model_catalog_service
from ..utils.outbound_http import filter_additional_headers


OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"


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


def _decode_data_url(url: str) -> bytes:
    _, encoded = url.split(",", 1)
    return base64.b64decode(encoded)


def _extract_message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""

    texts: list[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            texts.append(str(part["text"]))
    return "\n".join(texts).strip()


@ImageProviderRegistry.register
class OpenRouterImageProvider(BaseImageProvider):
    """OpenRouter multimodal image generation provider."""

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def display_name(self) -> str:
        return "OpenRouter Image"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def supports_image_input(self) -> bool:
        return True

    async def get_models(self) -> Dict:
        return {
            "data": await image_model_catalog_service.list_models("openrouter", self.config),
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "",
        size: str = "1024x1024",
        aspect_ratio: str = "1:1",
        image_size: str = "1K",
        resolved_native_size: str = "1K",
        quality: str = "auto",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict[str, Any]] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
        mask_image: Optional[MaskImageData] = None,
    ) -> ImageGenerationResult:
        del size, quality, n, positive_prompt, negative_prompt, mask_image

        if not self.validate_config():
            return ImageGenerationResult(success=False, error="OpenRouter client not initialized. Check API key.")
        if not prompt:
            return ImageGenerationResult(success=False, error="Prompt is required for OpenRouter image generation.")

        try:
            message_content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
            for reference in reference_images or []:
                message_content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": _bytes_to_data_url(reference.image_data)},
                    }
                )

            modalities = await self._resolve_modalities(model)
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": message_content,
                    }
                ],
                "modalities": modalities,
                "image_config": {
                    "aspect_ratio": aspect_ratio,
                    "image_size": image_size,
                },
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    OPENROUTER_CHAT_COMPLETIONS_URL,
                    headers=self._build_headers(),
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
                image_result = await self._parse_response(client, body)
        except httpx.HTTPError as exc:
            return ImageGenerationResult(success=False, error=f"OpenRouter API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationResult(success=False, error=f"Unexpected error: {exc}")

        if image_result is None:
            return ImageGenerationResult(success=False, error="No image data in OpenRouter response")

        return ImageGenerationResult(
            success=True,
            image_data=image_result["image_data"],
            revised_prompt=image_result.get("text"),
            width=None,
            height=None,
            format=image_result.get("format", "png"),
        )

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://novelgenerator.local",
            "X-Title": "NovelGenerator",
        }
        headers.update(filter_additional_headers(self.config.get("additional_headers")))
        return headers

    async def _resolve_modalities(self, model: str) -> list[str]:
        records = await image_model_catalog_service.list_models("openrouter", self.config)
        matched = next((record for record in records if str(record.get("id")) == model), None)
        output_modalities = matched.get("architecture", {}).get("output_modalities") if isinstance(matched, dict) else None
        if isinstance(output_modalities, list) and "text" in output_modalities:
            return ["image", "text"]
        return ["image"]

    async def _parse_response(
        self,
        client: httpx.AsyncClient,
        payload: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(message, dict):
            return None

        extracted = await self._extract_image_payload(client, message)
        if extracted is None:
            return None
        extracted["text"] = _extract_message_text(message) or None
        return extracted

    async def _extract_image_payload(
        self,
        client: httpx.AsyncClient,
        message: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        images = message.get("images")
        if isinstance(images, list):
            for image in images:
                extracted = await self._extract_image_item(client, image)
                if extracted is not None:
                    return extracted

        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                extracted = await self._extract_image_item(client, part)
                if extracted is not None:
                    return extracted

        return None

    async def _extract_image_item(
        self,
        client: httpx.AsyncClient,
        item: Any,
    ) -> Optional[dict[str, Any]]:
        if not isinstance(item, dict):
            return None

        image_url = item.get("image_url")
        if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
            return await self._read_image_url(client, str(image_url["url"]))
        if isinstance(image_url, str):
            return await self._read_image_url(client, image_url)

        if isinstance(item.get("url"), str):
            return await self._read_image_url(client, str(item["url"]))

        if isinstance(item.get("b64_json"), str):
            return {
                "image_data": base64.b64decode(str(item["b64_json"])),
                "format": "png",
            }

        if isinstance(item.get("data"), str):
            data = str(item["data"])
            if data.startswith("data:"):
                image_data = _decode_data_url(data)
                return {"image_data": image_data, "format": _guess_mime_type(image_data).split("/", 1)[1]}
            return {"image_data": base64.b64decode(data), "format": "png"}

        return None

    async def _read_image_url(self, client: httpx.AsyncClient, url: str) -> Optional[dict[str, Any]]:
        if url.startswith("data:"):
            image_data = _decode_data_url(url)
            return {
                "image_data": image_data,
                "format": _guess_mime_type(image_data).split("/", 1)[1],
            }

        response = await client.get(url)
        response.raise_for_status()
        image_data = response.content
        mime_type = response.headers.get("content-type") or _guess_mime_type(image_data)
        image_format = mime_type.split("/", 1)[1] if "/" in mime_type else "png"
        return {"image_data": image_data, "format": image_format}
