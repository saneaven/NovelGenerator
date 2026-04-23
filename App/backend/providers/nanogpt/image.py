from __future__ import annotations

import base64
import math
from typing import Any

import httpx

from ..shared.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from ..shared.image.contracts import ImageGenerationOutput, PreparedImageRequest


NANOGPT_BASE_URL = "https://nano-gpt.com"
NANOGPT_IMAGE_MODELS_URL = f"{NANOGPT_BASE_URL}/api/v1/image-models"
NANOGPT_IMAGE_GENERATIONS_URL = "https://nano-gpt.com/v1/images/generations"


def _headers(provider_config: dict[str, Any], *, allow_missing_api_key: bool = False) -> dict[str, str]:
    api_key = str(provider_config.get("api_key") or "").strip()
    if not api_key and not allow_missing_api_key:
        raise ValueError("Missing api_key for provider 'nanogpt'")
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _normalize_ratio_text(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return "1:1"
    for sep in (":", "/", "x"):
        if sep not in text:
            continue
        left, right = text.split(sep, 1)
        try:
            width = int(float(left.strip()))
            height = int(float(right.strip()))
        except ValueError:
            return "1:1"
        if width <= 0 or height <= 0:
            return "1:1"
        divisor = math.gcd(width, height) or 1
        return f"{width // divisor}:{height // divisor}"
    return "1:1"


def _ratio_from_size(size: str) -> str:
    text = str(size or "").strip().lower()
    if "x" not in text:
        return "1:1"
    left, right = text.split("x", 1)
    try:
        width = int(left)
        height = int(right)
    except ValueError:
        return "1:1"
    divisor = math.gcd(width, height) or 1
    return f"{width // divisor}:{height // divisor}"


def _image_geometry_from_model(raw_model: dict[str, Any]) -> ImageModelGeometrySpec:
    supported_parameters = raw_model.get("supported_parameters") if isinstance(raw_model.get("supported_parameters"), dict) else {}
    raw_resolutions = supported_parameters.get("resolutions")
    raw_aspect_ratios = supported_parameters.get("aspect_ratios")

    resolutions = tuple(
        str(item).strip()
        for item in raw_resolutions
        if isinstance(item, str) and str(item).strip()
    ) if isinstance(raw_resolutions, list) else ()
    aspect_ratios = tuple(
        _normalize_ratio_text(str(item))
        for item in raw_aspect_ratios
        if isinstance(item, str) and str(item).strip()
    ) if isinstance(raw_aspect_ratios, list) else ()

    exact_sizes = tuple(item for item in resolutions if "x" in item.lower())
    if exact_sizes:
        ratio_map: dict[str, list[str]] = {}
        ordered_ratios: list[str] = []
        for size in exact_sizes:
            ratio = _ratio_from_size(size)
            ratio_map.setdefault(ratio, []).append(size)
            if ratio not in ordered_ratios:
                ordered_ratios.append(ratio)
        return ImageModelGeometrySpec(
            supported_aspect_ratios=tuple(ordered_ratios or ("1:1",)),
            supported_resolutions=exact_sizes,
            default_aspect_ratio=ordered_ratios[0] if ordered_ratios else "1:1",
            default_resolution=exact_sizes[0],
            resolution_mode="native_exact",
            supported_geometry_pairs={key: tuple(value) for key, value in ratio_map.items()},
        )

    if aspect_ratios and resolutions:
        return ImageModelGeometrySpec(
            supported_aspect_ratios=aspect_ratios,
            supported_resolutions=resolutions,
            default_aspect_ratio=aspect_ratios[0],
            default_resolution=resolutions[0],
            resolution_mode="native_tier",
            supported_geometry_pairs={ratio: resolutions for ratio in aspect_ratios},
        )

    fallback = "1024x1024"
    return ImageModelGeometrySpec(
        supported_aspect_ratios=("1:1",),
        supported_resolutions=(fallback,),
        default_aspect_ratio="1:1",
        default_resolution=fallback,
        resolution_mode="native_exact",
        supported_geometry_pairs={"1:1": (fallback,)},
    )


def _to_image_model(raw_model: dict[str, Any]) -> ImageModelDescriptor | None:
    model_id = str(raw_model.get("id") or "").strip()
    if not model_id:
        return None
    architecture = raw_model.get("architecture") if isinstance(raw_model.get("architecture"), dict) else None
    capabilities = raw_model.get("capabilities") if isinstance(raw_model.get("capabilities"), dict) else None
    supported_parameters = raw_model.get("supported_parameters") if isinstance(raw_model.get("supported_parameters"), dict) else None
    input_modalities = [
        str(item).strip().lower()
        for item in (architecture.get("input_modalities") if isinstance(architecture, dict) else []) or []
        if isinstance(item, str)
    ]
    max_images = supported_parameters.get("max_images") if isinstance(supported_parameters, dict) else None
    supports_multi_image_input = isinstance(max_images, int) and max_images > 1
    supports_mask_input = bool((capabilities or {}).get("inpainting") or (capabilities or {}).get("mask"))
    supports_image_input = bool((capabilities or {}).get("image_to_image")) or "image" in input_modalities or supports_multi_image_input or supports_mask_input
    tags = tuple(str(item).strip() for item in (raw_model.get("tags") or []) if isinstance(item, str) and str(item).strip())
    return ImageModelDescriptor(
        id=model_id,
        name=str(raw_model.get("name") or model_id),
        description=str(raw_model.get("description") or "").strip() or None,
        canonical_slug=str(raw_model.get("canonical_slug") or raw_model.get("slug") or model_id),
        owned_by=str(raw_model.get("owned_by") or "").strip() or None,
        icon_url=str(raw_model.get("icon_url") or "").strip() or None,
        tags=tags or None,
        category=str(raw_model.get("category") or "").strip() or None,
        prompt_type="natural",
        supports_image_input=supports_image_input,
        supports_mask_input=supports_mask_input,
        supports_multi_image_input=supports_multi_image_input,
        geometry=_image_geometry_from_model(raw_model),
        architecture=architecture,
        pricing=raw_model.get("pricing") if isinstance(raw_model.get("pricing"), dict) else None,
        capabilities=capabilities,
        supported_parameters=supported_parameters,
    )


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
            return ImageGenerationOutput(success=False, error="NanoGPT client not initialized. Check API key.")

        prompt = request.prompt_payload.prompt
        if prompt is None:
            return ImageGenerationOutput(success=False, error="Prompt is required for NanoGPT image generation.")

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
                payload["imageDataUrls"] = [_bytes_to_data_url(item.image_data) for item in request.reference_images]
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
            return ImageGenerationOutput(success=False, error="NanoGPT response did not include b64 image data")
        image_data, image_format = decoded
        return ImageGenerationOutput(
            success=True,
            image_data=image_data,
            revised_prompt=str(body.get("revised_prompt") or "").strip() or None,
            format=image_format,
        )


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return NanoGPTImageAdapter(provider_config)


async def list_models(
    *,
    provider_config: dict[str, Any],
    runtime_spec: Any,
    models_adapter: str,
) -> list[ImageModelDescriptor]:
    del runtime_spec
    if models_adapter != "dynamic":
        raise ValueError(f"Unknown NanoGPT image models adapter '{models_adapter}'")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            NANOGPT_IMAGE_MODELS_URL,
            headers=_headers(provider_config, allow_missing_api_key=True),
            params={"detailed": "true"},
        )
    response.raise_for_status()
    payload = response.json()
    models: list[ImageModelDescriptor] = []
    for item in _extract_items(payload):
        normalized = _to_image_model(item)
        if normalized is not None:
            models.append(normalized)
    models.sort(key=lambda item: item.name.lower())
    return models
