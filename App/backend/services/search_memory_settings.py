from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

from pydantic import ValidationError

from ..provider_engine.registry import require_provider
from ..schemas.settings import (
    MemoryConfig,
    SearchGeneralConfig,
    SearchMemorySettings,
)


SearchMemoryTarget = Literal["search", "memory"]


INITIAL_SEARCH_MEMORY_SETTINGS: dict[str, Any] = {
    "enabled": False,
    "general": {
        "embedding": {
            "provider": "openai",
            "model": "",
            "dimensions": None,
        },
        "retrieval": {
            "topKPerQuery": 20,
            "neighborWindow": 0,
            "maxPrimaryItems": 20,
            "maxTotalItems": 60,
        },
        "keywordPageSize": 20,
    },
    "overrides": {},
}


def make_initial_search_memory_settings() -> dict[str, Any]:
    return deepcopy(INITIAL_SEARCH_MEMORY_SETTINGS)


def _normalize_search_memory_settings(search_memory_settings: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(search_memory_settings, dict):
        raise ValueError("searchMemorySettings must be an object")

    try:
        validated = SearchMemorySettings.model_validate(search_memory_settings)
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc

    normalized = validated.model_dump(mode="json")
    if not isinstance(normalized.get("overrides"), dict):
        normalized["overrides"] = {}
    return normalized


def _normalize_general_config(config: dict[str, Any]) -> dict[str, Any]:
    validated = SearchGeneralConfig.model_validate(config)
    return validated.model_dump(mode="json")


def _normalize_memory_config(config: dict[str, Any]) -> dict[str, Any]:
    validated = MemoryConfig.model_validate(config)
    return validated.model_dump(mode="json")


def make_search_override_seed(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = validate_search_memory_settings(settings)
    return deepcopy(normalized["general"])


def make_memory_override_seed(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = validate_search_memory_settings(settings)
    general = normalized["general"]
    return {
        "embedding": deepcopy(general["embedding"]),
        "retrieval": deepcopy(general["retrieval"]),
    }


def has_search_memory_override(settings: dict[str, Any], target: SearchMemoryTarget) -> bool:
    normalized = validate_search_memory_settings(settings)
    overrides = normalized.get("overrides", {})
    return isinstance(overrides, dict) and isinstance(overrides.get(target), dict)


def _resolve_search_settings_from_validated(settings: dict[str, Any]) -> dict[str, Any]:
    override = settings["overrides"].get("search")
    if isinstance(override, dict):
        return deepcopy(_normalize_general_config(override))
    return deepcopy(settings["general"])


def resolve_search_settings(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = validate_search_memory_settings(settings)
    return _resolve_search_settings_from_validated(normalized)


def _resolve_memory_settings_from_validated(settings: dict[str, Any]) -> dict[str, Any]:
    override = settings["overrides"].get("memory")
    if isinstance(override, dict):
        return deepcopy(_normalize_memory_config(override))
    general = settings["general"]
    return {
        "embedding": deepcopy(general["embedding"]),
        "retrieval": deepcopy(general["retrieval"]),
    }


def resolve_memory_settings(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = validate_search_memory_settings(settings)
    return _resolve_memory_settings_from_validated(normalized)


def validate_search_memory_settings(search_memory_settings: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_search_memory_settings(search_memory_settings)

    if normalized.get("enabled"):
        search = _resolve_search_settings_from_validated(normalized)
        memory = _resolve_memory_settings_from_validated(normalized)
        checks = (
            ("Search", search["embedding"]),
            ("Memory", memory["embedding"]),
        )
        for label, embedding in checks:
            provider = str(embedding.get("provider") or "").strip()
            model = str(embedding.get("model") or "").strip()
            provider_spec = require_provider(provider)
            if provider_spec.embedding is None:
                raise ValueError(f"{label} embedding provider '{provider}' is not supported")
            if not provider or not model:
                raise ValueError(f"{label} embedding provider/model is required when Search & Memory is enabled")

    return normalized


def clear_dimensions_for_target(settings: dict[str, Any], target: SearchMemoryTarget) -> dict[str, Any]:
    normalized = validate_search_memory_settings(settings)
    overrides = normalized.setdefault("overrides", {})
    if target == "search" and isinstance(overrides.get("search"), dict):
        overrides["search"]["embedding"]["dimensions"] = None
        return normalized
    if target == "memory" and isinstance(overrides.get("memory"), dict):
        overrides["memory"]["embedding"]["dimensions"] = None
        return normalized
    normalized["general"]["embedding"]["dimensions"] = None
    return normalized


__all__ = [
    "SearchMemoryTarget",
    "clear_dimensions_for_target",
    "has_search_memory_override",
    "make_initial_search_memory_settings",
    "make_memory_override_seed",
    "make_search_override_seed",
    "resolve_memory_settings",
    "resolve_search_settings",
    "validate_search_memory_settings",
]
