from __future__ import annotations

import asyncio
import os
import sys
import types
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from jinja2.exceptions import TemplateSyntaxError, UndefinedError
from sqlalchemy.orm import declarative_base

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

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

    fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")

    class ChatAttachmentValidationError(ValueError):
        def __init__(self, message: str, *, status_code: int = 422) -> None:
            super().__init__(message)
            self.status_code = status_code

    @dataclass(frozen=True)
    class IncomingMessageAttachment:
        filename: str
        mime_type: str
        content: bytes

    fake_chat_attachment_service.ChatAttachmentValidationError = ChatAttachmentValidationError
    fake_chat_attachment_service.IncomingMessageAttachment = IncomingMessageAttachment
    fake_chat_attachment_service.chat_attachment_service = SimpleNamespace(
        ingest_message_attachments=lambda *_args, **_kwargs: [],
        serialize_attachment=lambda row: row,
    )
    sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service

    fake_runtime_event_dispatcher = types.ModuleType("App.backend.services.runtime_event_dispatcher")
    fake_runtime_event_dispatcher.RuntimeEventDispatcher = object
    fake_runtime_event_dispatcher.runtime_event_dispatcher = SimpleNamespace()
    sys.modules["App.backend.services.runtime_event_dispatcher"] = fake_runtime_event_dispatcher

    fake_settings_service = types.ModuleType("App.backend.services.settings_service")
    fake_settings_service.settings_service = SimpleNamespace(
        _get_settings=lambda *_args, **_kwargs: SimpleNamespace(),
        get_active_preset_id=lambda *_args, **_kwargs: None,
        is_vector_storage_enabled=lambda *_args, **_kwargs: False,
    )
    sys.modules["App.backend.services.settings_service"] = fake_settings_service

    fake_mcp = types.ModuleType("App.backend.services.mcp")
    fake_mcp.mcp_policy_service = SimpleNamespace(build_runtime_context=lambda *_args, **_kwargs: None)
    fake_mcp.mcp_resolver = SimpleNamespace(resolve_selections=lambda *_args, **_kwargs: None)
    sys.modules["App.backend.services.mcp"] = fake_mcp

    fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")

    class StorageQuotaExceededError(Exception):
        pass

    @dataclass(frozen=True)
    class _FakeDelta:
        chat_bytes: int = 0
        image_run_bytes: int = 0
        notification_bytes: int = 0

    fake_storage_usage_service.StorageQuotaExceededError = StorageQuotaExceededError
    fake_storage_usage_service.StorageUsageDelta = _FakeDelta
    fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_image_run_delta = lambda *_args, **_kwargs: _FakeDelta(image_run_bytes=-1)
    fake_storage_usage_service.build_notification_delta = lambda *_args, **_kwargs: _FakeDelta(notification_bytes=-1)
    fake_storage_usage_service.build_run_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_run_message_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_thread_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_run_message_attachment_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: _FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.snapshot_image_run_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_notification_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_message_attachment_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_message_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_thread_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_tool_call_row = lambda *_args, **_kwargs: None
    sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage_service

    fake_template_engine = types.ModuleType("App.backend.services.template_engine")

    class FragmentNotFoundError(RuntimeError):
        def __init__(self, path: str) -> None:
            super().__init__(path)
            self.path = path

    class TemplateRenderLimitError(RuntimeError):
        pass

    fake_template_engine.FragmentNotFoundError = FragmentNotFoundError
    fake_template_engine.TemplateRenderLimitError = TemplateRenderLimitError
    def _format_template_error(exc: Exception) -> str:
        if isinstance(exc, FragmentNotFoundError):
            return f"Referenced fragment not found: {exc.path}"
        if isinstance(exc, TemplateRenderLimitError):
            return "Template rendering exceeded safe limits."
        if isinstance(exc, TemplateSyntaxError):
            return exc.message
        if isinstance(exc, UndefinedError):
            return str(exc)
        return "Template rendering failed."

    fake_template_engine.format_template_error = _format_template_error
    sys.modules["App.backend.services.template_engine"] = fake_template_engine

    fake_tool_engine = types.ModuleType("App.backend.services.tool_engine")
    fake_tool_engine.__path__ = []  # type: ignore[attr-defined]
    fake_tool_engine.tool_engine = SimpleNamespace(
        validate_tool_call=lambda *_args, **_kwargs: None,
        execute_tool_call_by_id=lambda *_args, **_kwargs: None,
        propagate_child_terminal_state_to_parent=lambda *_args, **_kwargs: None,
        complete_parent_tool_call=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.tool_engine"] = fake_tool_engine

    fake_tool_engine_contracts = types.ModuleType("App.backend.services.tool_engine.contracts")

    @dataclass(frozen=True)
    class ValidationResult:
        valid: bool
        reason: str | None = None
        validator: str | None = None

    @dataclass(frozen=True)
    class ToolOffer:
        specs_by_name: dict[str, object]
        provider_tools: list[dict[str, object]]
        auto_approve_category_by_name: dict[str, str]

    fake_tool_engine_contracts.ValidationResult = ValidationResult
    fake_tool_engine_contracts.ToolOffer = ToolOffer
    sys.modules["App.backend.services.tool_engine.contracts"] = fake_tool_engine_contracts

    fake_tool_engine_result_utils = types.ModuleType("App.backend.services.tool_engine.result_utils")
    fake_tool_engine_result_utils.valid_result = lambda: ValidationResult(valid=True)
    fake_tool_engine_result_utils.invalid_result = (
        lambda validator, reason: ValidationResult(valid=False, reason=reason, validator=validator)
    )
    sys.modules["App.backend.services.tool_engine.result_utils"] = fake_tool_engine_result_utils

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = []  # type: ignore[attr-defined]

    @dataclass
    class ExecutionCheckpoint:
        message_id: object | None = None
        finalized: bool = False

    @dataclass(frozen=True)
    class LLMExecutionCallbacks:
        emit_fn: object
        persist_tool_calls_fn: object
        sync_status_fn: object

    @dataclass(frozen=True)
    class LLMExecutionRequest:
        db: object
        run: object
        thread: object
        settings: object
        system_prompt: str
        conversation: list[dict[str, object]]
        scenario_bundle: object
        input_payload: dict[str, object]
        checkpoint: ExecutionCheckpoint

    class LLMExecutionOrchestrator:
        async def execute(self, *_args: object, **_kwargs: object) -> None:
            return None

    fake_llm_execution.ExecutionCheckpoint = ExecutionCheckpoint
    fake_llm_execution.LLMExecutionCallbacks = LLMExecutionCallbacks
    fake_llm_execution.LLMExecutionOrchestrator = LLMExecutionOrchestrator
    fake_llm_execution.LLMExecutionRequest = LLMExecutionRequest
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution

    fake_llm_execution_orchestrator = types.ModuleType("App.backend.services.run_pipeline.llm_execution.orchestrator")
    fake_llm_execution_orchestrator.LLMExecutionOrchestrator = LLMExecutionOrchestrator
    sys.modules["App.backend.services.run_pipeline.llm_execution.orchestrator"] = fake_llm_execution_orchestrator

    fake_prompt_assembly = types.ModuleType("App.backend.services.run_pipeline.prompt_assembly")
    fake_prompt_assembly.assemble_create = lambda *_args, **_kwargs: ("", [], {})
    fake_prompt_assembly.assemble_resume = lambda *_args, **_kwargs: ("", [], {})
    sys.modules["App.backend.services.run_pipeline.prompt_assembly"] = fake_prompt_assembly

    for module_name in (
        "App.backend.providers.async_openai_provider",
        "App.backend.providers.claude_provider",
        "App.backend.providers.gemini_provider",
        "App.backend.providers.openai_responses_provider",
        "App.backend.providers.openrouter",
        "App.backend.providers.xai_provider",
        "App.backend.providers.custom",
    ):
        sys.modules[module_name] = types.ModuleType(module_name)


_install_import_stubs()

from App.backend.models.db_models import Agent, RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from App.backend.providers.contracts import DeltaPayload, FinalToolCall
from App.backend.providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.run_pipeline import service as run_service
from App.backend.services.run_pipeline.contracts import CreateContext
from App.backend.services.run_pipeline.status_logic import derive_run_status
from App.backend.services.template_engine import FragmentNotFoundError, format_template_error
from App.backend.services.tool_engine.contracts import ToolOffer
from App.backend.services.tool_engine.result_utils import invalid_result, valid_result


class FakeQuery:
    def __init__(self, result: object) -> None:
        self._result = result

    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def first(self) -> object:
        result = self._result() if callable(self._result) else self._result
        if isinstance(result, list):
            return result[0] if result else None
        return result

    def all(self) -> list[object]:
        result = self._result() if callable(self._result) else self._result
        if result is None:
            return []
        if isinstance(result, list):
            return result
        return [result]


class FakeSession:
    def __init__(
        self,
        *,
        run: RunModel,
        thread: Thread,
        assistant_message: RunMessageModel | None = None,
        persisted_tool_call: RunToolCallModel | None = None,
    ) -> None:
        self._run = run
        self._thread = thread
        self.assistant_message = assistant_message
        self.persisted_tool_call = persisted_tool_call
        self.deleted: list[object] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def query(self, model: object) -> FakeQuery:
        if model is Agent:
            return FakeQuery(None)
        if model is RunModel:
            return FakeQuery(lambda: self._run)
        if model is Thread:
            return FakeQuery(lambda: self._thread)
        if model is RunMessageModel:
            return FakeQuery(lambda: self.assistant_message)
        if model is RunToolCallModel:
            return FakeQuery(lambda: self.persisted_tool_call)
        raise AssertionError(f"Unexpected model query: {model!r}")

    def rollback(self) -> None:
        self.rollbacks += 1

    def commit(self) -> None:
        self.commits += 1

    def flush(self) -> None:
        return None

    def delete(self, obj: object) -> None:
        self.deleted.append(obj)
        if obj is self.assistant_message:
            self.assistant_message = None
        if obj is self.persisted_tool_call:
            self.persisted_tool_call = None

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
        user_id: object,
        project_id: object,
        thread_id: object,
        event_name: str,
        data: dict[str, object],
    ) -> dict[str, object]:
        event = {
            "user_id": str(user_id),
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


class FakeActiveRunQuery:
    def __init__(self, db: "FakeActiveRunDb", model: object) -> None:
        self._db = db
        self._model = model

    def join(self, *_args: object, **_kwargs: object) -> "FakeActiveRunQuery":
        return self

    def filter(self, *_args: object, **_kwargs: object) -> "FakeActiveRunQuery":
        return self

    def with_for_update(self) -> "FakeActiveRunQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "FakeActiveRunQuery":
        return self

    def first(self) -> object:
        if self._model is RunModel:
            return self._db.run
        if self._model is Thread:
            return self._db.thread
        if self._model is Agent:
            return None
        if getattr(self._model, "__name__", "") == "SubAgentDefinitionModel":
            return None
        raise AssertionError(f"Unexpected model query: {self._model!r}")


class FakeActiveRunDb:
    def __init__(self, *, run: RunModel, thread: Thread) -> None:
        self.run = run
        self.thread = thread
        self.commits = 0
        self.closed = 0

    def query(self, model: object) -> FakeActiveRunQuery:
        return FakeActiveRunQuery(self, model)

    def commit(self) -> None:
        self.commits += 1

    def flush(self) -> None:
        return None

    def close(self) -> None:
        self.closed += 1


class FakeResumeRunQuery:
    def __init__(self, db: "FakeResumeRunDb", model: object) -> None:
        self._db = db
        self._model = model

    def filter(self, *_args: object, **_kwargs: object) -> "FakeResumeRunQuery":
        return self

    def with_for_update(self) -> "FakeResumeRunQuery":
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> "FakeResumeRunQuery":
        return self

    def first(self) -> object:
        if self._model is Thread:
            return self._db.thread
        if self._model is RunModel:
            return self._db.run
        if self._model is Agent:
            return None
        if getattr(self._model, "class_", None) is RunToolCallModel:
            return self._db.unresolved_tool
        raise AssertionError(f"Unexpected model query: {self._model!r}")


class FakeResumeRunDb:
    def __init__(
        self,
        *,
        thread: Thread | None,
        run: RunModel | None,
        pending_tool: object | None = None,
        unresolved_tool: object | None = None,
    ) -> None:
        self.thread = thread
        self.run = run
        self.pending_tool = pending_tool
        self.unresolved_tool = unresolved_tool if unresolved_tool is not None else pending_tool
        self.commits = 0
        self.closed = 0

    def query(self, model: object) -> FakeResumeRunQuery:
        return FakeResumeRunQuery(self, model)

    def commit(self) -> None:
        self.commits += 1

    def flush(self) -> None:
        return None

    def refresh(self, _obj: object) -> None:
        return None

    def close(self) -> None:
        self.closed += 1


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


def _make_idle_pipeline(db_factory) -> run_service.RunPipeline:
    return run_service.RunPipeline(db_factory=db_factory, event_dispatcher=FakeEventDispatcher())  # type: ignore[arg-type]


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

    async def _should_not_execute(_self: object, *_args: object, **_kwargs: object) -> None:
        raise AssertionError("execute should not be called when prompt assembly fails")

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: UserSettings())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _raise_fragment_not_found)
    monkeypatch.setattr(run_service.LLMExecutionOrchestrator, "execute", _should_not_execute)
    monkeypatch.setattr(run_service, "recalculate_project_usage", lambda *_args, **_kwargs: None, raising=False)

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


