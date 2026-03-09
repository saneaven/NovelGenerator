from __future__ import annotations

import sys
from pathlib import Path
import types

import pytest
from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database


_install_import_stubs()


from App.backend.services.demo_runtime import (
    build_demo_provider_config,
    build_demo_task_config,
    get_demo_runtime_config,
    reset_demo_runtime_config_cache,
)


def _set_required_demo_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEMO_MODE_OPENROUTER_API_KEY", "demo-key")
    monkeypatch.setenv("DEMO_MODE_OPENROUTER_MODEL", "openai/gpt-5-mini")


def test_demo_runtime_uses_defaults_when_optional_env_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_required_demo_env(monkeypatch)
    monkeypatch.delenv("DEMO_MODE_CONTEXT_WINDOW_TOKENS", raising=False)
    monkeypatch.delenv("DEMO_MODE_MAX_OUTPUT_TOKENS", raising=False)
    monkeypatch.delenv("DEMO_MODE_TEMPERATURE", raising=False)
    monkeypatch.delenv("DEMO_MODE_THINKING_MODE", raising=False)
    monkeypatch.delenv("DEMO_MODE_THINKING_EFFORT", raising=False)
    reset_demo_runtime_config_cache()

    config = get_demo_runtime_config()
    task_config = build_demo_task_config()
    provider_config = build_demo_provider_config()

    assert config.api_key == "demo-key"
    assert config.model == "openai/gpt-5-mini"
    assert config.context_window_tokens == 32000
    assert config.max_output_tokens is None
    assert config.temperature == 0.7
    assert config.thinking_mode == "off"
    assert config.thinking_effort is None
    assert task_config.provider == "openrouter"
    assert task_config.model == "openai/gpt-5-mini"
    assert task_config.context_window_tokens == 32000
    assert task_config.max_output_tokens is None
    assert task_config.advanced["thinking_mode"] == "off"
    assert provider_config == {"api_key": "demo-key"}


def test_demo_runtime_applies_configured_thinking_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_required_demo_env(monkeypatch)
    monkeypatch.setenv("DEMO_MODE_THINKING_MODE", "model")
    monkeypatch.setenv("DEMO_MODE_THINKING_EFFORT", "high")
    reset_demo_runtime_config_cache()

    config = get_demo_runtime_config()
    task_config = build_demo_task_config()

    assert config.thinking_mode == "model"
    assert config.thinking_effort == "high"
    assert task_config.advanced["thinking_mode"] == "model"
    assert task_config.advanced["thinking_config"] == {"effort": "high"}


def test_demo_runtime_requires_key_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEMO_MODE_OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("DEMO_MODE_OPENROUTER_MODEL", raising=False)
    reset_demo_runtime_config_cache()

    with pytest.raises(RuntimeError, match="DEMO_MODE_OPENROUTER_API_KEY must be set"):
        get_demo_runtime_config()
