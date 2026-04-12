from __future__ import annotations

import os
import sys
import types
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import declarative_base

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    fake_database.short_session = lambda: None
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
        _get_settings=lambda *_args, **_kwargs: SimpleNamespace(main_language="English"),
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
    class FakeDelta:
        chat_bytes: int = 0
        image_run_bytes: int = 0
        notification_bytes: int = 0

    fake_storage_usage_service.StorageQuotaExceededError = StorageQuotaExceededError
    fake_storage_usage_service.StorageUsageDelta = FakeDelta
    fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
    fake_storage_usage_service.apply_project_usage_deltas = lambda *_args, **_kwargs: None
    fake_storage_usage_service.build_image_run_delta = lambda *_args, **_kwargs: FakeDelta(image_run_bytes=-1)
    fake_storage_usage_service.build_notification_delta = lambda *_args, **_kwargs: FakeDelta(notification_bytes=-1)
    fake_storage_usage_service.build_run_delta = lambda *_args, **_kwargs: FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_usage_delta_for_amount = lambda *_args, **_kwargs: FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_run_message_delta = lambda *_args, **_kwargs: FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_thread_delta = lambda *_args, **_kwargs: FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_run_message_attachment_delta = lambda *_args, **_kwargs: FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.build_tool_call_delta = lambda *_args, **_kwargs: FakeDelta(chat_bytes=-1)
    fake_storage_usage_service.snapshot_image_run_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_notification_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_message_attachment_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_message_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_run_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_thread_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.snapshot_tool_call_row = lambda *_args, **_kwargs: None
    fake_storage_usage_service.measure_run_message_row = lambda *_args, **_kwargs: 0
    fake_storage_usage_service.measure_tool_call_row = lambda *_args, **_kwargs: 0
    sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage_service

    fake_thread_runtime_sync_service = types.ModuleType("App.backend.services.thread_runtime_sync_service")
    fake_thread_runtime_sync_service.sync_explicit_run_thread_status = (
        lambda _db, *, run, thread, error: SimpleNamespace(
            run=run,
            thread=thread,
            error=error,
            notification=None,
            parent=None,
            parent_notification=None,
            parent_tool_call=None,
        )
    )

    async def _emit_runtime_sync_events(emitter, *, result, emit_run_status=True, extra_status_data=None):
        if not emit_run_status:
            return None
        run = getattr(result, "run", None)
        thread = getattr(result, "thread", None)
        if run is None or thread is None:
            return None
        payload = {
            "run_id": str(run.id),
            "status": run.status,
            "error": getattr(run, "error", None),
        }
        if isinstance(extra_status_data, dict):
            payload.update(extra_status_data)
        return await emitter.emit_runtime_event(
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            event_name="run:status",
            data=payload,
        )

    fake_thread_runtime_sync_service.emit_runtime_sync_events = _emit_runtime_sync_events
    sys.modules["App.backend.services.thread_runtime_sync_service"] = fake_thread_runtime_sync_service

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
        from jinja2.exceptions import TemplateSyntaxError, UndefinedError

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
        request_id: str | None = None
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


install_import_stubs()

from App.backend.models.db_models import Agent, RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from App.backend.providers.contracts import DeltaPayload, FinalToolCall
from App.backend.providers.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.run_pipeline import service as run_service
from App.backend.services.run_pipeline.contracts import CreateContext, ResumeRunCommand
from App.backend.services.run_pipeline.execution_loop import RunPipelineExecutionLoop, format_user_run_error
from App.backend.services.run_pipeline.lifecycle import RunPipelineLifecycle
from App.backend.services.run_pipeline.runtime import RunPipelineRuntime
from App.backend.services.run_pipeline.status_logic import derive_run_status
from App.backend.services.run_pipeline.status_transitions import RunStatusTransitions
from App.backend.services.run_pipeline.tool_call_persistence import RunToolCallPersistence
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


def build_runtime_stack(db_factory, dispatcher: FakeEventDispatcher | None = None) -> SimpleNamespace:
    runtime_dispatcher = dispatcher or FakeEventDispatcher()
    runtime = RunPipelineRuntime(runtime_dispatcher)  # type: ignore[arg-type]
    status_transitions = RunStatusTransitions(
        runtime=runtime,
        event_dispatcher=runtime_dispatcher,  # type: ignore[arg-type]
    )
    tool_call_persistence = RunToolCallPersistence(runtime=runtime)
    execution_loop = RunPipelineExecutionLoop(
        db_factory=db_factory,
        runtime=runtime,
        status_transitions=status_transitions,
        tool_call_persistence=tool_call_persistence,
    )
    lifecycle = RunPipelineLifecycle(
        db_factory=db_factory,
        runtime=runtime,
        status_transitions=status_transitions,
        execute_loop_fn=execution_loop.execute_loop,
    )
    return SimpleNamespace(
        dispatcher=runtime_dispatcher,
        runtime=runtime,
        status_transitions=status_transitions,
        tool_call_persistence=tool_call_persistence,
        execution_loop=execution_loop,
        lifecycle=lifecycle,
    )


def make_run_and_thread() -> tuple[RunModel, Thread]:
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
