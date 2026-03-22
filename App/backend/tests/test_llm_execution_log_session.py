from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path
from types import SimpleNamespace

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

    fake_llm_log_service = types.ModuleType("App.backend.services.llm_log_service")
    fake_llm_log_service.llm_log_service = SimpleNamespace(
        create_log=lambda **_kwargs: "log-1",
        reset_log=lambda *_args, **_kwargs: None,
        complete_log=lambda *_args, **_kwargs: None,
        fail_log=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.llm_log_service"] = fake_llm_log_service

    fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
    fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
    sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")]
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution


_install_import_stubs()

log_session_module = importlib.import_module("App.backend.services.run_pipeline.llm_execution.log_session")


def test_log_session_creates_resets_and_completes(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []
    fake_service = SimpleNamespace(
        create_log=lambda **kwargs: calls.append(("create", kwargs)) or "log-1",
        reset_log=lambda log_id, **kwargs: calls.append(("reset", {"log_id": log_id, **kwargs})),
        complete_log=lambda log_id, **kwargs: calls.append(("complete", {"log_id": log_id, **kwargs})),
        fail_log=lambda log_id, **kwargs: calls.append(("fail", {"log_id": log_id, **kwargs})),
    )
    clock = iter([10.0, 13.0, 17.0])

    monkeypatch.setattr(log_session_module, "llm_log_service", fake_service)
    monkeypatch.setattr(log_session_module.time, "monotonic", lambda: next(clock))

    session = log_session_module.LLMLogSession(
        enabled=True,
        user_id="user-1",
        project_id="project-1",
        provider="custom",
        model="model-a",
    )

    session.on_request({"attempt": 1})
    session.on_request({"attempt": 2})
    session.complete({"ok": True})

    assert calls[0] == (
        "create",
        {
            "user_id": "user-1",
            "project_id": "project-1",
            "provider": "custom",
            "model": "model-a",
            "raw_input": {"attempt": 1},
        },
    )
    assert calls[1] == ("reset", {"log_id": "log-1", "raw_input": {"attempt": 2}})
    assert calls[2] == (
        "complete",
        {
            "log_id": "log-1",
            "raw_output": {"ok": True},
            "meta": {"response_time_ms": 4000},
        },
    )


def test_log_session_fail_includes_partial_content_and_usage(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []
    fake_service = SimpleNamespace(
        create_log=lambda **_kwargs: "log-2",
        reset_log=lambda *_args, **_kwargs: None,
        complete_log=lambda *_args, **_kwargs: None,
        fail_log=lambda log_id, **kwargs: calls.append(("fail", {"log_id": log_id, **kwargs})),
    )
    clock = iter([5.0, 6.25])

    monkeypatch.setattr(log_session_module, "llm_log_service", fake_service)
    monkeypatch.setattr(log_session_module.time, "monotonic", lambda: next(clock))

    session = log_session_module.LLMLogSession(
        enabled=True,
        user_id="user-1",
        project_id="project-1",
        provider="custom",
        model="model-a",
    )

    session.on_request({"attempt": 1})
    session.fail(
        "stream blew up",
        content_parts=[{"type": "content", "text": "partial"}],
        merged_meta=SimpleNamespace(usage={"completion_tokens": 9}),
    )

    assert calls == [
        (
            "fail",
            {
                "log_id": "log-2",
                "raw_output": {
                    "content_parts": [{"type": "content", "text": "partial"}],
                    "usage": {"completion_tokens": 9},
                },
                "error": "stream blew up",
                "meta": {"response_time_ms": 1250},
            },
        )
    ]
