from __future__ import annotations

from copy import deepcopy
from typing import Any

from pydantic import ValidationError

from ..schemas.settings import TaskAIConfig, TaskAIConfigOverride, TaskConfigSettings


TASK_CONFIG_TASK_TYPES: tuple[str, ...] = (
    "agent",
    "translation",
    "editAssistant",
    "imagePrompt",
    "summary",
    "subAgent",
)

INITIAL_TASK_CONFIG_SETTINGS_FOR_NEW_USER: dict[str, Any] = {
    "general": {
        "provider": "openrouter",
        "model": "gpt-5-mini",
        "temperature": 0.7,
        "max_output_tokens": None,
        "context_window_tokens": 32000,
        "advanced": {
            "thinking_mode": "off",
            "thinking_config": {"effort": "medium"},
        },
    },
    "overrides": {},
}


def make_initial_task_config_settings() -> dict[str, Any]:
    return deepcopy(INITIAL_TASK_CONFIG_SETTINGS_FOR_NEW_USER)


def _deep_merge(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = deepcopy(base)
        for key, value in override.items():
            if key in merged:
                merged[key] = _deep_merge(merged[key], value)
            else:
                merged[key] = deepcopy(value)
        return merged
    return deepcopy(override)


def _prune_empty_dicts(value: Any) -> Any:
    if isinstance(value, dict):
        pruned: dict[str, Any] = {}
        for key, child in value.items():
            child_pruned = _prune_empty_dicts(child)
            if isinstance(child_pruned, dict) and not child_pruned:
                continue
            pruned[key] = child_pruned
        return pruned
    if isinstance(value, list):
        return [deepcopy(item) for item in value]
    return deepcopy(value)


def _diff_values(base: Any, effective: Any) -> Any:
    if isinstance(base, dict) and isinstance(effective, dict):
        patch: dict[str, Any] = {}
        for key in sorted(set(base.keys()) | set(effective.keys())):
            if key not in effective:
                patch[key] = None
                continue
            if key not in base:
                patch[key] = deepcopy(effective[key])
                continue

            child = _diff_values(base[key], effective[key])
            if child is not _NO_DIFF:
                patch[key] = child
        return patch if patch else _NO_DIFF

    if base == effective:
        return _NO_DIFF
    return deepcopy(effective)


class _NoDiff:
    pass


_NO_DIFF = _NoDiff()


def normalize_effective_task_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(config)

    provider = normalized.get("provider")
    advanced = normalized.get("advanced")
    if not isinstance(advanced, dict):
        advanced = {}
    else:
        advanced = deepcopy(advanced)

    thinking_mode = advanced.get("thinking_mode")
    request_format = advanced.get("request_format")

    if provider != "openrouter":
        normalized.pop("provider_preference", None)

    if provider not in {"openrouter", "custom"}:
        advanced.pop("tokenizer_override", None)

    if provider != "custom":
        advanced.pop("request_format", None)
        advanced.pop("custom_thinking_template_id", None)
    else:
        if request_format != "openai_sdk":
            advanced.pop("custom_thinking_template_id", None)

    if thinking_mode != "model":
        advanced.pop("thinking_config", None)
        advanced.pop("custom_thinking_template_id", None)

    if provider != "openai" and not (provider == "custom" and request_format == "openai_responses"):
        advanced.pop("verbosity", None)

    normalized["advanced"] = advanced
    return normalized


def diff_task_override(general: dict[str, Any], effective: dict[str, Any]) -> dict[str, Any]:
    general_normalized = normalize_effective_task_config(general)
    effective_normalized = normalize_effective_task_config(effective)
    patch = _diff_values(general_normalized, effective_normalized)
    if patch is _NO_DIFF:
        return {}
    if not isinstance(patch, dict):
        raise ValueError("Task config override diff must be an object")
    return _prune_empty_dicts(patch)


def _validate_effective_task_config_semantics(config: dict[str, Any]) -> None:
    provider = config.get("provider")
    advanced = config.get("advanced")
    if not isinstance(advanced, dict):
        raise ValueError("Task config advanced settings must be an object")

    if provider == "custom" and not advanced.get("request_format"):
        raise ValueError("Custom provider task configs must include advanced.request_format")


def validate_task_config_settings(task_config_settings: dict[str, Any]) -> dict[str, Any]:
    try:
        TaskConfigSettings.model_validate(task_config_settings)
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc

    normalized = normalize_task_config_settings(task_config_settings)

    try:
        TaskAIConfig.model_validate(normalized["general"])
    except ValidationError as exc:
        raise ValueError(f"Invalid general task config: {exc}") from exc
    _validate_effective_task_config_semantics(normalized["general"])

    for task_type in TASK_CONFIG_TASK_TYPES:
        try:
            resolved = resolve_task_config(normalized, task_type)
            TaskAIConfig.model_validate(resolved)
        except ValidationError as exc:
            raise ValueError(f"Invalid task config for {task_type}: {exc}") from exc
        _validate_effective_task_config_semantics(resolved)

    return normalized


def normalize_task_config_settings(task_config_settings: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(task_config_settings, dict):
        raise ValueError("taskConfigSettings must be an object")

    general = task_config_settings.get("general")
    overrides = task_config_settings.get("overrides", {})

    if not isinstance(general, dict):
        raise ValueError("taskConfigSettings.general must be an object")
    if not isinstance(overrides, dict):
        raise ValueError("taskConfigSettings.overrides must be an object")

    normalized_general = normalize_effective_task_config(general)
    normalized_overrides: dict[str, dict[str, Any]] = {}

    for task_type, override in overrides.items():
        if task_type not in TASK_CONFIG_TASK_TYPES:
            raise ValueError(f"Unknown task type override: {task_type}")
        if not isinstance(override, dict):
            raise ValueError(f"Override for {task_type} must be an object")

        try:
            TaskAIConfigOverride.model_validate(override)
        except ValidationError as exc:
            raise ValueError(f"Invalid override for {task_type}: {exc}") from exc

        effective = normalize_effective_task_config(_deep_merge(normalized_general, override))
        normalized_overrides[task_type] = diff_task_override(normalized_general, effective)

    return {
        "general": normalized_general,
        "overrides": normalized_overrides,
    }


def resolve_task_config(task_config_settings: dict[str, Any], task_type: str) -> dict[str, Any]:
    if task_type not in TASK_CONFIG_TASK_TYPES:
        raise ValueError(f"Unknown task type: {task_type}")

    normalized = normalize_task_config_settings(task_config_settings)
    override = normalized["overrides"].get(task_type, {})
    effective = _deep_merge(normalized["general"], override)
    return normalize_effective_task_config(effective)


def resolve_all_task_configs(task_config_settings: dict[str, Any]) -> dict[str, dict[str, Any]]:
    normalized = normalize_task_config_settings(task_config_settings)
    return {
        task_type: resolve_task_config(normalized, task_type)
        for task_type in TASK_CONFIG_TASK_TYPES
    }
