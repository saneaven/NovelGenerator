from __future__ import annotations

import asyncio
import importlib
import os
import sys
import types
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

    fake_token_count = types.ModuleType("App.backend.services.token_count_service")

    async def count_message_tokens(*_args, **_kwargs) -> int:
        return 0

    fake_token_count.count_message_tokens = count_message_tokens
    sys.modules["App.backend.services.token_count_service"] = fake_token_count

    fake_storage_usage = types.ModuleType("App.backend.services.storage_usage_service")
    fake_storage_usage.apply_project_usage_delta = lambda *_args, **_kwargs: None
    fake_storage_usage.build_run_message_delta = lambda *_args, **_kwargs: None
    fake_storage_usage.snapshot_run_message_row = lambda row: row
    sys.modules["App.backend.services.storage_usage_service"] = fake_storage_usage

    fake_raw_output = types.ModuleType("App.backend.services.run_pipeline.raw_output")

    async def apply_raw_output(*_args, **_kwargs) -> None:
        return None

    fake_raw_output.apply_raw_output = apply_raw_output
    sys.modules["App.backend.services.run_pipeline.raw_output"] = fake_raw_output

    fake_run_pipeline = types.ModuleType("App.backend.services.run_pipeline")
    fake_run_pipeline.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline")]
    sys.modules["App.backend.services.run_pipeline"] = fake_run_pipeline

    fake_llm_execution = types.ModuleType("App.backend.services.run_pipeline.llm_execution")
    fake_llm_execution.__path__ = [str(ROOT / "App" / "backend" / "services" / "run_pipeline" / "llm_execution")]
    sys.modules["App.backend.services.run_pipeline.llm_execution"] = fake_llm_execution


_install_import_stubs()

from App.backend.models.db_models import RunMessageModel, RunModel, Thread
from App.backend.providers.shared.contracts import FinalSnapshot, FinalToolCall

persist_module = importlib.import_module("App.backend.services.run_pipeline.llm_execution.persist")


def test_persist_execution_rejects_tool_calls_in_raw_output_mode() -> None:
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
    assistant_message = RunMessageModel(
        id=uuid4(),
        thread_id=thread.id,
        run_id=run.id,
        role="assistant",
        seq=0,
        seq_in_thread=0,
        data={},
    )

    request = SimpleNamespace(
        db=None,
        run=run,
        thread=thread,
        input_payload={},
        checkpoint=SimpleNamespace(finalized=False),
    )
    prepared = SimpleNamespace(
        output_mode="raw_output",
        thinking_mode="off",
    )
    stream_result = SimpleNamespace(
        final_snapshot=FinalSnapshot(
            provider="test",
            model="model-a",
            finish_reason="tool_calls",
            content_parts=[],
            tool_calls=[
                FinalToolCall(
                    id="call_1",
                    tool_name="create_story_entity",
                    raw_arguments="{}",
                    arguments={},
                )
            ],
            reasoning_details=[],
        )
    )

    with pytest.raises(RuntimeError, match="Raw output mode cannot include tool calls"):
        asyncio.run(
            persist_module.persist_execution(
                request,
                SimpleNamespace(),
                prepared,
                stream_result,
                assistant_message=assistant_message,
            )
        )
