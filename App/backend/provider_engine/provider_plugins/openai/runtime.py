from __future__ import annotations

from typing import Any, Dict


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
    del runtime_spec
    from ....image_providers.openai_image import OpenAIImageProvider

    return OpenAIImageProvider(provider_config)
