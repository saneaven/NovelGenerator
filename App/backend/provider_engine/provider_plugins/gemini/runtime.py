from __future__ import annotations

from typing import Any


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....providers.llm.gemini_provider import GeminiProvider

    return GeminiProvider(provider_config)


async def list_embedding_models(*, provider_config: dict[str, Any], runtime_spec: Any) -> dict[str, Any]:
    del provider_config, runtime_spec
    return {"data": [{"id": "gemini-embedding-001", "name": "Gemini: Embedding 001"}]}


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
    del timeout_s, runtime_spec, dimensions
    from google import genai
    from google.genai import types

    if not inputs:
        return []
    api_key = str(provider_config.get("api_key") or "").strip()
    if not api_key:
        raise ValueError("Missing api_key for provider 'gemini'")

    client = genai.Client(api_key=api_key, http_options=None)
    task_type = "RETRIEVAL_QUERY" if purpose == "query" else "RETRIEVAL_DOCUMENT"
    vectors: list[list[float]] = []
    for i in range(0, len(inputs), 64):
        batch = inputs[i : i + 64]
        resp = await client.aio.models.embed_content(
            model=model,
            contents=batch,
            config=types.EmbedContentConfig(task_type=task_type),
        )
        for item in resp.embeddings:
            values = getattr(item, "values", None)
            if not isinstance(values, list):
                raise RuntimeError("Gemini embedding response missing 'values' list")
            vectors.append([float(x) for x in values])
    if len(vectors) != len(inputs):
        raise RuntimeError("Embedding response size mismatch")
    return vectors


def create_image_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del provider_config, runtime_spec
    raise NotImplementedError("create_image_runtime is no longer supported for Gemini image")


def create_image_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from .image_adapter import GeminiImageAdapter

    return GeminiImageAdapter(provider_config)
