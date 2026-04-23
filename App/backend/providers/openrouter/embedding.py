from __future__ import annotations

from typing import Any, Dict


def _build_headers(provider_config: dict[str, Any]) -> Dict[str, str]:
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
    return headers


async def list_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            "https://openrouter.ai/api/v1/embeddings/models",
            headers=_build_headers(provider_config),
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")
        return response.json()


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

    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for index in range(0, len(inputs), 64):
            batch = inputs[index:index + 64]
            response = await client.post(
                "https://openrouter.ai/api/v1/embeddings",
                headers=_build_headers(provider_config),
                json={k: v for k, v in {
                    "model": model,
                    "input": batch,
                    "dimensions": dimensions,
                }.items() if v is not None},
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Embedding request failed ({response.status_code}): {response.text}")
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
