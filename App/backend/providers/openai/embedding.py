from __future__ import annotations

from typing import Any, Dict


_OPENAI_EMBEDDING_ALLOWLIST = [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
]


async def list_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    api_key = str(provider_config.get("api_key") or "").strip()
    headers: Dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get("https://api.openai.com/v1/models", headers=headers)
        if response.status_code >= 400:
            raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")
        data = response.json()

    items = data.get("data")
    if not isinstance(items, list):
        return {"data": []}

    allowlist = set(_OPENAI_EMBEDDING_ALLOWLIST)
    selected = [item for item in items if isinstance(item, dict) and item.get("id") in allowlist]
    if not selected:
        selected = []
        for model in items:
            if not isinstance(model, dict):
                continue
            model_id = model.get("id")
            name = model.get("name")
            if not isinstance(model_id, str):
                continue
            haystack = f"{model_id} {name or ''}".lower()
            if "embedding" in haystack or "embed" in haystack:
                selected.append(model)

    return {"data": [{"id": item.get("id")} for item in selected if isinstance(item.get("id"), str)]}


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
        for index in range(0, len(inputs), 64):
            batch = inputs[index:index + 64]
            response = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers=headers,
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
