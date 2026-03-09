from __future__ import annotations

import asyncio
import os
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from jinja2.exceptions import TemplateSyntaxError, UndefinedError

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")

from App.backend.models.db_models import RunModel, Thread, UserSettings
from App.backend.providers.contracts import DeltaPayload, FinalToolCall
from App.backend.providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.run_pipeline import service as run_service
from App.backend.services.run_pipeline.contracts import CreateContext
from App.backend.services.template_engine import FragmentNotFoundError, format_template_error
from App.backend.services.tool_engine.contracts import ToolOffer
from App.backend.services.tool_engine.result_utils import invalid_result, valid_result


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


class FakePersistSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.flushes = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushes += 1
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()
            if getattr(obj, "created_at", None) is None:
                obj.created_at = datetime.utcnow()
            if getattr(obj, "updated_at", None) is None:
                obj.updated_at = datetime.utcnow()


def _make_pipeline() -> tuple[run_service.RunPipeline, FakeEventDispatcher]:
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: None, event_dispatcher=dispatcher)  # type: ignore[arg-type]
    return pipeline, dispatcher


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
    monkeypatch.setattr(run_service, "recalculate_project_usage", lambda *_args, **_kwargs: None)

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
    monkeypatch.setattr(run_service, "recalculate_project_usage", lambda *_args, **_kwargs: None)

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


def test_persist_tool_calls_uses_parsed_arguments_for_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline, dispatcher = _make_pipeline()
    db = FakePersistSession()

    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="running", next_message_seq=1)
    run = RunModel(id=uuid4(), thread_id=thread.id, user_id=thread.user_id, project_id=thread.project_id, status="running", language="English", next_message_seq=1)
    assistant_message = run_service.RunMessageModel(id=uuid4(), thread_id=thread.id, run_id=run.id, role="assistant", seq=0, seq_in_thread=0, data={})
    offer = ToolOffer(tool_set_name="agent_agent_mode", specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})
    seen_args: dict[str, object] = {}

    async def _validate_tool_call(*, args, **_kwargs):
        seen_args["value"] = args
        return valid_result()

    monkeypatch.setattr(run_service.tool_engine, "validate_tool_call", _validate_tool_call)
    monkeypatch.setattr(run_service, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    tool_calls = [
        FinalToolCall(
            id="call_1",
            tool_name="call_character_planner",
            raw_arguments='{"input":"Create a profile"}',
            arguments={"input": "Create a profile"},
            parse_error=None,
        )
    ]

    rows = asyncio.run(
        pipeline._persist_tool_calls(
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            offer=offer,
            preset_id=uuid4(),
        )
    )

    assert seen_args["value"] == {"input": "Create a profile"}
    assert rows[0].arguments == {"input": "Create a profile"}
    assert rows[0].status == "pending"
    assert any(event["event_name"] == "tool_call:end" for event in dispatcher.events)


def test_persist_tool_calls_surfaces_parse_error_before_schema_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline, _dispatcher = _make_pipeline()
    db = FakePersistSession()

    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="running", next_message_seq=1)
    run = RunModel(id=uuid4(), thread_id=thread.id, user_id=thread.user_id, project_id=thread.project_id, status="running", language="English", next_message_seq=1)
    assistant_message = run_service.RunMessageModel(id=uuid4(), thread_id=thread.id, run_id=run.id, role="assistant", seq=0, seq_in_thread=0, data={})
    offer = ToolOffer(tool_set_name="agent_agent_mode", specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})

    async def _validate_tool_call(**_kwargs):
        raise AssertionError("validate_tool_call should not run when parse_error exists")

    monkeypatch.setattr(run_service.tool_engine, "validate_tool_call", _validate_tool_call)
    monkeypatch.setattr(run_service, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    tool_calls = [
        FinalToolCall(
            id="call_1",
            tool_name="call_character_planner",
            raw_arguments='"{\\"input\\":\\"bad\\"}"',
            arguments={},
            parse_error="Tool arguments JSON string did not decode to an object",
        )
    ]

    rows = asyncio.run(
        pipeline._persist_tool_calls(
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            offer=offer,
            preset_id=uuid4(),
        )
    )

    assert rows[0].status == "failed"
    assert rows[0].reason == "[parse_tool_call_arguments] Tool arguments JSON string did not decode to an object"
    assert "Missing required parameter" not in str(rows[0].reason)


def test_persist_tool_calls_with_mixed_id_index_deltas_does_not_create_unknown_tool_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, _dispatcher = _make_pipeline()
    db = FakePersistSession()

    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="running", next_message_seq=1)
    run = RunModel(id=uuid4(), thread_id=thread.id, user_id=thread.user_id, project_id=thread.project_id, status="running", language="English", next_message_seq=1)
    assistant_message = run_service.RunMessageModel(id=uuid4(), thread_id=thread.id, run_id=run.id, role="assistant", seq=0, seq_in_thread=0, data={})
    offer = ToolOffer(tool_set_name="agent_agent_mode", specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})

    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "create_story_object",
                        "arguments": '{"name":"Elena"',
                    },
                }
            ]
        )
    )
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "function": {
                        "arguments": ',"type":"character"',
                    },
                }
            ]
        )
    )
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "arguments": ',"content":"Profile"}',
                    },
                }
            ]
        )
    )
    snapshot = assembler.finalize_or_raise()
    seen_tool_names: list[str] = []

    async def _validate_tool_call(*, tool_name, args, **_kwargs):
        seen_tool_names.append(str(tool_name))
        if not tool_name:
            return invalid_result("validate_tool_is_in_offer", "Tool not available in this session: ")
        if args.get("type") is None:
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                "Missing required parameter: type",
            )
        return valid_result()

    monkeypatch.setattr(run_service.tool_engine, "validate_tool_call", _validate_tool_call)
    monkeypatch.setattr(run_service, "apply_project_usage_deltas", lambda *_args, **_kwargs: None)

    rows = asyncio.run(
        pipeline._persist_tool_calls(
            db,  # type: ignore[arg-type]
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=snapshot.tool_calls,
            offer=offer,
            preset_id=uuid4(),
        )
    )

    assert len(snapshot.tool_calls) == 1
    assert seen_tool_names == ["create_story_object"]
    assert len(rows) == 1
    assert rows[0].tool_name == "create_story_object"
    assert rows[0].arguments == {
        "name": "Elena",
        "type": "character",
        "content": "Profile",
    }
    assert rows[0].status == "pending"
    assert rows[0].reason is None
