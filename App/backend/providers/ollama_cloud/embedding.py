from __future__ import annotations

from typing import Any

from .llm import OLLAMA_CLOUD_API_BASE, _extract_model_items, _headers, _project_model_item


async def list_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    api_key = str(provider_config.get("api_key") or "").strip()
    if not api_key:
        raise ValueError("Missing api_key for provider 'ollama_cloud'")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{OLLAMA_CLOUD_API_BASE}/tags", headers=_headers(api_key))
    if response.status_code >= 400:
        raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")

    projected: list[dict[str, Any]] = []
    for item in _extract_model_items(response.json()):
        model = _project_model_item(item)
        if model is not None:
            projected.append(model)
    return {"data": projected}


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
        raise ValueError("Missing api_key for provider 'ollama_cloud'")

    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for index in range(0, len(inputs), 64):
            batch = inputs[index:index + 64]
            payload: dict[str, Any] = {
                "model": model,
                "input": batch,
            }
            if isinstance(dimensions, int) and dimensions > 0:
                payload["dimensions"] = dimensions
            response = await client.post(
                f"{OLLAMA_CLOUD_API_BASE}/embed",
                headers=_headers(api_key),
                json=payload,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Embedding request failed ({response.status_code}): {response.text}")
            data = response.json()
            embeddings = data.get("embeddings")
            if not isinstance(embeddings, list):
                raise RuntimeError("Embedding response missing 'embeddings' list")
            for embedding in embeddings:
                if not isinstance(embedding, list):
                    raise RuntimeError("Embedding item must be a list")
                vectors.append([float(value) for value in embedding])

    if len(vectors) != len(inputs):
        raise RuntimeError("Embedding response size mismatch")
    return vectors

