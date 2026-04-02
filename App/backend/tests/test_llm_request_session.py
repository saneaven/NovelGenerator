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

    fake_request_service = types.ModuleType("App.backend.services.llm_request_service")
    fake_request_service.llm_request_service = SimpleNamespace(
        update_request=lambda *_args, **_kwargs: None,
        on_retry=lambda *_args, **_kwargs: None,
        complete=lambda *_args, **_kwargs: None,
        fail=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.llm_request_service"] = fake_request_service

    fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
    fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
    sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")]
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution


_install_import_stubs()

request_session_module = importlib.import_module("App.backend.services.run_pipeline.llm_execution.request_session")


def test_request_session_tracks_retry_and_complete(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []
    fake_service = SimpleNamespace(
        update_request=lambda request_id, **kwargs: calls.append(("update", {"request_id": request_id, **kwargs})),
        on_retry=lambda request_id, **kwargs: calls.append(("retry", {"request_id": request_id, **kwargs})),
        complete=lambda request_id, **kwargs: calls.append(("complete", {"request_id": request_id, **kwargs})),
        fail=lambda request_id, **kwargs: calls.append(("fail", {"request_id": request_id, **kwargs})),
    )
    clock = iter([10.0, 14.0])

    monkeypatch.setattr(request_session_module, "llm_request_service", fake_service)
    monkeypatch.setattr(request_session_module.time, "monotonic", lambda: next(clock))

    session = request_session_module.LLMRequestSession(
        request_id="req_1",
        user_id="user-1",
        project_id="project-1",
        thread_id="thread-1",
        run_id="run-1",
        assistant_message_id="msg-1",
        provider="custom",
        model="model-a",
        logging_enabled=True,
    )

    session.on_request({"attempt": 1})
    session.on_retry("rate limited", 429)
    session.on_request({"attempt": 2})
    session.complete(
        {"ok": True},
        SimpleNamespace(
            usage={"completion_tokens": 9},
            finish_reason="stop",
            reasoning_tokens=4,
        ),
    )

    assert session.retry_count == 1
    assert calls == [
        ("update", {"request_id": "req_1", "raw_input": {"attempt": 1}}),
        ("retry", {"request_id": "req_1", "error_msg": "rate limited", "error_status": 429}),
        ("update", {"request_id": "req_1", "raw_input": {"attempt": 2}}),
        (
            "complete",
            {
                "request_id": "req_1",
                "raw_output": {"ok": True},
                "meta": {
                    "response_time_ms": 4000,
                    "usage": {"completion_tokens": 9},
                    "finish_reason": "stop",
                    "reasoning_tokens": 4,
                },
            },
        ),
    ]


def test_request_session_respects_logging_disabled(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []
    fake_service = SimpleNamespace(
        update_request=lambda request_id, **kwargs: calls.append(("update", {"request_id": request_id, **kwargs})),
        on_retry=lambda request_id, **kwargs: calls.append(("retry", {"request_id": request_id, **kwargs})),
        complete=lambda request_id, **kwargs: calls.append(("complete", {"request_id": request_id, **kwargs})),
        fail=lambda request_id, **kwargs: calls.append(("fail", {"request_id": request_id, **kwargs})),
    )
    clock = iter([5.0, 6.25])

    monkeypatch.setattr(request_session_module, "llm_request_service", fake_service)
    monkeypatch.setattr(request_session_module.time, "monotonic", lambda: next(clock))

    session = request_session_module.LLMRequestSession(
        request_id="req_2",
        user_id="user-1",
        project_id="project-1",
        thread_id="thread-1",
        run_id="run-1",
        assistant_message_id="msg-1",
        provider="custom",
        model="model-a",
        logging_enabled=False,
    )

    session.on_request({"attempt": 1})
    session.fail(
        "stream blew up",
        content_parts=[{"type": "content", "text": "partial"}],
        merged_meta=SimpleNamespace(usage={"completion_tokens": 9}, finish_reason=None, reasoning_tokens=None),
    )

    assert calls == [
        ("update", {"request_id": "req_2", "raw_input": None}),
        (
            "fail",
            {
                "request_id": "req_2",
                "raw_output": None,
                "error": "stream blew up",
                "meta": {
                    "response_time_ms": 1250,
                    "usage": {"completion_tokens": 9},
                },
            },
        ),
    ]
