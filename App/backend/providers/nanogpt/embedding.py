from __future__ import annotations

import httpx
from typing import Any


NANOGPT_BASE_URL = "https://nano-gpt.com"
NANOGPT_EMBEDDING_MODELS_URL = f"{NANOGPT_BASE_URL}/api/v1/embedding-models"
NANOGPT_EMBEDDINGS_URL = f"{NANOGPT_BASE_URL}/api/v1/embeddings"


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


async def list_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
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
