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
        system_prompt: str = ""
        memory_template: str | None = None

    fake_prompt_contracts.ScenarioBundle = ScenarioBundle
    sys.modules["App.backend.services.prompt_runtime.contracts"] = fake_prompt_contracts

    fake_tool_engine_contracts = types.ModuleType("App.backend.services.tool_engine.contracts")

    @dataclass(frozen=True)
    class ToolOffer:
        specs_by_name: dict[str, object] = field(default_factory=dict)
        provider_tools: list[dict[str, object]] = field(default_factory=list)
        auto_approve_category_by_name: dict[str, str] = field(default_factory=dict)

    fake_tool_engine_contracts.ToolOffer = ToolOffer
    sys.modules["App.backend.services.tool_engine.contracts"] = fake_tool_engine_contracts

    fake_tool_engine = types.ModuleType("App.backend.services.tool_engine")
    fake_tool_engine.tool_engine = SimpleNamespace(
        propagate_child_terminal_state_to_parent=lambda *_args, **_kwargs: None,
    )
    sys.modules["App.backend.services.tool_engine"] = fake_tool_engine

    fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
    fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
    sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")]
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution


_install_import_stubs()

from App.backend.models.db_models import RunMessageModel, RunModel, Thread
from App.backend.providers.contracts import FinalSnapshot

events_module = importlib.import_module("App.backend.services.run_pipeline.llm_execution.events")


def test_emit_terminal_events_propagates_child_terminal_state_to_parent(monkeypatch) -> None:
    run = RunModel(
        id=uuid4(),
        thread_id=uuid4(),
        user_id=uuid4(),
        project_id=uuid4(),
        status="done",
        language="English",
    )
    thread = Thread(
        id=run.thread_id,
        project_id=run.project_id,
        user_id=run.user_id,
        thread_type="subAgent",
        status="done",
    )
    assistant_message = RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=1,
        seq_in_thread=2,
        data={"English": {"contentParts": [{"type": "content", "text": "done"}]}},
    )
    final_snapshot = FinalSnapshot(
        provider="test",
        model="model-a",
        finish_reason="stop",
        content_parts=[{"type": "content", "text": "done"}],
        tool_calls=[],
        reasoning_details=[],
        raw_native_response={"large": "provider payload"},
    )

    order: list[str] = []
    emitted_payloads: list[tuple[str, dict[str, object]]] = []

    async def _emit_fn(*, event_name: str, data: dict[str, object], **_kwargs) -> None:
        order.append(event_name)
        emitted_payloads.append((event_name, data))

    async def _sync_status_fn(**_kwargs) -> None:
        order.append("sync_status")

    async def _propagate_child_terminal_state_to_parent(_db, *, thread, run, emit) -> None:  # noqa: ANN001
        _ = thread, run, emit
        order.append("propagate_parent")

    monkeypatch.setattr(
        events_module.tool_engine,
        "propagate_child_terminal_state_to_parent",
        _propagate_child_terminal_state_to_parent,
    )

    asyncio.run(
        events_module.emit_terminal_events(
            SimpleNamespace(
                emit_fn=_emit_fn,
                sync_status_fn=_sync_status_fn,
            ),
            db=object(),
            run=run,
            thread=thread,
            assistant_message=assistant_message,
            request_id="req_123",
            final_snapshot=final_snapshot,
            tool_call_summaries=[],
        )
    )

    assert order == [
        "llm:response",
        "message:end",
        "run:status",
        "sync_status",
        "run:done",
        "propagate_parent",
    ]
    assert emitted_payloads[0][1]["request_id"] == "req_123"
    assert "raw_response" not in emitted_payloads[0][1]
    assert emitted_payloads[1][1]["request_id"] == "req_123"
