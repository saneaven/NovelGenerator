from __future__ import annotations

from typing import Any


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....providers.llm.xai_provider import XAIProvider

    return XAIProvider(provider_config)


def create_image_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del provider_config, runtime_spec
    raise NotImplementedError("create_image_runtime is no longer supported for xAI image")


def create_image_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from .image_adapter import XAIImageAdapter

    return XAIImageAdapter(provider_config)
