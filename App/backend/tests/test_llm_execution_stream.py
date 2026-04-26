from __future__ import annotations

import asyncio
import importlib
import os
import sys
import types
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DEFAULT_STORAGE_QUOTA_BYTES", "0")


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

    fake_runtime = types.ModuleType("App.backend.services.llm_runtime_service")

    @dataclass(frozen=True)
    class LLMRuntime:
        provider: str
        task_config: object
        provider_config: dict[str, object]

    fake_runtime.LLMRuntime = LLMRuntime
    sys.modules["App.backend.services.llm_runtime_service"] = fake_runtime

    fake_settings = types.ModuleType("App.backend.services.settings_service")

    @dataclass
    class TaskConfig:
        provider: str = "test"
        model: str = "test-model"
        temperature: float = 0.0
        max_output_tokens: int | None = None
        provider_preference: dict[str, object] | None = None
        advanced: dict[str, object] = field(default_factory=dict)
        context_window_tokens: int | None = None

    fake_settings.TaskConfig = TaskConfig
    fake_settings.settings_service = SimpleNamespace()
    sys.modules["App.backend.services.settings_service"] = fake_settings

    fake_prompt_contracts = types.ModuleType("App.backend.services.prompt_runtime.contracts")

    @dataclass(frozen=True)
    class ScenarioBundle:
        task_type: str = "agent"
        task_subtype: str = "agentMode"
        template_data: dict[str, object] = field(default_factory=dict)
        blocks: list[dict[str, object]] = field(default_factory=list)
        system_template: str = ""
        project_data: dict[str, object] = field(default_factory=dict)
        template_renderer_factory: object | None = None

    fake_prompt_contracts.ScenarioBundle = ScenarioBundle
    sys.modules["App.backend.services.prompt_runtime.contracts"] = fake_prompt_contracts

    fake_tool_contracts = types.ModuleType("App.backend.services.tool_engine.contracts")

    @dataclass(frozen=True)
    class ToolOffer:
        specs_by_name: dict[str, object] = field(default_factory=dict)
        provider_tools: list[dict[str, object]] = field(default_factory=list)
        auto_approve_category_by_name: dict[str, str] = field(default_factory=dict)

    fake_tool_contracts.ToolOffer = ToolOffer
    sys.modules["App.backend.services.tool_engine.contracts"] = fake_tool_contracts

    fake_llm_request_service = types.ModuleType("App.backend.services.llm_request_service")
    fake_llm_request_service.llm_request_service = SimpleNamespace(
        update_request=lambda *_args, **_kwargs: None,
        on_retry=lambda *_args, **_kwargs: None,
        complete=lambda *_args, **_kwargs: None,
        fail=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.llm_request_service"] = fake_llm_request_service

    fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
    fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
    sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")]
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution

    fake_contracts = types.ModuleType("App.backend.services.run_pipeline.llm_execution.contracts")

    @dataclass(frozen=True)
    class ExecutionCheckpoint:
        message_id: object | None = None
        request_id: str | None = None
        finalized: bool = False

    @dataclass(frozen=True)
    class LLMExecutionCallbacks:
        emit_fn: object
        persist_tool_calls_fn: object | None = None
        sync_status_fn: object | None = None

    @dataclass(frozen=True)
    class LLMExecutionRequest:
        db: object
        run: object
        thread: object
        settings: object
        system_prompt: str = ""
        conversation: list[dict[str, object]] = field(default_factory=list)
        scenario_bundle: object | None = None
        input_payload: dict[str, object] = field(default_factory=dict)
        checkpoint: object | None = None
        emit_fn: object | None = None

    @dataclass
    class PreparedLLMExecution:
        preset_id: object | None = None
        runtime: object | None = None
        task_config: object | None = None
        provider: object | None = None
        tool_offer: object | None = None
        output_mode: str = "tool_call"
        native_tool_call_mode: bool = False
        advanced: dict[str, object] = field(default_factory=dict)
        thinking_mode: str = "off"
        effective_thinking_config: dict[str, object] | None = None
        provider_messages: list[dict[str, object]] = field(default_factory=list)
        prepared_cache_plan: object | None = None
        stream_thinking_display: str | None = None
        retry_cfg: object | None = None

    @dataclass(frozen=True)
    class StreamExecutionResult:
        final_snapshot: object
        raw_response: dict[str, object] | None
        request_id: str | None = None

    fake_contracts.ExecutionCheckpoint = ExecutionCheckpoint
    fake_contracts.LLMExecutionCallbacks = LLMExecutionCallbacks
    fake_contracts.LLMExecutionRequest = LLMExecutionRequest
    fake_contracts.PreparedLLMExecution = PreparedLLMExecution
    fake_contracts.StreamExecutionResult = StreamExecutionResult
    sys.modules["App.backend.services.run_pipeline.llm_execution.contracts"] = fake_contracts

    fake_stream_retry = types.ModuleType("App.backend.providers.shared.transport.stream_retry")
    fake_stream_retry.stream_with_retry = lambda factory, _cfg, on_retry=None: factory()
    sys.modules["App.backend.providers.shared.transport.stream_retry"] = fake_stream_retry


_install_import_stubs()

from App.backend.models.db_models import RunMessageModel, RunModel, Thread
from App.backend.providers.shared.contracts import DeltaPayload, ProviderErrorPayload, ProviderEvent

stream_module = importlib.import_module("App.backend.services.run_pipeline.llm_execution.stream")


def _make_run_thread_message() -> tuple[RunModel, Thread, RunMessageModel]:
    run = RunModel(
        id=uuid4(),
        thread_id=uuid4(),
        user_id=uuid4(),
        project_id=uuid4(),
        status="running",
        language="English",
    )
    thread = Thread(
        id=run.thread_id,
        project_id=run.project_id,
        user_id=run.user_id,
        thread_type="agent",
        status="running",
    )
    message = RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={},
    )
    return run, thread, message