def test_start_run_rejects_empty_request_before_db() -> None:
    pipeline = _make_idle_pipeline(lambda: (_ for _ in ()).throw(AssertionError("db should not be touched")))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.start_run(
                thread_id=uuid4(),
                user_id=uuid4(),
                input_text="",
                input_payload=None,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
                attachments=[],
                mcp_selections=[],
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "input_text, attachments, or mcp_selections are required for create run"


def test_resume_run_rejects_when_pending_tool_call_exists() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="waiting")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="waiting",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run, pending_tool=object())
    pipeline = _make_idle_pipeline(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.resume_run(
                thread_id=thread.id,
                user_id=thread.user_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Unresolved tool call exists in latest run"


def test_resume_run_rejects_error_latest_run_when_pending_tool_call_exists() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="error")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="error",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run, pending_tool=object())
    pipeline = _make_idle_pipeline(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.resume_run(
                thread_id=thread.id,
                user_id=thread.user_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Unresolved tool call exists in latest run"


def test_resume_run_rejects_when_no_latest_run_exists() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="waiting")
    db = FakeResumeRunDb(thread=thread, run=None)
    pipeline = _make_idle_pipeline(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.resume_run(
                thread_id=thread.id,
                user_id=thread.user_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "No run exists to resume"


def test_resume_run_rejects_when_processing_tool_call_exists_in_latest_run() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="processing")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="processing",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run, unresolved_tool=object())
    pipeline = _make_idle_pipeline(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.resume_run(
                thread_id=thread.id,
                user_id=thread.user_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Unresolved tool call exists in latest run"


def test_resume_run_rejects_running_latest_run() -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="running")
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
    db = FakeResumeRunDb(thread=thread, run=run)
    pipeline = _make_idle_pipeline(lambda: db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            pipeline.resume_run(
                thread_id=thread.id,
                user_id=thread.user_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
                language=None,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Run status 'running' is not resumable"


def test_resume_run_allows_error_latest_run(monkeypatch: pytest.MonkeyPatch) -> None:
    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="error")
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="error",
        language="English",
        input_payload={},
    )
    run.thread = thread
    db = FakeResumeRunDb(thread=thread, run=run)
    pipeline = _make_idle_pipeline(lambda: db)
    spawned_run_ids: list[UUID] = []

    async def _spawn_task(run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        del create_ctx
        spawned_run_ids.append(run_id)

    monkeypatch.setattr(pipeline, "_spawn_task", _spawn_task)

    resumed = asyncio.run(
        pipeline.resume_run(
            thread_id=thread.id,
            user_id=thread.user_id,
            run_mode=None,
            surface=None,
            context_object_ids=[],
            journey_target_ids=[],
            language=None,
        )
    )

    assert resumed is run
    assert run.status == "running"
    assert run.error is None
    assert thread.status == "running"
    assert db.commits == 1
    assert spawned_run_ids == [run.id]


def test_execute_loop_preserves_non_template_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = _make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: session, event_dispatcher=dispatcher)  # type: ignore[arg-type]

    async def _raise_runtime_error(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("boom")

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: SimpleNamespace())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _raise_runtime_error)
    monkeypatch.setattr(run_service, "recalculate_project_usage", lambda *_args, **_kwargs: None, raising=False)

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


def test_execute_loop_midstream_failure_emits_message_error_and_discards_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run, thread = _make_run_and_thread()
    assistant_message = RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={"English": {"contentParts": []}},
    )
    session = FakeSession(run=run, thread=thread, assistant_message=assistant_message)
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: session, event_dispatcher=dispatcher)  # type: ignore[arg-type]

    async def _assemble_create(*_args: object, **_kwargs: object) -> tuple[str, list[dict[str, object]], None]:
        return "system", [], None

    async def _failing_execute(_self: object, request: object, _callbacks: object) -> None:
        request.checkpoint.message_id = assistant_message.id
        request.checkpoint.finalized = False
        raise RuntimeError("stream blew up")

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: UserSettings())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(run_service.LLMExecutionOrchestrator, "execute", _failing_execute)

    asyncio.run(
        pipeline.execute_loop(
            run.id,
            create_ctx=CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert thread.status == "error"
    assert session.assistant_message is None
    assert [event["event_name"] for event in dispatcher.events] == [
        "run:status",
        "message:error",
        "run:error",
        "run:status",
    ]
    assert dispatcher.events[1]["data"] == {
        "run_id": str(run.id),
        "message_id": str(assistant_message.id),
        "error": "stream blew up",
    }
    assert not any(event["event_name"] == "message:end" for event in dispatcher.events)


def test_execute_loop_finalized_failure_keeps_message_without_message_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run, thread = _make_run_and_thread()
    assistant_message = RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={"English": {"contentParts": [{"type": "content", "text": "done"}]}},
    )
    session = FakeSession(run=run, thread=thread, assistant_message=assistant_message)
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: session, event_dispatcher=dispatcher)  # type: ignore[arg-type]

    async def _assemble_create(*_args: object, **_kwargs: object) -> tuple[str, list[dict[str, object]], None]:
        return "system", [], None

    async def _finalized_then_fail(_self: object, request: object, callbacks: object) -> None:
        request.checkpoint.message_id = assistant_message.id
        request.checkpoint.finalized = True
        await callbacks.emit_fn(
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            event_name="message:end",
            data={
                "run_id": str(run.id),
                "message_id": str(assistant_message.id),
                "seq_in_thread": int(assistant_message.seq_in_thread),
                "data": assistant_message.data,
                "tool_calls": [],
            },
        )
        raise RuntimeError("post commit boom")

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: UserSettings())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(run_service.LLMExecutionOrchestrator, "execute", _finalized_then_fail)

    asyncio.run(
        pipeline.execute_loop(
            run.id,
            create_ctx=CreateContext(input_text="hello", input_payload={}),
        )
    )

    assert run.status == "error"
    assert thread.status == "error"
    assert session.assistant_message is assistant_message
    assert [event["event_name"] for event in dispatcher.events] == [
        "run:status",
        "message:end",
        "run:error",
        "run:status",
    ]
    assert not any(event["event_name"] == "message:error" for event in dispatcher.events)


