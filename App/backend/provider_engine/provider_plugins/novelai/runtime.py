from __future__ import annotations

from typing import Any


def create_image_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....image_providers.novelai_image import NovelAIImageProvider

    return NovelAIImageProvider(provider_config)
