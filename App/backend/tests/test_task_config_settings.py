from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.task_config_settings import (
    make_initial_task_config_settings,
    diff_task_override,
    resolve_task_config,
    validate_task_config_settings,
)


def _load_migration_module():
    if "alembic" not in sys.modules:
        alembic_module = types.ModuleType("alembic")
        alembic_module.op = types.SimpleNamespace()
        sys.modules["alembic"] = alembic_module

    if "sqlalchemy" not in sys.modules:
        sqlalchemy_module = types.ModuleType("sqlalchemy")
        sqlalchemy_module.Column = lambda *args, **kwargs: ("Column", args, kwargs)
        sqlalchemy_module.Text = lambda *args, **kwargs: ("Text", args, kwargs)
        sqlalchemy_module.text = lambda value: value
        dialects_module = types.ModuleType("sqlalchemy.dialects")
        postgresql_module = types.ModuleType("sqlalchemy.dialects.postgresql")
        postgresql_module.JSONB = lambda *args, **kwargs: ("JSONB", args, kwargs)
        dialects_module.postgresql = postgresql_module
        sqlalchemy_module.dialects = dialects_module
        sys.modules["sqlalchemy"] = sqlalchemy_module
        sys.modules["sqlalchemy.dialects"] = dialects_module
        sys.modules["sqlalchemy.dialects.postgresql"] = postgresql_module

    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0002_task_config_settings_refactor.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0002_task_config_settings_refactor", migration_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_resolve_task_config_deep_merges_nested_advanced_settings() -> None:
    settings = {
        "general": {
            "provider": "openrouter",
            "model": "gpt-5-mini",
            "temperature": 0.7,
            "advanced": {
                "thinking_mode": "model",
                "thinking_config": {"effort": "medium", "max_tokens": 1024},
                "tokenizer_override": "openai",
            },
        },
        "overrides": {
            "summary": {
                "temperature": 0.2,
                "advanced": {
                    "thinking_config": {"max_tokens": 2048},
                },
            },
        },
    }

    resolved = resolve_task_config(settings, "summary")

    assert resolved["provider"] == "openrouter"
    assert resolved["temperature"] == 0.2
    assert resolved["advanced"]["thinking_mode"] == "model"
    assert resolved["advanced"]["thinking_config"] == {"effort": "medium", "max_tokens": 2048}
    assert resolved["advanced"]["tokenizer_override"] == "openai"


def test_diff_task_override_uses_null_to_clear_inherited_values() -> None:
    general = {
        "provider": "openrouter",
        "model": "gpt-5-mini",
        "temperature": 0.7,
        "provider_preference": {"only": ["anthropic"]},
        "advanced": {
            "thinking_mode": "model",
            "thinking_config": {"effort": "medium"},
            "tokenizer_override": "openai",
        },
    }
    effective = {
        "provider": "openai",
        "model": "gpt-5",
        "temperature": 0.7,
        "advanced": {
            "thinking_mode": "off",
        },
    }

    patch = diff_task_override(general, effective)

    assert patch["provider"] == "openai"
    assert patch["model"] == "gpt-5"
    assert patch["provider_preference"] is None
    assert patch["advanced"] == {
        "thinking_mode": "off",
        "thinking_config": None,
        "tokenizer_override": None,
    }


def test_validate_task_config_settings_requires_custom_request_format() -> None:
    with pytest.raises(ValueError, match="advanced.request_format"):
        validate_task_config_settings(
            {
                "general": {
                    "provider": "custom",
                    "model": "gpt-5",
                    "temperature": 0.7,
                    "advanced": {
                        "thinking_mode": "off",
                    },
                },
                "overrides": {},
            }
        )


def test_validate_task_config_settings_preserves_empty_override_entries() -> None:
    normalized = validate_task_config_settings(
        {
            "general": {
                "provider": "openrouter",
                "model": "gpt-5-mini",
                "temperature": 0.7,
                "advanced": {
                    "thinking_mode": "off",
                },
            },
            "overrides": {
                "summary": {},
            },
        }
    )

    assert normalized["overrides"] == {"summary": {}}


def test_make_initial_task_config_settings_is_valid() -> None:
    normalized = validate_task_config_settings(make_initial_task_config_settings())

    assert normalized["general"]["provider"] == "openrouter"
    assert normalized["general"]["model"] == "gpt-5-mini"
    assert normalized["overrides"] == {}


def test_migration_converts_legacy_agent_plus_diffs() -> None:
    migration = _load_migration_module()
    converted = migration._to_new_shape(  # type: ignore[attr-defined]
        {
            "agent": {
                "provider": "openrouter",
                "model": "gpt-5-mini",
                "temperature": 0.7,
                "advanced": {
                    "thinking_mode": "off",
                    "request_format": "openai_sdk",
                },
            },
            "translation": {
                "provider": "openrouter",
                "model": "gpt-5",
                "temperature": 0.2,
                "advanced": {
                    "thinking_mode": "off",
                    "request_format": "openai_sdk",
                },
            },
            "editAssistant": {
                "provider": "openrouter",
                "model": "gpt-5-mini",
                "temperature": 0.7,
                "advanced": {
                    "thinking_mode": "off",
                    "request_format": "openai_sdk",
                },
            },
            "imagePrompt": {
                "provider": "openrouter",
                "model": "gpt-5-mini",
                "temperature": 0.7,
                "advanced": {
                    "thinking_mode": "off",
                    "request_format": "openai_sdk",
                },
            },
            "summary": {
                "provider": "openrouter",
                "model": "gpt-5-mini",
                "temperature": 0.7,
                "advanced": {
                    "thinking_mode": "off",
                    "request_format": "openai_sdk",
                },
            },
            "subAgent": {
                "provider": "openrouter",
                "model": "gpt-5-mini",
                "temperature": 0.7,
                "advanced": {
                    "thinking_mode": "off",
                    "request_format": "openai_sdk",
                },
            },
        }
    )

    assert converted["general"] == {
        "provider": "openrouter",
        "model": "gpt-5-mini",
        "temperature": 0.7,
        "advanced": {
            "thinking_mode": "off",
        },
    }
    assert converted["overrides"] == {
        "translation": {
            "model": "gpt-5",
            "temperature": 0.2,
        }
    }
