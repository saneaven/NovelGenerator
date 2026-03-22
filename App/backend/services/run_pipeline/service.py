from __future__ import annotations

from typing import Any, Callable
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread
from ..chat_attachment_service import IncomingMessageAttachment
from ..runtime_event_dispatcher import RuntimeEventDispatcher
from ..tool_engine.contracts import ToolOffer
from . import prompt_assembly
from .contracts import CreateContext, ResumeRunCommand, StartRunCommand
from .execution_loop import (
    RunPipelineExecutionLoop,
    format_user_run_error as _format_user_run_error,
    has_message_content as _has_message_content,
    has_persisted_tool_calls as _has_persisted_tool_calls,
)
from .lifecycle import RunPipelineLifecycle
from .llm_execution import ExecutionCheckpoint, LLMExecutionOrchestrator
from .runtime import RunPipelineRuntime
from .status_transitions import RunStatusTransitions
from .tool_call_persistence import RunToolCallPersistence


class RunPipeline:
    def __init__(self, db_factory: Callable[[], Session], event_dispatcher: RuntimeEventDispatcher):
        self._db_factory = db_factory
        self._event_dispatcher = event_dispatcher

        self._runtime = RunPipelineRuntime(event_dispatcher)
        self._status_transitions = RunStatusTransitions(
            runtime=self._runtime,
            event_dispatcher=event_dispatcher,
        )
        self._tool_call_persistence = RunToolCallPersistence(runtime=self._runtime)
        self._execution_loop = RunPipelineExecutionLoop(
            db_factory=db_factory,
            runtime=self._runtime,
            status_transitions=self._status_transitions,
            tool_call_persistence=self._tool_call_persistence,
        )
        self._lifecycle = RunPipelineLifecycle(
            db_factory=db_factory,
            runtime=self._runtime,
            status_transitions=self._status_transitions,
            execute_loop_fn=self.execute_loop,
        )

    def _thread_lock(self, thread_id: UUID):
        return self._runtime.thread_lock(thread_id)

    async def _emit(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        thread_id: UUID,
        event_name: str,
        data: dict[str, Any],
    ) -> None:
        await self._runtime.emit(
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            event_name=event_name,
            data=data,
        )

    async def _spawn_task(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        await self._runtime.spawn_task(
            run_id,
            execute_loop_fn=self.execute_loop,
            create_ctx=create_ctx,
        )

    async def spawn_execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        await self._spawn_task(run_id, create_ctx=create_ctx)

    async def _cancel_task_and_wait(self, run_id: UUID, *, timeout_s: float = 5.0) -> bool:
        return await self._runtime.cancel_task_and_wait(run_id, timeout_s=timeout_s)

    async def _sync_status_side_effects(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        error: str | None,
        emit_error: bool = False,
        emit_run_status: bool = True,
        extra_status_data: dict[str, Any] | None = None,
        pre_emit_events: list[tuple[str, dict[str, Any]]] | None = None,
    ) -> None:
        await self._status_transitions.sync_status_side_effects(
            db,
            run=run,
            thread=thread,
            error=error,
            emit_error=emit_error,
            emit_run_status=emit_run_status,
            extra_status_data=extra_status_data,
            pre_emit_events=pre_emit_events,
        )

    async def _apply_status_transition(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        status: str,
        error: str | None,
        emit_error: bool = False,
        emit_run_status: bool = True,
        extra_status_data: dict[str, Any] | None = None,
        pre_emit_events: list[tuple[str, dict[str, Any]]] | None = None,
    ) -> None:
        await self._status_transitions.apply_status_transition(
            db,
            run=run,
            thread=thread,
            status=status,
            error=error,
            emit_error=emit_error,
            emit_run_status=emit_run_status,
            extra_status_data=extra_status_data,
            pre_emit_events=pre_emit_events,
        )

    def _discard_unfinished_assistant_message(
        self,
        db: Session,
        *,
        run: RunModel,
        execution_checkpoint: ExecutionCheckpoint,
    ) -> UUID | None:
        return self._execution_loop.discard_unfinished_assistant_message(
            db,
            run=run,
            execution_checkpoint=execution_checkpoint,
        )

    async def start_run(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
        input_text: str,
        input_payload: dict[str, Any] | None,
        run_mode: str | None,
        surface: str | None,
        context_object_ids: list[UUID],
        journey_target_ids: list[UUID],
        language: str | None,
        attachments: list[IncomingMessageAttachment] | None = None,
        mcp_selections: list[Any] | None = None,
    ) -> RunModel:
        return await self._lifecycle.start_run(
            StartRunCommand(
                thread_id=thread_id,
                user_id=user_id,
                input_text=input_text,
                input_payload=input_payload,
                run_mode=run_mode,
                surface=surface,
                context_object_ids=context_object_ids,
                journey_target_ids=journey_target_ids,
                language=language,
                attachments=attachments,
                mcp_selections=mcp_selections,
            )
        )

    async def resume_run(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
        run_mode: str | None,
        surface: str | None,
        context_object_ids: list[UUID],
        journey_target_ids: list[UUID],
        language: str | None,
    ) -> RunModel:
        return await self._lifecycle.resume_run(
            ResumeRunCommand(
                thread_id=thread_id,
                user_id=user_id,
                run_mode=run_mode,
                surface=surface,
                context_object_ids=context_object_ids,
                journey_target_ids=journey_target_ids,
                language=language,
            )
        )

    async def pause_run(self, *, thread_id: UUID, user_id: UUID) -> None:
        await self._lifecycle.pause_run(thread_id=thread_id, user_id=user_id)

    async def cancel_run(self, *, thread_id: UUID, user_id: UUID) -> None:
        await self._lifecycle.cancel_run(thread_id=thread_id, user_id=user_id)

    async def cancel_run_for_delete(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
        timeout_s: float = 5.0,
    ) -> None:
        await self._lifecycle.cancel_run_for_delete(
            thread_id=thread_id,
            user_id=user_id,
            timeout_s=timeout_s,
        )

    async def _persist_tool_calls(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        assistant_message: RunMessageModel,
        tool_calls: list[Any],
        offer: ToolOffer,
        preset_id: UUID | None,
    ) -> list[RunToolCallModel]:
        return await self._tool_call_persistence.persist_tool_calls(
            db,
            thread=thread,
            run=run,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            offer=offer,
            preset_id=preset_id,
        )

    async def execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        await self._execution_loop.execute_loop(run_id, create_ctx=create_ctx)
