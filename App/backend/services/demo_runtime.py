from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from .settings_service import TaskConfig

ThinkingEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]


@dataclass(frozen=True)
class DemoRuntimeConfig:
    api_key: str
    model: str
    context_window_tokens: int
    max_output_tokens: int | None
    temperature: float
    thinking_mode: Literal["off", "model"]
    thinking_effort: ThinkingEffort | None


def _require_env(name: str) -> str:
    value = str(os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def _parse_int(name: str, default: int) -> int:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return default
    value = int(raw)
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than 0")
    return value


def _parse_optional_int(name: str) -> int | None:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return None
    value = int(raw)
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than 0 when set")
    return value


def _parse_float(name: str, default: float) -> float:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return default
    value = float(raw)
    if value < 0 or value > 2:
        raise RuntimeError(f"{name} must be between 0 and 2")
    return value


def _parse_thinking_mode(name: str, default: Literal["off", "model"]) -> Literal["off", "model"]:
    raw = str(os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    if raw not in {"off", "model"}:
        raise RuntimeError(f"{name} must be 'off' or 'model'")
    return raw  # type: ignore[return-value]


def _parse_thinking_effort(name: str, default: ThinkingEffort) -> ThinkingEffort:
    raw = str(os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    if raw not in {"none", "minimal", "low", "medium", "high", "xhigh", "max"}:
        raise RuntimeError(f"{name} must be one of: none, minimal, low, medium, high, xhigh, max")
    return raw  # type: ignore[return-value]


@lru_cache(maxsize=1)
def get_demo_runtime_config() -> DemoRuntimeConfig:
    thinking_mode = _parse_thinking_mode("DEMO_MODE_THINKING_MODE", "off")
    thinking_effort = _parse_thinking_effort("DEMO_MODE_THINKING_EFFORT", "medium") if thinking_mode == "model" else None
    return DemoRuntimeConfig(
        api_key=_require_env("DEMO_MODE_OPENROUTER_API_KEY"),
        model=_require_env("DEMO_MODE_OPENROUTER_MODEL"),
        context_window_tokens=_parse_int("DEMO_MODE_CONTEXT_WINDOW_TOKENS", 32000),
        max_output_tokens=_parse_optional_int("DEMO_MODE_MAX_OUTPUT_TOKENS"),
        temperature=_parse_float("DEMO_MODE_TEMPERATURE", 0.7),
        thinking_mode=thinking_mode,
        thinking_effort=thinking_effort,
    )


def reset_demo_runtime_config_cache() -> None:
    get_demo_runtime_config.cache_clear()


def build_demo_task_config() -> TaskConfig:
    config = get_demo_runtime_config()
    advanced: dict[str, object] = {"thinking_mode": config.thinking_mode}
    if config.thinking_mode == "model":
        advanced["thinking_config"] = {"effort": config.thinking_effort or "medium"}

    return TaskConfig(
        provider="openrouter",
        model=config.model,
        temperature=config.temperature,
        provider_preference=None,
        max_output_tokens=config.max_output_tokens,
        context_window_tokens=config.context_window_tokens,
        advanced=advanced,
    )


def build_demo_provider_config() -> dict[str, str]:
    config = get_demo_runtime_config()
    return {"api_key": config.api_key}
