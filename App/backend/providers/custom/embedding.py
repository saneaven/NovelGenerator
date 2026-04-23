from __future__ import annotations

from typing import Any, Dict


async def list_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    from ...utils.outbound_http import filter_additional_headers, validate_outbound_base_url
    from ...utils.template_vars import resolve_and_filter_headers

    base_url_raw = str(provider_config.get("base_url") or "").strip()
    if not base_url_raw:
        raise ValueError("Missing base_url for provider 'custom'")

    api_key = str(provider_config.get("api_key") or "").strip()
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    headers.update(resolve_and_filter_headers(filter_additional_headers(provider_config.get("additional_headers"))))

    base_url = validate_outbound_base_url(base_url_raw).rstrip("/")
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(f"{base_url}/models", headers=headers)
            if response.status_code >= 400:
                return {"data": []}
            data = response.json()
        except Exception:
            return {"data": []}

    items = data.get("data")
    if not isinstance(items, list):
        return {"data": []}

    filtered: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        name = item.get("name")
        if not isinstance(model_id, str):
            continue
        haystack = f"{model_id} {name or ''}".lower()
        if "embedding" in haystack or "embed" in haystack:
            filtered.append(item)
    return {"data": filtered}


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

    from ...utils.outbound_http import filter_additional_headers, validate_outbound_base_url
    from ...utils.template_vars import resolve_and_filter_headers

    if not inputs:
        return []

    base_url_raw = str(provider_config.get("base_url") or "").strip()
    if not base_url_raw:
        raise ValueError("Missing base_url for provider 'custom'")

    api_key = str(provider_config.get("api_key") or "").strip()
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    headers.update(resolve_and_filter_headers(filter_additional_headers(provider_config.get("additional_headers"))))

    base_url = validate_outbound_base_url(base_url_raw).rstrip("/")
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for index in range(0, len(inputs), 64):
            batch = inputs[index:index + 64]
            response = await client.post(
                f"{base_url}/embeddings",
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
