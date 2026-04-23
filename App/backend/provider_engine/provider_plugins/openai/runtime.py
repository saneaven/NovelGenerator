from __future__ import annotations

from math import isqrt
from typing import Any, Dict

from ....image_engine.contracts import ResolvedGeometry

OPENAI_GPT_IMAGE_2_SUPPORTED_IMAGE_SIZES = ("1K", "2K", "4K")
OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY = 16
OPENAI_GPT_IMAGE_2_MAX_EDGE = 3840
OPENAI_GPT_IMAGE_2_TARGET_PIXELS = {
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "4K": 3840 * 2160,
}


_OPENAI_EMBEDDING_ALLOWLIST = [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
]


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....providers.llm.openai_responses_provider import OpenAIResponsesProvider

    return OpenAIResponsesProvider(provider_config)


async def list_embedding_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    api_key = str(provider_config.get("api_key") or "").strip()
    headers: Dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get("https://api.openai.com/v1/models", headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"Request failed ({resp.status_code}): {resp.text}")
        data = resp.json()
    items = data.get("data")
    if not isinstance(items, list):
        return {"data": []}
    selected = [m for m in items if isinstance(m, dict) and m.get("id") in set(_OPENAI_EMBEDDING_ALLOWLIST)]
    if not selected:
        selected = []
        for model in items:
            if not isinstance(model, dict):
                continue
            mid = model.get("id")
            name = model.get("name")
            if not isinstance(mid, str):
                continue
            hay = f"{mid} {name or ''}".lower()
            if "embedding" in hay or "embed" in hay:
                selected.append(model)
    return {"data": [{"id": m.get("id")} for m in selected if isinstance(m.get("id"), str)]}


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
        raise ValueError("Missing api_key for provider 'openai'")

    headers: Dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for i in range(0, len(inputs), 64):
            batch = inputs[i : i + 64]
            resp = await client.post(
                "https://api.openai.com/v1/embeddings",
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
    raise NotImplementedError("create_image_runtime is no longer supported for OpenAI image")


def create_image_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from .image_adapter import OpenAIImageAdapter

    return OpenAIImageAdapter(provider_config)


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a or 1


def _lcm(a: int, b: int) -> int:
    return abs(a * b) // _gcd(a, b)


def _parse_ratio_pair(raw: str) -> tuple[int, int]:
    left, right = str(raw).split(":", 1)
    return int(left), int(right)


def _resolve_openai_native_size(*, aspect_ratio: str, image_size: str) -> str:
    width_ratio, height_ratio = _parse_ratio_pair(aspect_ratio)
    reduced_divisor = _gcd(width_ratio, height_ratio)
    width_ratio //= reduced_divisor
    height_ratio //= reduced_divisor

    target_pixels = OPENAI_GPT_IMAGE_2_TARGET_PIXELS.get(
        image_size,
        OPENAI_GPT_IMAGE_2_TARGET_PIXELS["1K"],
    )
    width_step = OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY // _gcd(
        width_ratio,
        OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY,
    )
    height_step = OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY // _gcd(
        height_ratio,
        OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY,
    )
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
        key=lambda scale: abs(
            (width_ratio * scale * height_ratio * scale) - target_pixels
        ),
    )
    max_scale = (
        OPENAI_GPT_IMAGE_2_MAX_EDGE
        // max(width_ratio, height_ratio)
        // scale_step
    ) * scale_step
    if best_scale > max_scale:
        best_scale = max_scale
    width = width_ratio * best_scale
    height = height_ratio * best_scale
    return f"{width}x{height}"


async def resolve_image_geometry(
    *,
    provider_config: dict[str, Any],
    runtime_spec: Any,
    descriptor: Any,
    requested_aspect_ratio: str,
    requested_image_size: str,
    resolved_geometry: ResolvedGeometry,
) -> ResolvedGeometry:
    del provider_config, runtime_spec, descriptor, requested_aspect_ratio
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