def _make_prepared(provider: object, **overrides: object) -> SimpleNamespace:
    return SimpleNamespace(
        task_config=SimpleNamespace(
            provider="test",
            model="model-a",
            temperature=0.0,
            max_output_tokens=None,
        ),
        provider=provider,
        tool_offer=SimpleNamespace(provider_tools=[]),
        output_mode="tool_call",
        native_tool_call_mode=False,
        advanced={},
        thinking_mode="off",
        effective_thinking_config=None,
        provider_messages=[],
        stream_thinking_display=None,
        retry_cfg=None,
        **overrides,
    )


def test_execute_stream_fails_request_session_on_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread, assistant_message = _make_run_thread_message()
    emitted: list[str] = []
    log_events: list[tuple[str, object]] = []

    class FakeRequestSession:
        def __init__(self, **_kwargs) -> None:
            self._closed = False
            self.retry_count = 0

        def on_request(self, raw_request: dict[str, object]) -> None:
            log_events.append(("request", raw_request))

        def on_retry(self, error_msg: str, error_status: int | None) -> None:
            log_events.append(("retry", {"message": error_msg, "status": error_status}))

        def fail(self, error_msg: str, *, content_parts, merged_meta) -> None:  # noqa: ANN001
            if self._closed:
                return
            self._closed = True
            log_events.append(("fail", error_msg))

        def complete(self, raw_output, merged_meta) -> None:  # noqa: ANN001
            if self._closed:
                return
            self._closed = True
            log_events.append(("complete", raw_output))

    class ErrorProvider:
        def stream_chat(self, **_kwargs):
            async def _gen():
                yield ProviderEvent(kind="delta", raw_request={"messages": []})
                yield ProviderEvent(kind="error", error=ProviderErrorPayload(message="boom", status=None))

            return _gen()

    async def _emit(**kwargs) -> None:
        emitted.append(kwargs["event_name"])

    monkeypatch.setattr(stream_module, "LLMRequestSession", FakeRequestSession)

    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(
            stream_module.execute_stream(
                SimpleNamespace(
                    run=run,
                    thread=thread,
                    settings=SimpleNamespace(llm_logging_enabled=True),
                ),
                SimpleNamespace(emit_fn=_emit),
                _make_prepared(ErrorProvider()),
                assistant_message=assistant_message,
                request_id="req_test",
            )
        )

    assert emitted == ["llm:request"]
    assert log_events == [("request", {"messages": []}), ("fail", "boom")]


