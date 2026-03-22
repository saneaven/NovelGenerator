from __future__ import annotations

from ....models.db_models import RunMessageModel
from ...storage_usage_service import (
    apply_project_usage_delta,
    build_run_message_delta,
    snapshot_run_message_row,
)
from . import events
from .contracts import LLMExecutionCallbacks, LLMExecutionRequest
from .persist import persist_execution
from .prepare import prepare_execution
from .stream import execute_stream


class LLMExecutionOrchestrator:
    async def execute(
        self,
        request: LLMExecutionRequest,
        callbacks: LLMExecutionCallbacks,
    ) -> None:
        prepared = await prepare_execution(request)
        assistant_message = self._create_placeholder(request)
        await events.emit_message_start(
            callbacks,
            run=request.run,
            thread=request.thread,
            assistant_message=assistant_message,
        )
        request.checkpoint.message_id = assistant_message.id
        request.checkpoint.finalized = False

        stream_result = await execute_stream(
            request,
            callbacks,
            prepared,
            assistant_message=assistant_message,
        )
        persisted_result = await persist_execution(
            request,
            callbacks,
            prepared,
            stream_result,
            assistant_message=assistant_message,
        )
        await events.emit_terminal_events(
            callbacks,
            db=request.db,
            run=request.run,
            thread=request.thread,
            assistant_message=persisted_result.assistant_message,
            final_snapshot=stream_result.final_snapshot,
            tool_call_summaries=persisted_result.tool_call_summaries,
        )

    @staticmethod
    def _create_placeholder(request: LLMExecutionRequest) -> RunMessageModel:
        db = request.db
        run = request.run
        thread = request.thread

        assistant_message = RunMessageModel(
            thread_id=thread.id,
            run_id=run.id,
            seq=run.next_message_seq,
            seq_in_thread=thread.next_message_seq,
            role="assistant",
            data={run.language: {"contentParts": []}},
        )
        db.add(assistant_message)
        db.flush()
        run.next_message_seq += 1
        thread.next_message_seq += 1
        apply_project_usage_delta(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            delta=build_run_message_delta(None, snapshot_run_message_row(assistant_message)),
            enforce_quota=True,
        )
        db.commit()
        return assistant_message
