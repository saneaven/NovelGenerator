from __future__ import annotations

from typing import Any, Dict

from ...contracts import ImageModelDescriptor, ImageModelGeometrySpec


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


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....providers.llm.openrouter import OpenRouterProvider

    return OpenRouterProvider(provider_config)


async def list_embedding_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    api_key = str(provider_config.get("api_key") or "").strip()
    headers: Dict[str, str] = {
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
        resp = await client.get("https://openrouter.ai/api/v1/embeddings/models", headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"Request failed ({resp.status_code}): {resp.text}")
        return resp.json()


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
    import httpx

    if not inputs:
        return []
    api_key = str(provider_config.get("api_key") or "").strip()
    if not api_key:
        raise ValueError("Missing api_key for provider 'openrouter'")

    headers: Dict[str, str] = {
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

    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for i in range(0, len(inputs), 64):
            batch = inputs[i : i + 64]
            resp = await client.post(
                "https://openrouter.ai/api/v1/embeddings",
                headers=headers,
                json={k: v for k, v in {
                    "model": model,
                    "input": batch,
                    "dimensions": dimensions,
                }.items() if v is not None},
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"Embedding request failed ({resp.status_code}): {resp.text}")
            data = resp.json()
            items = data.get("data")
            if not isinstance(items, list):
                raise RuntimeError("Embedding response missing 'data' list")
            for item in items:
                emb = item.get("embedding") if isinstance(item, dict) else None
                if not isinstance(emb, list):
                    raise RuntimeError("Embedding item missing 'embedding' list")
                vectors.append([float(x) for x in emb])
    if len(vectors) != len(inputs):
        raise RuntimeError("Embedding response size mismatch")
    return vectors


def create_image_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del provider_config, runtime_spec
    raise NotImplementedError("create_image_runtime is no longer supported for OpenRouter image")


def create_image_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from .image_adapter import OpenRouterImageAdapter

    return OpenRouterImageAdapter(provider_config)


async def list_image_models(*, provider_config: dict[str, Any], runtime_spec: Any, models_adapter: str) -> list[ImageModelDescriptor]:
    del runtime_spec

    if models_adapter != "dynamic":
        raise ValueError(f"Unknown OpenRouter image models adapter '{models_adapter}'")

    api_key = str(provider_config.get("api_key") or "").strip()
    if not api_key:
        return []

    import httpx

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
                prompt_type="natural",
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