def test_persist_tool_calls_uses_parsed_arguments_for_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline, dispatcher = _make_pipeline()
    db = FakePersistSession()

    thread = Thread(id=uuid4(), project_id=uuid4(), user_id=uuid4(), thread_type="agent", status="running", next_message_seq=1)
    run = RunModel(id=uuid4(), thread_id=thread.id, user_id=thread.user_id, project_id=thread.project_id, status="running", language="English", next_message_seq=1)
    assistant_message = run_service.RunMessageModel(id=uuid4(), thread_id=thread.id, run_id=run.id, role="assistant", seq=0, seq_in_thread=0, data={})
    offer = ToolOffer(specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})
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
    offer = ToolOffer(specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})

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
    offer = ToolOffer(specs_by_name={}, provider_tools=[], auto_approve_category_by_name={})

    assembler = FallbackSnapshotAssembler(provider="test", model="test-model")
    assembler.apply_delta(
        DeltaPayload(
            tool_call_deltas=[
                {
                    "index": 0,
                    "id": "call_1",
                    "function": {
                        "name": "create_story_entity",
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
    assert seen_tool_names == ["create_story_entity"]
    assert len(rows) == 1
    assert rows[0].tool_name == "create_story_entity"
    assert rows[0].arguments == {
        "name": "Elena",
        "type": "character",
        "content": "Profile",
    }
    assert rows[0].status == "pending"
    assert rows[0].reason is None


@pytest.mark.parametrize(
    ("tool_statuses", "expected"),
    [
        ([], "paused"),
        (["applied"], "paused"),
        (["pending"], "paused"),
        (["processing"], "paused"),
        (["rejected"], "paused"),
        (["failed"], "paused"),
    ],
)
def test_derive_run_status_keeps_paused_sticky(tool_statuses: list[str], expected: str) -> None:
    assert derive_run_status(current_status="paused", tool_call_statuses=tool_statuses) == expected


def test_pause_run_marks_sub_agent_paused_without_parent_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="subAgent",
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
    fake_db = FakeActiveRunDb(run=run, thread=thread)
    pipeline = run_service.RunPipeline(db_factory=lambda: fake_db, event_dispatcher=SimpleNamespace())  # type: ignore[arg-type]

    canceled_run_ids: list[object] = []
    emitted: list[tuple[str, dict[str, object]]] = []
    parent_calls: list[tuple[object, object]] = []

    async def _fake_cancel_task_and_wait(run_id: object, *, timeout_s: float = 5.0) -> bool:
        _ = timeout_s
        canceled_run_ids.append(run_id)
        return True

    async def _fake_emit(*, user_id: object, project_id: object, thread_id: object, event_name: str, data: dict[str, object]) -> None:
        _ = user_id, project_id, thread_id
        emitted.append((event_name, data))

    async def _fake_propagate_child_terminal_state_to_parent(*args: object, **kwargs: object) -> None:
        parent_calls.append((args, kwargs))

    pipeline._cancel_task_and_wait = _fake_cancel_task_and_wait  # type: ignore[method-assign]
    pipeline._emit = _fake_emit  # type: ignore[method-assign]
    monkeypatch.setattr(
        run_service.tool_engine,
        "propagate_child_terminal_state_to_parent",
        _fake_propagate_child_terminal_state_to_parent,
    )

    asyncio.run(pipeline.pause_run(thread_id=thread.id, user_id=thread.user_id))

    assert run.status == "paused"
    assert thread.status == "paused"
    assert canceled_run_ids == [run.id]
    assert emitted == [("run:status", {"run_id": str(run.id), "status": "paused", "error": None})]
    assert parent_calls == []


def test_cancel_run_allows_paused_and_propagates_parent_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="subAgent",
        status="paused",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="paused",
        language="English",
        input_payload={},
    )
    run.thread = thread
    fake_db = FakeActiveRunDb(run=run, thread=thread)
    pipeline = run_service.RunPipeline(db_factory=lambda: fake_db, event_dispatcher=SimpleNamespace())  # type: ignore[arg-type]

    emitted: list[tuple[str, dict[str, object]]] = []
    parent_calls: list[dict[str, object]] = []

    async def _fake_cancel_task_and_wait(_run_id: object, *, timeout_s: float = 5.0) -> bool:
        _ = timeout_s
        return True

    async def _fake_emit(*, user_id: object, project_id: object, thread_id: object, event_name: str, data: dict[str, object]) -> None:
        _ = user_id, project_id, thread_id
        emitted.append((event_name, data))

    async def _fake_propagate_child_terminal_state_to_parent(_db: object, *, thread: object, run: object, emit: object) -> None:
        _ = emit
        parent_calls.append(
            {
                "thread_status": getattr(thread, "status", None),
                "run_status": getattr(run, "status", None),
            }
        )

    pipeline._cancel_task_and_wait = _fake_cancel_task_and_wait  # type: ignore[method-assign]
    pipeline._emit = _fake_emit  # type: ignore[method-assign]
    monkeypatch.setattr(
        run_service.tool_engine,
        "propagate_child_terminal_state_to_parent",
        _fake_propagate_child_terminal_state_to_parent,
    )

    asyncio.run(pipeline.cancel_run(thread_id=thread.id, user_id=thread.user_id))

    assert run.status == "canceled"
    assert thread.status == "canceled"
    assert emitted == [
        ("run:status", {"run_id": str(run.id), "status": "canceled", "error": None}),
        ("run:canceled", {"run_id": str(run.id)}),
    ]
    assert parent_calls == [{"thread_status": "canceled", "run_status": "canceled"}]


def test_execute_loop_cancelled_error_preserves_paused_status(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread = _make_run_and_thread()
    session = FakeSession(run=run, thread=thread)
    dispatcher = FakeEventDispatcher()
    pipeline = run_service.RunPipeline(db_factory=lambda: session, event_dispatcher=dispatcher)  # type: ignore[arg-type]

    async def _assemble_create(*_args: object, **_kwargs: object) -> tuple[str, list[dict[str, object]], None]:
        return "system", [], None

    async def _cancelled_execute(_self: object, request: object, _callbacks: object) -> None:
        request.run.status = "paused"
        request.thread.status = "paused"
        raise asyncio.CancelledError()

    monkeypatch.setattr(run_service.settings_service, "_get_settings", lambda *_args, **_kwargs: UserSettings())
    monkeypatch.setattr(run_service.prompt_assembly, "assemble_create", _assemble_create)
    monkeypatch.setattr(run_service.LLMExecutionOrchestrator, "execute", _cancelled_execute)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            pipeline.execute_loop(
                run.id,
                create_ctx=CreateContext(input_text="pause me", input_payload={}),
            )
        )

    assert run.status == "paused"
    assert thread.status == "paused"
