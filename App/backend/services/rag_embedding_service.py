from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx


def _default_base_url_for_provider(provider: str) -> str:
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    # custom must provide base_url
    return ""


def _normalize_base_url(url: str) -> str:
    return url.rstrip("/")


async def embed_many(
    *,
    provider: str,
    model: str,
    inputs: List[str],
    config: Dict[str, Any],
    timeout_s: float = 60.0,
) -> List[List[float]]:
    if not inputs:
        return []

    api_key = (config.get("api_key") or "").strip()
    base_url = (config.get("base_url") or "").strip() or _default_base_url_for_provider(provider)
    base_url = _normalize_base_url(base_url)
    additional_headers: Optional[Dict[str, str]] = config.get("additional_headers")

    if not base_url:
        raise ValueError(f"Missing base_url for provider '{provider}'")
    if not api_key:
        raise ValueError(f"Missing api_key for provider '{provider}'")

    headers: Dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if additional_headers:
        headers.update({k: v for k, v in additional_headers.items() if isinstance(v, str)})

    # Simple batching to avoid provider limits (conservative default)
    max_batch = 64
    vectors: List[List[float]] = []

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for i in range(0, len(inputs), max_batch):
            batch = inputs[i : i + max_batch]
            payload: Dict[str, Any] = {
                "model": model,
                "input": batch,
            }

            resp = await client.post(f"{base_url}/embeddings", headers=headers, json=payload)
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

