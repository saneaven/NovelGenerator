from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from jinja2.exceptions import TemplateSyntaxError, UndefinedError

os.environ.setdefault("DEFAULT_ASSET_QUOTA_BYTES", "0")

from App.backend.models.db_models import RunModel, Thread, UserSettings
from App.backend.services.run_pipeline import service as run_service
from App.backend.services.run_pipeline.contracts import CreateContext
from App.backend.services.template_engine import FragmentNotFoundError, format_template_error


class FakeQuery:
    def __init__(self, result: object) -> None:
        self._result = result

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def first(self) -> object:
        return self._result


class FakeSession:
    def __init__(self, *, run: RunModel, thread: Thread) -> None:
        self._run = run
        self._thread = thread
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def query(self, model: object) -> FakeQuery:
        if model is RunModel:
            return FakeQuery(self._run)
        if model is Thread:
            return FakeQuery(self._thread)
        raise AssertionError(f"Unexpected model query: {model!r}")

    def rollback(self) -> None:
        self.rollbacks += 1

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        self.closed = True

    def refresh(self, _obj: object) -> None:
        return None

    def expire_all(self) -> None:
        return None


class FakeEventDispatcher:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    async def emit_runtime_event(
        self,
        *,
        project_id: object,
        thread_id: object,
        event_name: str,
        data: dict[str, object],
    ) -> dict[str, object]:
        event = {
            "project_id": str(project_id),
            "thread_id": str(thread_id),
            "event_name": event_name,
            "data": data,
        }
        self.events.append(event)
        return event


def _make_run_and_thread() -> tuple[RunModel, Thread]:
    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="running",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        input_payload={},
    )
    run.thread = thread
    return run, thread


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (
            FragmentNotFoundError("fragment:missing/path"),
            "Referenced fragment not found: fragment:missing/path",
        ),
        (
            TemplateSyntaxError("bad syntax", 1),
            format_template_error(TemplateSyntaxError("bad syntax", 1)),
        ),
        (
            UndefinedError("'foo' is undefined"),
            format_template_error(UndefinedError("'foo' is undefined")),
        ),
        (
            RuntimeError("boom"),
            "boom",
        ),
        (
            RuntimeError("   "),
            "Run failed.",
        ),
    ],
)
def test_format_user_run_error(exc: Exception, expected: str) -> None:
    assert run_service._format_user_run_error(exc) == expected


def test_execute_loop_formats_template_errors_for_user(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = _make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: session, event_dispatcher=dispatcher)  # type: ignore[arg-type]

    async def _raise_fragment_not_found(*_args: object, **_kwargs: object) -> object:
        raise FragmentNotFoundError("fragment:missing/path")

    async def _should_not_run_llm(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("run_llm should not be called when prompt assembly fails")

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: UserSettings())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _raise_fragment_not_found)
    monkeypatch.setattr(run_service.llm_executor, "run_llm", _should_not_run_llm)

    asyncio.run(
        pipeline.execute_loop(
            run.id,
            create_ctx=CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert run.error == "Referenced fragment not found: fragment:missing/path"
    assert thread.status == "error"

    error_events = [event for event in dispatcher.events if event["event_name"] in {"run:error", "run:status"}]
    assert len(error_events) == 3
    assert error_events[0]["data"] == {"run_id": str(run.id), "status": "running", "thread_type": "agent"}
    assert error_events[1]["data"] == {
        "run_id": str(run.id),
        "error": "Referenced fragment not found: fragment:missing/path",
    }
    assert error_events[2]["data"] == {
        "run_id": str(run.id),
        "status": "error",
        "error": "Referenced fragment not found: fragment:missing/path",
    }


def test_execute_loop_preserves_non_template_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = _make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: session, event_dispatcher=dispatcher)  # type: ignore[arg-type]

    async def _raise_runtime_error(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("boom")

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _raise_runtime_error)

    asyncio.run(
        pipeline.execute_loop(
            run.id,
            create_ctx=CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert run.error == "boom"
    assert thread.status == "error"

    run_error_event = next(event for event in dispatcher.events if event["event_name"] == "run:error")
    run_status_event = dispatcher.events[-1]
    assert run_error_event["data"] == {"run_id": str(run.id), "error": "boom"}
    assert run_status_event["event_name"] == "run:status"
    assert run_status_event["data"] == {"run_id": str(run.id), "status": "error", "error": "boom"}
