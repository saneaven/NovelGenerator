from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
import types
from uuid import uuid4

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


import App.backend.services.llm_runtime_service as runtime_service


def test_get_llm_runtime_uses_demo_runtime_when_enabled(monkeypatch) -> None:
    demo_task_config = SimpleNamespace(provider="openrouter", model="openai/gpt-5-mini")
    demo_provider_config = {"api_key": "demo-key"}

    monkeypatch.setattr(
        runtime_service.settings_service,
        "get_or_create_settings",
        lambda *_args, **_kwargs: SimpleNamespace(demo_mode_enabled=True),
    )
    monkeypatch.setattr(runtime_service, "build_demo_task_config", lambda: demo_task_config)
    monkeypatch.setattr(runtime_service, "build_demo_provider_config", lambda: demo_provider_config)

    result = runtime_service.get_llm_runtime(object(), user_id=uuid4(), task_type="agent")

    assert result.provider == "openrouter"
    assert result.task_config is demo_task_config
    assert result.provider_config == demo_provider_config


def test_get_llm_runtime_uses_user_settings_when_demo_is_disabled(monkeypatch) -> None:
    task_config = SimpleNamespace(
        provider="custom",
        advanced={"custom_kind": "claude"},
    )

    monkeypatch.setattr(
        runtime_service.settings_service,
        "get_or_create_settings",
        lambda *_args, **_kwargs: SimpleNamespace(demo_mode_enabled=False),
    )
    monkeypatch.setattr(
        runtime_service.settings_service,
        "get_task_config",
        lambda *_args, **_kwargs: task_config,
    )
    monkeypatch.setattr(
        runtime_service.credential_service,
        "get_provider_config",
        lambda *_args, **_kwargs: {"api_key": "user-key"},
    )

    result = runtime_service.get_llm_runtime(object(), user_id=uuid4(), task_type="agent")

    assert result.provider == "custom"
    assert result.task_config is task_config
    assert result.provider_config == {
        "api_key": "user-key",
        "custom_kind": "claude",
    }
