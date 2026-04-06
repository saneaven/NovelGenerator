from __future__ import annotations

import math
from typing import Any, Dict

import httpx

from ...contracts import ImageModelDescriptor, ImageModelGeometrySpec


NANOGPT_BASE_URL = "https://nano-gpt.com"
NANOGPT_PERSONALIZED_MODELS_URL = f"{NANOGPT_BASE_URL}/api/personalized/v1/models"
NANOGPT_EMBEDDING_MODELS_URL = f"{NANOGPT_BASE_URL}/api/v1/embedding-models"
NANOGPT_EMBEDDINGS_URL = f"{NANOGPT_BASE_URL}/api/v1/embeddings"
NANOGPT_IMAGE_MODELS_URL = f"{NANOGPT_BASE_URL}/api/v1/image-models"


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


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....providers.llm.nanogpt_provider import NanoGPTProvider

    return NanoGPTProvider(provider_config)


async def list_embedding_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            NANOGPT_EMBEDDING_MODELS_URL,
            headers=_headers(provider_config, allow_missing_api_key=True),
        )
    response.raise_for_status()
    payload = response.json()
    return {"data": _extract_items(payload)}


async def embed_many(
    *,
    provider_config: dict[str, Any],
    model: str,
    inputs: list[str],
    dimensions: int | None,
    purpose: str,
    timeout_s: float,
    runtime_spec: Any,
) -> list[list[float]]:
    del purpose, runtime_spec
    if not inputs:
        return []

    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for index in range(0, len(inputs), 64):
            batch = inputs[index:index + 64]
            payload: dict[str, Any] = {
                "model": model,
                "input": batch,
                "encoding_format": "float",
            }
            if isinstance(dimensions, int) and dimensions > 0:
                payload["dimensions"] = dimensions
            response = await client.post(
                NANOGPT_EMBEDDINGS_URL,
                headers=_headers(provider_config),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            items = data.get("data")
            if not isinstance(items, list):
                raise RuntimeError("Embedding response missing 'data' list")
            for item in items:
                embedding = item.get("embedding") if isinstance(item, dict) else None
                if not isinstance(embedding, list):
                    raise RuntimeError("Embedding item missing 'embedding' list")
                vectors.append([float(value) for value in embedding])
    if len(vectors) != len(inputs):
        raise RuntimeError("Embedding response size mismatch")
    return vectors


def create_image_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....image_providers.nanogpt_image import NanoGPTImageProvider

    return NanoGPTImageProvider(provider_config)


async def list_image_models(*, provider_config: dict[str, Any], runtime_spec: Any, models_adapter: str) -> list[ImageModelDescriptor]:
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
