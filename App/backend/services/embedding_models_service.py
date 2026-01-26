from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

_OPENROUTER_DEFAULT_HEADERS: Dict[str, str] = {
    "HTTP-Referer": "https://novelbuds.local",
    "X-Title": "Novel Buds",
}

_OPENAI_EMBEDDING_ALLOWLIST = [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
]


def _normalize_base_url(url: str) -> str:
    return (url or "").rstrip("/")


async def _http_get_json(*, url: str, headers: Dict[str, str], timeout_s: float = 30.0) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"Request failed ({resp.status_code}): {resp.text}")
        return resp.json()


def _filter_models_by_substring(models: List[Dict[str, Any]], *, needles: List[str]) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    for m in models:
        if not isinstance(m, dict):
            continue
        mid = m.get("id")
        name = m.get("name")
        if not isinstance(mid, str):
            continue
        hay = f"{mid} {name or ''}".lower()
        if any(n in hay for n in needles):
            filtered.append(m)
    return filtered


async def list_embedding_models(*, provider: str, config: Dict[str, Any]) -> Dict[str, Any]:
    provider = (provider or "").strip().lower()
    api_key = (config.get("api_key") or "").strip()
    base_url = _normalize_base_url((config.get("base_url") or "").strip())
    additional_headers: Optional[Dict[str, str]] = config.get("additional_headers")

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if additional_headers:
        headers.update({k: v for k, v in additional_headers.items() if isinstance(k, str) and isinstance(v, str)})

    if provider == "openrouter":
        url = f"{base_url or 'https://openrouter.ai/api/v1'}/embeddings/models"
        # Keep parity with existing OpenRouter provider defaults.
        headers = {**headers, **_OPENROUTER_DEFAULT_HEADERS}
        if additional_headers:
            headers.update({k: v for k, v in additional_headers.items() if isinstance(k, str) and isinstance(v, str)})
        return await _http_get_json(url=url, headers=headers)

    if provider == "openai":
        url = f"{base_url or 'https://api.openai.com/v1'}/models"
        data = await _http_get_json(url=url, headers=headers)
        items = data.get("data")
        if not isinstance(items, list):
            return {"data": []}

        # Prefer a stable allowlist (docs-known models) but fall back to substring matching if needed.
        allowed = {m for m in _OPENAI_EMBEDDING_ALLOWLIST}
        selected = [m for m in items if isinstance(m, dict) and m.get("id") in allowed]
        if not selected:
            selected = _filter_models_by_substring(items, needles=["embedding", "embed"])
        return {"data": [{"id": m.get("id")} for m in selected if isinstance(m, dict) and isinstance(m.get("id"), str)]}

    if provider == "gemini":
        # Stable, documented embedding model (2026-01-26): gemini-embedding-001
        return {"data": [{"id": "gemini-embedding-001", "name": "Gemini: Embedding 001"}]}

    if provider == "custom":
        if not base_url:
            raise ValueError("Missing base_url for provider 'custom'")

        url = f"{base_url}/models"
        try:
            data = await _http_get_json(url=url, headers=headers)
        except Exception:
            # Custom endpoints vary wildly; treat as unsupported and keep manual input working.
            return {"data": []}

        items = data.get("data")
        if not isinstance(items, list):
            return {"data": []}

        filtered = _filter_models_by_substring(items, needles=["embedding", "embed"])
        return {"data": filtered}

    raise ValueError(f"Embedding model listing is not supported for provider '{provider}'")


__all__ = ["list_embedding_models"]
