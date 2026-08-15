from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from App.backend.services import demo_runtime
from App.backend.services.settings_service import settings_service


GLOBAL_TASK_CONFIG_SETTINGS = {
    "general": {
        "provider": "openrouter",
        "model": "global-model",
        "temperature": 0.7,
        "max_output_tokens": None,
        "context_window_tokens": 32000,
        "advanced": {"thinking_mode": "off"},
    },
    "overrides": {},
}

OVERRIDE_CONFIG = {
    "provider": "openai",
    "model": "override-model",
    "temperature": 0.2,
    "max_output_tokens": None,
    "context_window_tokens": 64000,
    "advanced": {"thinking_mode": "off"},
}


def _sub_agent(*, use_custom: bool, override: dict | None) -> SimpleNamespace:
    return SimpleNamespace(
        agent_name="researcher",
        use_custom_llm_config=use_custom,
        llm_config_override=override,
    )


@pytest.fixture(autouse=True)
def _stub_settings(monkeypatch) -> None:
    monkeypatch.setattr(
        settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: SimpleNamespace(demo_mode_enabled=False),
    )
    monkeypatch.setattr(
        settings_service,
        "get_task_config_settings",
        lambda *_args, **_kwargs: GLOBAL_TASK_CONFIG_SETTINGS,
    )


def test_sub_agent_override_wins_over_global_config() -> None:
    resolved = settings_service.get_task_config(
        object(), "user", "subAgent", sub_agent=_sub_agent(use_custom=True, override=OVERRIDE_CONFIG)
    )

    assert resolved.provider == "openai"
    assert resolved.model == "override-model"
    assert resolved.temperature == 0.2
    assert resolved.context_window_tokens == 64000


def test_sub_agent_without_custom_config_uses_global_config() -> None:
    resolved = settings_service.get_task_config(
        object(), "user", "subAgent", sub_agent=_sub_agent(use_custom=False, override=OVERRIDE_CONFIG)
    )

    assert resolved.provider == "openrouter"
    assert resolved.model == "global-model"


def test_no_sub_agent_uses_global_config() -> None:
    resolved = settings_service.get_task_config(object(), "user", "subAgent")

    assert resolved.provider == "openrouter"
    assert resolved.model == "global-model"


def test_custom_config_without_override_raises() -> None:
    with pytest.raises(ValueError, match="llm_config_override"):
        settings_service.get_task_config(
            object(), "user", "subAgent", sub_agent=_sub_agent(use_custom=True, override=None)
        )


def test_demo_mode_wins_over_sub_agent_override(monkeypatch) -> None:
    monkeypatch.setattr(
        settings_service,
        "_get_settings",
        lambda *_args, **_kwargs: SimpleNamespace(demo_mode_enabled=True),
    )
    monkeypatch.setenv("DEMO_MODE_OPENROUTER_API_KEY", "demo-key")
    monkeypatch.setenv("DEMO_MODE_OPENROUTER_MODEL", "demo-model")
    demo_runtime.reset_demo_runtime_config_cache()

    try:
        resolved = settings_service.get_task_config(
            object(), "user", "subAgent", sub_agent=_sub_agent(use_custom=True, override=OVERRIDE_CONFIG)
        )
    finally:
        demo_runtime.reset_demo_runtime_config_cache()

    assert resolved.provider == "openrouter"
    assert resolved.model == "demo-model"
