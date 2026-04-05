from __future__ import annotations

from typing import Any, Dict


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    adapter = str(runtime_spec.adapter)
    if adapter not in {"openai_completion", "openai_response", "claude"}:
        raise ValueError(f"Unknown custom llm runtime '{adapter}'")
    from ....providers.custom import CustomProvider

    return CustomProvider({**provider_config, "custom_kind": adapter})


async def list_embedding_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del runtime_spec
    import httpx

    from ....utils.outbound_http import filter_additional_headers, validate_outbound_base_url
    from ....utils.template_vars import resolve_and_filter_headers

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
            resp = await client.get(f"{base_url}/models", headers=headers)
            if resp.status_code >= 400:
                return {"data": []}
            data = resp.json()
        except Exception:
            return {"data": []}
    items = data.get("data")
    if not isinstance(items, list):
        return {"data": []}
    filtered: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        mid = item.get("id")
        name = item.get("name")
        if not isinstance(mid, str):
            continue
        hay = f"{mid} {name or ''}".lower()
        if "embedding" in hay or "embed" in hay:
            filtered.append(item)
    return {"data": filtered}


async def embed_many(
    *,
    provider_config: dict[str, Any],
    model: str,
    inputs: list[str],
    purpose: str,
    timeout_s: float,
    runtime_spec: Any,
) -> list[list[float]]:
    del purpose, runtime_spec
    import httpx

    from ....utils.outbound_http import filter_additional_headers, validate_outbound_base_url
    from ....utils.template_vars import resolve_and_filter_headers

    if not inputs:
        return []

    base_url_raw = str(provider_config.get("base_url") or "").strip()
    if not base_url_raw:
        raise ValueError("Missing base_url for provider 'custom'")

    api_key = str(provider_config.get("api_key") or "").strip()
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    headers.update(resolve_and_filter_headers(filter_additional_headers(provider_config.get("additional_headers"))))

    base_url = validate_outbound_base_url(base_url_raw).rstrip("/")
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for i in range(0, len(inputs), 64):
            batch = inputs[i : i + 64]
            resp = await client.post(
                f"{base_url}/embeddings",
                headers=headers,
                json={"model": model, "input": batch},
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