def test_execute_stream_fails_request_session_on_finalize_error(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread, assistant_message = _make_run_thread_message()
    log_events: list[tuple[str, object]] = []

    class FakeRequestSession:
        def __init__(self, **_kwargs) -> None:
            self._closed = False
            self.retry_count = 0

        def on_request(self, raw_request: dict[str, object]) -> None:
            log_events.append(("request", raw_request))

        def on_retry(self, error_msg: str, error_status: int | None) -> None:
            log_events.append(("retry", {"message": error_msg, "status": error_status}))

        def fail(self, error_msg: str, *, content_parts, merged_meta) -> None:  # noqa: ANN001
            if self._closed:
                return
            self._closed = True
            log_events.append(("fail", error_msg))

        def complete(self, raw_output, merged_meta) -> None:  # noqa: ANN001
            if self._closed:
                return
            self._closed = True
            log_events.append(("complete", raw_output))

    class EmptyProvider:
        def stream_chat(self, **_kwargs):
            async def _gen():
                yield ProviderEvent(kind="delta", raw_request={"messages": []})
                if False:
                    yield None

            return _gen()

    async def _emit(**_kwargs) -> None:
        return None

    monkeypatch.setattr(stream_module, "LLMRequestSession", FakeRequestSession)

    with pytest.raises(ValueError, match="Unable to assemble final snapshot"):
        asyncio.run(
            stream_module.execute_stream(
                SimpleNamespace(
                    run=run,
                    thread=thread,
                    settings=SimpleNamespace(llm_logging_enabled=True),
                ),
                SimpleNamespace(emit_fn=_emit),
                _make_prepared(EmptyProvider()),
                assistant_message=assistant_message,
                request_id="req_test",
            )
        )

    assert log_events[0] == ("request", {"messages": []})
    assert log_events[1][0] == "fail"
    assert "Unable to assemble final snapshot" in str(log_events[1][1])


def test_execute_stream_merges_mixed_id_index_tool_call_deltas(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread, assistant_message = _make_run_thread_message()
    emitted: list[str] = []
    log_events: list[tuple[str, object]] = []

    class FakeRequestSession:
        def __init__(self, **_kwargs) -> None:
            self._closed = False
            self.retry_count = 0

        def on_request(self, raw_request: dict[str, object]) -> None:
            log_events.append(("request", raw_request))

        def on_retry(self, error_msg: str, error_status: int | None) -> None:
            log_events.append(("retry", {"message": error_msg, "status": error_status}))

        def fail(self, error_msg: str, *, content_parts, merged_meta) -> None:  # noqa: ANN001
            if self._closed:
                return
            self._closed = True
            log_events.append(("fail", error_msg))

        def complete(self, raw_output, merged_meta) -> None:  # noqa: ANN001
            if self._closed:
                return
            self._closed = True
            log_events.append(("complete", raw_output))

    class ToolProvider:
        def stream_chat(self, **_kwargs):
            async def _gen():
                yield ProviderEvent(kind="delta", raw_request={"messages": []})
                yield ProviderEvent(
                    kind="delta",
                    delta=DeltaPayload(
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
                    ),
                )
                yield ProviderEvent(
                    kind="delta",
                    delta=DeltaPayload(
                        tool_call_deltas=[
                            {
                                "index": 0,
                                "function": {
                                    "arguments": ',"type":"character"}',
                                },
                            }
                        ]
                    ),
                )

            return _gen()

    async def _emit(**kwargs) -> None:
        emitted.append(kwargs["event_name"])

    monkeypatch.setattr(stream_module, "LLMRequestSession", FakeRequestSession)

    result = asyncio.run(
        stream_module.execute_stream(
            SimpleNamespace(
                run=run,
                thread=thread,
                settings=SimpleNamespace(llm_logging_enabled=True),
            ),
            SimpleNamespace(emit_fn=_emit),
            _make_prepared(ToolProvider()),
            assistant_message=assistant_message,
            request_id="req_test",
        )
    )

    assert len(result.final_snapshot.tool_calls) == 1
    assert result.final_snapshot.tool_calls[0].tool_name == "create_story_entity"
    assert result.final_snapshot.tool_calls[0].arguments == {
        "name": "Elena",
        "type": "character",
    }
    assert emitted.count("tool_call:start") == 1
    assert emitted.count("tool_call:delta") == 2
    assert log_events == [("request", {"messages": []}), ("complete", None)]


def test_execute_stream_keeps_raw_request_out_of_frontend_event(monkeypatch: pytest.MonkeyPatch) -> None:
    run, thread, assistant_message = _make_run_thread_message()
    emitted_payloads: list[dict[str, object]] = []
    session_requests: list[dict[str, object]] = []

    class FakeRequestSession:
        def __init__(self, **_kwargs) -> None:
            self._closed = False
            self.retry_count = 0

        def on_request(self, raw_request: dict[str, object]) -> None:
            session_requests.append(raw_request)

        def on_retry(self, error_msg: str, error_status: int | None) -> None:
            _ = error_msg, error_status

        def fail(self, error_msg: str, *, content_parts, merged_meta) -> None:  # noqa: ANN001
            _ = error_msg, content_parts, merged_meta
            self._closed = True

        def complete(self, raw_output, merged_meta) -> None:  # noqa: ANN001
            _ = raw_output, merged_meta
            self._closed = True

    class RequestProvider:
        def stream_chat(self, **_kwargs):
            async def _gen():
                yield ProviderEvent(
                    kind="delta",
                    raw_request={
                        "messages": [],
                        "extra_headers": {"Authorization": "secret"},
                        "extra_body": {"metadata": {"request_id": "req_test"}},
                    },
                )
                if False:
                    yield None

            return _gen()

    async def _emit(**kwargs) -> None:
        emitted_payloads.append(kwargs["data"])

    monkeypatch.setattr(stream_module, "LLMRequestSession", FakeRequestSession)

    with pytest.raises(ValueError, match="Unable to assemble final snapshot"):
        asyncio.run(
            stream_module.execute_stream(
                SimpleNamespace(
                    run=run,
                    thread=thread,
                    settings=SimpleNamespace(llm_logging_enabled=True),
                ),
                SimpleNamespace(emit_fn=_emit),
                _make_prepared(RequestProvider()),
                assistant_message=assistant_message,
                request_id="req_test",
            )
        )

    assert session_requests == [
        {
            "messages": [],
            "extra_headers": {"Authorization": "secret"},
            "extra_body": {"metadata": {"request_id": "req_test"}},
        }
    ]
    assert emitted_payloads == [
        {
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "request_id": "req_test",
            "retry_count": 0,
            "provider": "test",
            "model": "model-a",
        }
    ]
    assert "raw_request" not in emitted_payloads[0]
