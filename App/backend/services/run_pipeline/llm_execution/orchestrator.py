from __future__ import annotations

from uuid import uuid4

from ....models.db_models import RunMessageModel
from ...llm_request_service import llm_request_service
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
        request_id = f"req_{uuid4().hex}"
        llm_request_service.create_request(
            request_id=request_id,
            user_id=request.run.user_id,
            project_id=request.run.project_id,
            thread_id=request.thread.id,
            run_id=request.run.id,
            assistant_message_id=assistant_message.id,
            provider=prepared.task_config.provider,
            model=prepared.task_config.model,
        )
        if prepared.task_config.provider == "custom":
            from ....providers.custom import build_request_context

            prepared.provider.set_request_context(
                build_request_context(
                    run=request.run,
                    thread=request.thread,
                    provider_messages=prepared.provider_messages,
                    task_config=prepared.task_config,
                    request_id=request_id,
                    assistant_message_id=str(assistant_message.id),
                )
            )
        request.checkpoint.request_id = request_id
        request.checkpoint.message_id = assistant_message.id
        request.checkpoint.finalized = False
        await events.emit_message_start(
            callbacks,
            run=request.run,
            thread=request.thread,
            assistant_message=assistant_message,
            request_id=request_id,
        )

        stream_result = await execute_stream(
            request,
            callbacks,
            prepared,
            assistant_message=assistant_message,
            request_id=request_id,
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
            request_id=stream_result.request_id or request_id,
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
