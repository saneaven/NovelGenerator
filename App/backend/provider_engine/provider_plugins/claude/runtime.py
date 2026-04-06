from __future__ import annotations

from typing import Any


def create_llm_runtime(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    from ....providers.llm.claude_provider import ClaudeProvider

    return ClaudeProvider(provider_config)
