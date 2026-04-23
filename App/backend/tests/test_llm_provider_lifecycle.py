from __future__ import annotations

import asyncio
import importlib
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from App.backend.providers.shared.base import BaseProvider


ROOT = Path(__file__).resolve().parents[3]

fake_db_models = types.ModuleType("App.backend.models.db_models")


class _RunMessageModel:
    def __init__(self, **kwargs) -> None:
        self.__dict__.update(kwargs)


fake_db_models.RunMessageModel = _RunMessageModel
sys.modules["App.backend.models.db_models"] = fake_db_models

fake_llm_request_service = types.ModuleType("App.backend.services.llm_request_service")
fake_llm_request_service.llm_request_service = SimpleNamespace(create_request=lambda **_kwargs: None)
sys.modules["App.backend.services.llm_request_service"] = fake_llm_request_service

fake_storage_usage_service = types.ModuleType("App.backend.services.storage_usage_service")
fake_storage_usage_service.apply_project_usage_delta = lambda *_args, **_kwargs: None
fake_storage_usage_service.build_run_message_delta = lambda *_args, **_kwargs: {}
fake_storage_usage_service.snapshot_run_message_row = lambda *_args, **_kwargs: {}
sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage_service

fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
fake_llm_execution.__path__ = [
    str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")
]
sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution

fake_contracts = types.ModuleType("App.backend.services.run_pipeline.llm_execution.contracts")
fake_contracts.LLMExecutionCallbacks = object
fake_contracts.LLMExecutionRequest = object
sys.modules["App.backend.services.run_pipeline.llm_execution.contracts"] = fake_contracts

fake_events = types.ModuleType("App.backend.services.run_pipeline.llm_execution.events")
fake_events.emit_message_start = None
fake_events.emit_terminal_events = None
sys.modules["App.backend.services.run_pipeline.llm_execution.events"] = fake_events

for module_name, attr_name in (
    ("App.backend.services.run_pipeline.llm_execution.persist", "persist_execution"),
    ("App.backend.services.run_pipeline.llm_execution.prepare", "prepare_execution"),
    ("App.backend.services.run_pipeline.llm_execution.stream", "execute_stream"),
):
    fake_module = types.ModuleType(module_name)
    setattr(fake_module, attr_name, None)
    sys.modules[module_name] = fake_module

orchestrator_module = importlib.import_module(
    "App.backend.services.run_pipeline.llm_execution.orchestrator"
)


def test_close_sdk_client_handles_supported_close_shapes() -> None:
    calls: list[str] = []

    class AsyncCloseClient:
        async def aclose(self) -> None:
            calls.append("async-aclose")

    class SyncCloseClient:
        def close(self) -> None:
            calls.append("sync-close")

    class AioCloseFacade:
        async def aclose(self) -> None:
            calls.append("aio-aclose")

    class AioCloseClient:
        aio = AioCloseFacade()

    asyncio.run(BaseProvider._close_sdk_client(AsyncCloseClient()))
    asyncio.run(BaseProvider._close_sdk_client(SyncCloseClient()))
    asyncio.run(BaseProvider._close_sdk_client(AioCloseClient()))

    assert calls == ["async-aclose", "sync-close", "aio-aclose"]


class _LifecycleProvider:
    def __init__(self) -> None:
        self.close_count = 0

    async def aclose(self) -> None:
        self.close_count += 1


def _make_request() -> SimpleNamespace:
    return SimpleNamespace(
        run=SimpleNamespace(
            id="run-id",
            user_id="user-id",
            project_id="project-id",
        ),
        thread=SimpleNamespace(id="thread-id"),
        checkpoint=SimpleNamespace(),
        db=object(),
    )


def _install_orchestrator_stubs(
    monkeypatch: pytest.MonkeyPatch,
    provider: _LifecycleProvider,
    execute_stream,
) -> None:
    prepared = SimpleNamespace(
        provider=provider,
        task_config=SimpleNamespace(provider="test", model="model-a"),
        provider_messages=[],
    )

    async def _prepare_execution(_request):
        return prepared

    async def _persist_execution(_request, _callbacks, _prepared, stream_result, *, assistant_message):
        del stream_result
        return SimpleNamespace(
            assistant_message=assistant_message,
            tool_call_summaries=[],
        )

    async def _emit_message_start(*_args, **_kwargs):
        return None

    async def _emit_terminal_events(*_args, **_kwargs):
        return None

    monkeypatch.setattr(orchestrator_module, "prepare_execution", _prepare_execution)
    monkeypatch.setattr(orchestrator_module, "execute_stream", execute_stream)
    monkeypatch.setattr(orchestrator_module, "persist_execution", _persist_execution)
    monkeypatch.setattr(
        orchestrator_module.LLMExecutionOrchestrator,
        "_create_placeholder",
        lambda _self, _request: SimpleNamespace(id="assistant-message-id"),
    )
    monkeypatch.setattr(orchestrator_module.events, "emit_message_start", _emit_message_start)
    monkeypatch.setattr(orchestrator_module.events, "emit_terminal_events", _emit_terminal_events)
    monkeypatch.setattr(
        orchestrator_module.llm_request_service,
        "create_request",
        lambda **_kwargs: None,
    )


def test_orchestrator_closes_provider_after_success(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _LifecycleProvider()

    async def _execute_stream(*_args, **_kwargs):
        return SimpleNamespace(request_id="req-test", final_snapshot=SimpleNamespace())

    _install_orchestrator_stubs(monkeypatch, provider, _execute_stream)

    asyncio.run(orchestrator_module.LLMExecutionOrchestrator().execute(_make_request(), SimpleNamespace()))

    assert provider.close_count == 1


def test_orchestrator_closes_provider_after_error(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _LifecycleProvider()

    async def _execute_stream(*_args, **_kwargs):
        raise RuntimeError("provider failed")

    _install_orchestrator_stubs(monkeypatch, provider, _execute_stream)

    with pytest.raises(RuntimeError, match="provider failed"):
        asyncio.run(orchestrator_module.LLMExecutionOrchestrator().execute(_make_request(), SimpleNamespace()))

    assert provider.close_count == 1


def test_orchestrator_closes_provider_after_cancel(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _LifecycleProvider()

    async def _execute_stream(*_args, **_kwargs):
        raise asyncio.CancelledError()

    _install_orchestrator_stubs(monkeypatch, provider, _execute_stream)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(orchestrator_module.LLMExecutionOrchestrator().execute(_make_request(), SimpleNamespace()))

    assert provider.close_count == 1
