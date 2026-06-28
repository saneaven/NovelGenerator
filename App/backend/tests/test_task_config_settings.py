from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from App.backend.services.task_config_settings import (
    resolve_task_config,
    validate_task_config_settings,
)
from App.backend.providers.gemini.llm import GeminiProvider
from App.backend.providers.registry import normalize_task_config


def _task_config(
    *,
    provider: str = "openrouter",
    model: str = "gpt-5-mini",
    temperature: float = 0.7,
    provider_preference: dict | None = None,
    max_output_tokens: int | None = None,
    context_window_tokens: int | None = 32000,
    advanced: dict | None = None,
) -> dict:
    config = {
        "provider": provider,
        "model": model,
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
        "context_window_tokens": context_window_tokens,
        "advanced": advanced or {
            "thinking_mode": "off",
            "thinking_config": {"effort": "medium"},
            "tokenizer_override": "openai",
        },
    }
    if provider_preference is not None:
        config["provider_preference"] = provider_preference
    return config


def test_validate_task_config_settings_accepts_general_only() -> None:
    settings = {
        "general": _task_config(provider_preference={"only": ["openai"]}),
        "overrides": {},
    }

    normalized = validate_task_config_settings(settings)

    assert normalized["overrides"] == {}
    assert normalized["general"]["provider"] == "openrouter"
    assert normalized["general"]["provider_preference"] == {"only": ["openai"]}
    assert normalized["general"]["advanced"] == {
        "thinking_mode": "off",
        "tokenizer_override": "openai",
    }


def test_validate_task_config_settings_requires_full_override_objects() -> None:
    settings = {
        "general": _task_config(),
        "overrides": {
            "translation": {
                "provider": "openai",
                "model": "gpt-5-mini",
            },
        },
    }

    with pytest.raises(ValueError, match="overrides.translation.temperature"):
        validate_task_config_settings(settings)


def test_validate_task_config_settings_normalizes_full_override() -> None:
    settings = {
        "general": _task_config(),
        "overrides": {
            "translation": _task_config(
                provider="openai",
                model="gpt-5-mini",
                temperature=0.2,
                provider_preference={"only": ["anthropic"]},
                advanced={
                    "thinking_mode": "off",
                    "tokenizer_override": "claude",
                    "verbosity": "high",
                },
            ),
        },
    }

    normalized = validate_task_config_settings(settings)
    translation = normalized["overrides"]["translation"]

    assert translation["provider"] == "openai"
    assert translation["model"] == "gpt-5-mini"
    assert translation["provider_preference"] == {"only": ["anthropic"]}
    assert translation["advanced"] == {
        "thinking_mode": "off",
        "verbosity": "high",
        "provider_settings": {
            "cache": {
                "enabled": True,
                "retention": "default",
            },
        },
    }


def test_resolve_task_config_prefers_override_and_falls_back_to_general() -> None:
    settings = {
        "general": _task_config(model="general-model"),
        "overrides": {
            "translation": _task_config(
                provider="custom",
                model="translation-model",
                temperature=0.4,
                advanced={
                    "thinking_mode": "model",
                    "custom_kind": "openai_completion",
                    "thinking_config": {"effort": "high"},
                    "custom_thinking_template_id": "tpl_123",
                    "tokenizer_override": "openai",
                },
            ),
        },
    }

    translation = resolve_task_config(settings, "translation")
    agent = resolve_task_config(settings, "agent")

    assert translation["provider"] == "custom"
    assert translation["model"] == "translation-model"
    assert translation["advanced"] == {
        "thinking_mode": "model",
        "custom_kind": "openai_completion",
        "custom_thinking_template_id": "tpl_123",
        "tokenizer_override": "openai",
    }
    assert agent["provider"] == "openrouter"
    assert agent["model"] == "general-model"


def test_resolve_task_config_defaults_custom_kind_for_custom_provider() -> None:
    settings = {
        "general": _task_config(
            provider="custom",
            model="gateway-model",
            advanced={
                "thinking_mode": "model",
                "thinking_config": {"effort": "medium"},
                "custom_thinking_template_id": "tpl_123",
                "tokenizer_override": "openai",
            },
        ),
        "overrides": {},
    }

    resolved = resolve_task_config(settings, "agent")

    assert resolved["advanced"] == {
        "thinking_mode": "model",
        "custom_kind": "openai_completion",
        "custom_thinking_template_id": "tpl_123",
        "tokenizer_override": "openai",
    }


def test_openrouter_reasoning_effort_accepts_supported_model_values() -> None:
    for effort in ("minimal", "low", "medium", "high", "xhigh", "max"):
        normalized = normalize_task_config(
            "openrouter",
            _task_config(
                advanced={
                    "thinking_mode": "model",
                    "thinking_config": {"effort": effort},
                }
            ),
        )

        assert normalized["advanced"]["thinking_config"]["effort"] == effort


def test_openrouter_reasoning_effort_none_is_not_a_model_option() -> None:
    normalized = normalize_task_config(
        "openrouter",
        _task_config(
            advanced={
                "thinking_mode": "model",
                "thinking_config": {"effort": "none"},
            }
        ),
    )

    assert normalized["advanced"]["thinking_config"]["effort"] == "medium"


def test_custom_claude_reasoning_effort_accepts_xhigh() -> None:
    normalized = normalize_task_config(
        "custom",
        _task_config(
            provider="custom",
            model="claude-gateway-model",
            advanced={
                "custom_kind": "claude",
                "thinking_mode": "model",
                "thinking_config": {"effort": "xhigh"},
            },
        ),
    )

    assert normalized["advanced"]["custom_kind"] == "claude"
    assert normalized["advanced"]["thinking_config"]["effort"] == "xhigh"


def test_gemini_three_accepts_medium_thinking_level() -> None:
    normalized = normalize_task_config(
        "gemini",
        _task_config(
            provider="gemini",
            model="gemini-3-pro",
            advanced={
                "thinking_mode": "model",
                "thinking_config": {"gemini_thinking_level": "medium"},
            },
        ),
    )

    assert normalized["advanced"]["thinking_config"]["gemini_thinking_level"] == "medium"

    provider = GeminiProvider({})
    assert provider._build_thinking_config(
        "gemini-3-pro",
        "model",
        {"gemini_thinking_level": "medium"},
    ) == {"includeThoughts": True, "thinkingLevel": "medium"}
