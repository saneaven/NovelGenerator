from __future__ import annotations

from typing import Any, Dict, List, Literal

from ..providers.registry import embed_many as _embed_many


async def embed_many(
    *,
    provider: str,
    model: str,
    inputs: List[str],
    config: Dict[str, Any],
    dimensions: int | None = None,
    purpose: Literal["query", "document"] = "document",
    timeout_s: float = 60.0,
) -> List[List[float]]:
    return await _embed_many(
        provider,
        provider_config=config,
        model=model,
        inputs=inputs,
        dimensions=dimensions,
        purpose=purpose,
        timeout_s=timeout_s,
    )
