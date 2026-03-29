from __future__ import annotations

from typing import Any, Dict

from ..provider_engine.runtime_dispatch import list_embedding_models as _list_embedding_models


async def list_embedding_models(*, provider: str, config: Dict[str, Any]) -> Dict[str, Any]:
    return await _list_embedding_models(provider, config)


__all__ = ["list_embedding_models"]
