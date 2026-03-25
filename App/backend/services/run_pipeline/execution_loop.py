from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable
from uuid import UUID

from jinja2.exceptions import TemplateSyntaxError, UndefinedError
from jinja2.sandbox import SecurityError
from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from ..run_status_policy import RUN_EXECUTION_NOOP_STATUSES
from ..settings_service import settings_service
from ..storage_usage_service import (
    apply_project_usage_deltas,
    build_run_message_delta,
    snapshot_run_message_row,
)
from ..template_engine import FragmentNotFoundError, TemplateRenderLimitError, format_template_error
from . import prompt_assembly
from .contracts import CreateContext
from .llm_execution import (
    ExecutionCheckpoint,
    LLMExecutionCallbacks,
    LLMExecutionOrchestrator,
    LLMExecutionRequest,
)
from .runtime import RunPipelineRuntime
from .status_transitions import RunStatusTransitions
from .tool_call_persistence import RunToolCallPersistence

logger = logging.getLogger(__name__)


def has_message_content(data: dict | None) -> bool:
    if not data or not isinstance(data, dict):
        return False
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        parts = entry.get("contentParts")
        if isinstance(parts, list) and any(
            isinstance(part, dict)
            and part.get("type") == "content"
            and isinstance(part.get("text"), str)
            and part["text"].strip()
            for part in parts
        ):
            return True
        if entry.get("reasoningDetail"):
            return True
    return False


def has_persisted_tool_calls(db: Session, assistant_message_id: Any) -> bool:
    row = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.assistant_message_id == assistant_message_id)
        .first()
    )
    return row is not None


def format_user_run_error(exc: Exception) -> str:
    if isinstance(
        exc,
        (
            FragmentNotFoundError,
            TemplateRenderLimitError,
            SecurityError,
            TemplateSyntaxError,
            UndefinedError,
        ),
    ):
        return format_template_error(exc)

    text = str(exc).strip()
    return text or "Run failed."


class RunPipelineExecutionLoop:
    def __init__(
        self,
        *,
        db_factory: Callable[[], Session],
        runtime: RunPipelineRuntime,
        status_transitions: RunStatusTransitions,
        tool_call_persistence: RunToolCallPersistence,
        llm_execution_orchestrator: LLMExecutionOrchestrator | None = None,
    ) -> None:
        self._db_factory = db_factory
        self._runtime = runtime
        self._status_transitions = status_transitions
        self._tool_call_persistence = tool_call_persistence
        self._llm_execution_orchestrator = llm_execution_orchestrator or LLMExecutionOrchestrator()

    def discard_unfinished_assistant_message(
        self,
        db: Session,
        *,
        run: RunModel,
        execution_checkpoint: ExecutionCheckpoint,
    ) -> UUID | None:
        message_id = execution_checkpoint.message_id
        if message_id is None or execution_checkpoint.finalized:
            return None

        assistant_message = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.id == message_id)
            .first()
        )
        if assistant_message is None:
            return None

        msg_data = assistant_message.data if isinstance(assistant_message.data, dict) else {}
        if has_message_content(msg_data):
            return None
        if has_persisted_tool_calls(db, assistant_message.id):
            return None

        message_before = snapshot_run_message_row(assistant_message)
        db.delete(assistant_message)
        apply_project_usage_deltas(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            deltas=[build_run_message_delta(message_before, None)],
            enforce_quota=False,
        )
        db.flush()
        return assistant_message.id

    async def execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        db = self._db_factory()
        execution_checkpoint = ExecutionCheckpoint()
        try:
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is None:
                return
            thread = db.query(Thread).filter(Thread.id == run.thread_id).first()
            if thread is None:
                return

            if run.status in RUN_EXECUTION_NOOP_STATUSES:
                return

            await self._runtime.emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:status",
                data={"run_id": str(run.id), "status": "running", "thread_type": thread.thread_type},
            )

            settings: UserSettings = settings_service._get_settings(db, run.user_id)  # pylint: disable=protected-access
            restored_payload = run.input_payload or {}

            if create_ctx is not None:
                system_prompt, conversation, scenario_bundle = await prompt_assembly.assemble_create(
                    db,
                    run=run,
                    thread=thread,
                    settings=settings,
                    create_ctx=create_ctx,
                )
            else:
                system_prompt, conversation, scenario_bundle = await prompt_assembly.assemble_resume(
                    db,
                    run=run,
                    thread=thread,
                    settings=settings,
                    input_payload=restored_payload,
                )

            db.refresh(run)
            if run.status in RUN_EXECUTION_NOOP_STATUSES:
                return

            await self._llm_execution_orchestrator.execute(
                LLMExecutionRequest(
                    db=db,
                    run=run,
                    thread=thread,
                    settings=settings,
                    system_prompt=system_prompt,
                    conversation=conversation,
                    scenario_bundle=scenario_bundle,
                    input_payload=(
                        create_ctx.input_payload if create_ctx is not None else restored_payload
                    ),
                    checkpoint=execution_checkpoint,
                ),
                LLMExecutionCallbacks(
                    emit_fn=self._runtime.emit,
                    persist_tool_calls_fn=self._tool_call_persistence.persist_tool_calls,
                    sync_status_fn=self._status_transitions.sync_status_side_effects,
                ),
            )
        except asyncio.CancelledError:
            try:
                db.expire_all()
                run = db.query(RunModel).filter(RunModel.id == run_id).first()
                if run is not None:
                    thread = run.thread
                    if run.status not in RUN_EXECUTION_NOOP_STATUSES and thread is not None:
                        await self._status_transitions.apply_status_transition(
                            db,
                            run=run,
                            thread=thread,
                            status="canceled",
                            error=None,
                        )
            finally:
                raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Run %s failed: %s", run_id, exc, exc_info=True)
            db.rollback()
            user_error = format_user_run_error(exc)
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is not None:
                thread = run.thread
                if thread is not None:
                    discarded_message_id = self.discard_unfinished_assistant_message(
                        db,
                        run=run,
                        execution_checkpoint=execution_checkpoint,
                    )
                    pre_emit_events = (
                        [
                            (
                                "message:error",
                                {
                                    "run_id": str(run.id),
                                    "message_id": str(discarded_message_id),
                                    "error": user_error,
                                },
                            )
                        ]
                        if discarded_message_id is not None
                        else None
                    )
                    await self._status_transitions.apply_status_transition(
                        db,
                        run=run,
                        thread=thread,
                        status="error",
                        error=user_error,
                        emit_error=True,
                        pre_emit_events=pre_emit_events,
                    )
        finally:
            db.close()
