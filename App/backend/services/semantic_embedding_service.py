from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import httpx

from ..utils.outbound_http import filter_additional_headers, validate_outbound_base_url


def _default_base_url_for_provider(provider: str) -> str:
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    # custom must provide base_url
    return ""


def _normalize_base_url(url: str) -> str:
    return url.rstrip("/")


def _gemini_task_type(purpose: Literal["query", "document"]) -> str:
    # https://ai.google.dev/gemini-api/docs/embeddings
    # - RETRIEVAL_QUERY for queries
    # - RETRIEVAL_DOCUMENT for documents being retrieved
    return "RETRIEVAL_QUERY" if purpose == "query" else "RETRIEVAL_DOCUMENT"


async def embed_many(
    *,
    provider: str,
    model: str,
    inputs: List[str],
    config: Dict[str, Any],
    purpose: Literal["query", "document"] = "document",
    timeout_s: float = 60.0,
) -> List[List[float]]:
    if not inputs:
        return []

    api_key = (config.get("api_key") or "").strip()
    base_url_raw = (config.get("base_url") or "").strip()
    additional_headers = filter_additional_headers(config.get("additional_headers"))

    if not api_key:
        raise ValueError(f"Missing api_key for provider '{provider}'")

    provider = (provider or "").strip().lower()

    if provider == "gemini":
        from google import genai
        from google.genai import types

        # Do not allow user-controlled base_url for official providers (SSRF hardening).
        http_options = None
        client = genai.Client(api_key=api_key, http_options=http_options)

        max_batch = 64
        vectors: List[List[float]] = []

        for i in range(0, len(inputs), max_batch):
            batch = inputs[i : i + max_batch]
            resp = await client.aio.models.embed_content(
                model=model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=_gemini_task_type(purpose)),
            )
            for item in resp.embeddings:
                values = getattr(item, "values", None)
                if not isinstance(values, list):
                    raise RuntimeError("Gemini embedding response missing 'values' list")
                vectors.append([float(x) for x in values])

        if len(vectors) != len(inputs):
            raise RuntimeError("Embedding response size mismatch")

        return vectors

    if provider == "custom":
        if not base_url_raw:
            raise ValueError("Missing base_url for provider 'custom'")
        base_url = _normalize_base_url(validate_outbound_base_url(base_url_raw))
    else:
        # Official providers: ignore user-supplied base_url.
        base_url = _normalize_base_url(_default_base_url_for_provider(provider))
        if not base_url:
            raise ValueError(f"Unsupported provider '{provider}'")

    headers: Dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider == "custom" and additional_headers:
        headers.update(additional_headers)

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
