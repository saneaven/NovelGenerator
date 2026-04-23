from __future__ import annotations

from copy import deepcopy
from typing import Any

from pydantic import ValidationError

from ..schemas.settings import LLMCacheSettings


INITIAL_LLM_CACHE_SETTINGS: dict[str, Any] = {
    "openai": {
        "enabled": True,
        "retention": "default",
    },
    "claude": {
        "enabled": True,
        "ttl": "5m",
    },
    "gemini": {
        "enabled": True,
        "implicit": True,
        "explicit": True,
        "explicit_ttl_preset": "1h",
    },
    "xai": {
        "enabled": True,
    },
    "nanogpt": {
        "enabled": True,
        "ttl": "5m",
        "stickyProvider": False,
    },
}


def make_initial_llm_cache_settings() -> dict[str, Any]:
    return deepcopy(INITIAL_LLM_CACHE_SETTINGS)


def validate_llm_cache_settings(llm_cache_settings: dict[str, Any] | None) -> dict[str, Any]:
    if llm_cache_settings is None:
        return make_initial_llm_cache_settings()
    if not isinstance(llm_cache_settings, dict):
        raise ValueError("llmCacheSettings must be an object")

    try:
        validated = LLMCacheSettings.model_validate(llm_cache_settings)
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc

    return validated.model_dump(mode="json")


__all__ = [
    "INITIAL_LLM_CACHE_SETTINGS",
    "make_initial_llm_cache_settings",
    "validate_llm_cache_settings",
]
