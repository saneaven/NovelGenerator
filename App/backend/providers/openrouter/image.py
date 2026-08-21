from __future__ import annotations

import base64
from typing import Any

import httpx

from ..shared.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from ..shared.image.contracts import ImageGenerationOutput, PreparedImageRequest
from ...schemas.assets import NaturalPromptData
from ...utils.outbound_http import filter_additional_headers


OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
OPENROUTER_DEFAULT_RATIOS = (
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
)
OPENROUTER_DEFAULT_IMAGE_SIZES = ("1K", "2K", "4K")
OPENROUTER_IMAGE_MODEL_OVERRIDES: dict[str, dict[str, list[str]]] = {
    "google/gemini-3.1-flash-image-preview": {
        "supported_aspect_ratios": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"],
        "supported_image_sizes": ["512px", "1K", "2K", "4K"],
    },
    "google/gemini-3-pro-image-preview": {
        "supported_aspect_ratios": ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
        "supported_image_sizes": ["1K", "2K", "4K"],
    },
}


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


class OpenRouterImageAdapter:
    def __init__(self, provider_config: dict[str, Any]):
        self._api_key = str(provider_config.get("api_key") or "").strip()
        self._additional_headers = filter_additional_headers(provider_config.get("additional_headers"))

    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        if not self._api_key:
            return ImageGenerationOutput(success=False, error="OpenRouter client not initialized. Check API key.")

        prompt_data = request.prompt_payload.prompt_data
        if not isinstance(prompt_data, NaturalPromptData):
            return ImageGenerationOutput(
                success=False,
                error="Natural prompt data is required for OpenRouter image generation.",
            )
        prompt = prompt_data.prompt

        try:
            message_content: list[dict[str, Any]] = [
                {
                    "type": "text",
                    "text": f"{prompt.prefix}{prompt.content}{prompt.postfix}",
                }
            ]
            for reference in request.reference_images:
                message_content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": _bytes_to_data_url(reference.image_data)},
                    }
                )

            output_modalities = (
                request.model_descriptor.architecture.get("output_modalities")
                if isinstance(request.model_descriptor.architecture, dict)
                else None
            )
            modalities = ["image", "text"] if isinstance(output_modalities, list) and "text" in output_modalities else ["image"]
            payload = {
                "model": request.model_descriptor.id,
                "messages": [{"role": "user", "content": message_content}],
                "modalities": modalities,
                "image_config": {
                    "aspect_ratio": request.resolved_geometry.resolved_aspect_ratio,
                    "image_size": request.resolved_geometry.resolved_image_size,
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
            return ImageGenerationOutput(success=False, error=f"OpenRouter API error: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationOutput(success=False, error=f"Unexpected error: {exc}")

        if image_result is None:
            return ImageGenerationOutput(success=False, error="No image data in OpenRouter response")

        return ImageGenerationOutput(
            success=True,
            image_data=image_result["image_data"],
            revised_prompt=image_result.get("text"),
            width=None,
            height=None,
            format=image_result.get("format", "png"),
        )

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://novelgenerator.local",
            "X-Title": "NovelGenerator",
        }
        headers.update(self._additional_headers)
        return headers

    async def _parse_response(self, client: httpx.AsyncClient, payload: dict[str, Any]) -> dict[str, Any] | None:
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

    async def _extract_image_payload(self, client: httpx.AsyncClient, message: dict[str, Any]) -> dict[str, Any] | None:
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

    async def _extract_image_item(self, client: httpx.AsyncClient, item: Any) -> dict[str, Any] | None:
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
            return {"image_data": base64.b64decode(str(item["b64_json"])), "format": "png"}
        if isinstance(item.get("data"), str):
            data = str(item["data"])
            if data.startswith("data:"):
                image_data = _decode_data_url(data)
                return {
                    "image_data": image_data,
                    "format": _guess_mime_type(image_data).split("/", 1)[1],
                }
            return {"image_data": base64.b64decode(data), "format": "png"}
        return None

    async def _read_image_url(self, client: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
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


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return OpenRouterImageAdapter(provider_config)


async def list_models(
    *,
    provider_config: dict[str, Any],
    runtime_spec: Any,
    models_adapter: str,
) -> list[ImageModelDescriptor]:
    del runtime_spec
    if models_adapter != "dynamic":
        raise ValueError(f"Unknown OpenRouter image models adapter '{models_adapter}'")

    api_key = str(provider_config.get("api_key") or "").strip()
    if not api_key:
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://novelbuds.local",
        "X-Title": "Novel Buds",
    }
    additional_headers = provider_config.get("additional_headers")
    if isinstance(additional_headers, dict):
        for key, value in additional_headers.items():
            if isinstance(key, str) and isinstance(value, str):
                headers[key] = value

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
    response.raise_for_status()
    payload = response.json()
    models = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(models, list):
        return []

    out: list[ImageModelDescriptor] = []
    for raw_model in models:
        if not isinstance(raw_model, dict):
            continue
        model_id = str(raw_model.get("id") or "").strip()
        if not model_id:
            continue
        architecture = raw_model.get("architecture") if isinstance(raw_model.get("architecture"), dict) else None
        input_modalities = [str(item).strip().lower() for item in architecture.get("input_modalities", [])] if architecture else []
        output_modalities = [str(item).strip().lower() for item in architecture.get("output_modalities", [])] if architecture else []
        if "image" not in output_modalities:
            continue
        geometry = OPENROUTER_IMAGE_MODEL_OVERRIDES.get(model_id, {})
        supported_aspect_ratios = tuple(geometry.get("supported_aspect_ratios", list(OPENROUTER_DEFAULT_RATIOS)))
        supported_image_sizes = tuple(geometry.get("supported_image_sizes", list(OPENROUTER_DEFAULT_IMAGE_SIZES)))
        pricing = raw_model.get("pricing") if isinstance(raw_model.get("pricing"), dict) else None
        out.append(
            ImageModelDescriptor(
                id=model_id,
                name=str(raw_model.get("name") or model_id),
                description=str(raw_model.get("description") or "").strip() or None,
                canonical_slug=str(raw_model.get("canonical_slug") or raw_model.get("slug") or model_id),
                prompt_format="natural",
                supports_image_input="image" in input_modalities,
                geometry=ImageModelGeometrySpec(
                    supported_aspect_ratios=supported_aspect_ratios,
                    supported_resolutions=supported_image_sizes,
                    default_aspect_ratio=supported_aspect_ratios[0],
                    default_resolution=supported_image_sizes[0],
                    resolution_mode="native_tier",
                ),
                architecture={
                    "input_modalities": input_modalities,
                    "output_modalities": output_modalities,
                },
                pricing=pricing,
            )
        )
    out.sort(key=lambda item: item.name.lower())
    return out
