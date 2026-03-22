from __future__ import annotations

import logging
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models.db_models import RunModel, RunMessageModel, RunToolCallModel, Thread
from ..chat_attachment_service import (
    ChatAttachmentValidationError,
    chat_attachment_service,
)
from ..mcp import mcp_policy_service, mcp_resolver
from ..settings_service import settings_service
from ..storage_usage_service import (
    StorageQuotaExceededError,
    apply_project_usage_deltas,
    build_run_delta,
    build_run_message_attachment_delta,
    build_run_message_delta,
    snapshot_run_message_attachment_row,
    snapshot_run_message_row,
    snapshot_run_row,
)
from ..tool_engine import tool_engine
from .contracts import CreateContext, ResumeRunCommand, StartRunCommand
from .runtime import ExecuteLoopFn, RunPipelineRuntime
from .status_transitions import RunStatusTransitions

_UNRESOLVED_RESUME_TOOL_STATUSES = {"streaming", "validating", "pending", "processing", "working"}
logger = logging.getLogger(__name__)


def _normalize_input_payload(input_payload: dict[str, Any] | None) -> dict[str, Any]:
    return input_payload if isinstance(input_payload, dict) else {}


def _serialize_attachment_rows(rows: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            **chat_attachment_service.serialize_attachment(row),
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


class RunPipelineLifecycle:
    def __init__(
        self,
        *,
        db_factory: Callable[[], Session],
        runtime: RunPipelineRuntime,
        status_transitions: RunStatusTransitions,
        execute_loop_fn: ExecuteLoopFn,
    ) -> None:
        self._db_factory = db_factory
        self._runtime = runtime
        self._status_transitions = status_transitions
        self._execute_loop_fn = execute_loop_fn

    @staticmethod
    def _load_owned_thread_for_update(db: Session, *, thread_id: UUID, user_id: UUID) -> Thread:
        thread = (
            db.query(Thread)
            .filter(Thread.id == thread_id, Thread.user_id == user_id)
            .with_for_update()
            .first()
        )
        if thread is None:
            raise HTTPException(status_code=404, detail="Thread not found")
        return thread

    @staticmethod
    def _latest_run_for_thread(db: Session, *, thread_id: UUID) -> RunModel | None:
        return (
            db.query(RunModel)
            .filter(RunModel.thread_id == thread_id)
            .order_by(RunModel.run_seq.desc())
            .first()
        )

    @staticmethod
    def _has_pending_thread_tool(db: Session, *, thread_id: UUID) -> bool:
        return (
            db.query(RunToolCallModel.id)
            .filter(RunToolCallModel.thread_id == thread_id, RunToolCallModel.status == "pending")
            .first()
            is not None
        )

    async def start_run(self, command: StartRunCommand) -> RunModel:
        text = (command.input_text or "").strip()
        normalized_attachments = list(command.attachments or [])
        normalized_mcp_selections = list(command.mcp_selections or [])
        if not text and not normalized_attachments and not normalized_mcp_selections:
            raise HTTPException(
                status_code=400,
                detail="input_text, attachments, or mcp_selections are required for create run",
            )

        normalized_input_payload = _normalize_input_payload(command.input_payload)
        latest_active_run_id: UUID | None = None

        async with self._runtime.thread_lock(command.thread_id):
            db = self._db_factory()
            try:
                thread = self._load_owned_thread_for_update(
                    db,
                    thread_id=command.thread_id,
                    user_id=command.user_id,
                )
                if self._has_pending_thread_tool(db, thread_id=thread.id):
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                latest = self._latest_run_for_thread(db, thread_id=thread.id)
                if latest is not None and latest.status in {"running", "waiting", "processing"}:
                    latest_active_run_id = latest.id
            finally:
                db.close()

            if latest_active_run_id is not None:
                canceled = await self._runtime.cancel_task_and_wait(
                    latest_active_run_id,
                    timeout_s=5.0,
                )
                if not canceled:
                    raise HTTPException(
                        status_code=409,
                        detail="Existing run cancellation timed out; retry",
                    )

            db = self._db_factory()
            try:
                thread = self._load_owned_thread_for_update(
                    db,
                    thread_id=command.thread_id,
                    user_id=command.user_id,
                )
                if self._has_pending_thread_tool(db, thread_id=thread.id):
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                settings = settings_service._get_settings(db, command.user_id)  # pylint: disable=protected-access
                resolved_language = command.language or settings.main_language
                preset_id = settings_service.get_active_preset_id(db, command.user_id)

                latest = self._latest_run_for_thread(db, thread_id=thread.id)
                if latest is not None and latest.status in {"running", "waiting", "processing"}:
                    latest.status = "canceled"

                run = RunModel(
                    thread_id=thread.id,
                    user_id=command.user_id,
                    project_id=thread.project_id,
                    status="running",
                    run_seq=thread.next_run_seq,
                    language=resolved_language,
                    run_mode=command.run_mode,
                    surface=command.surface,
                    context_object_ids=[str(x) for x in command.context_object_ids],
                    journey_target_ids=[str(x) for x in command.journey_target_ids],
                    input_payload=normalized_input_payload,
                    mcp_request_json={
                        "selections": [
                            item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                            for item in normalized_mcp_selections
                        ]
                    },
                )
                db.add(run)
                db.flush()

                if normalized_mcp_selections:
                    if preset_id is None:
                        raise RuntimeError("No active preset selected")
                    mcp_ctx = mcp_policy_service.build_runtime_context(
                        db,
                        user_id=command.user_id,
                        preset_id=preset_id,
                        thread=thread,
                        run=run,
                        input_text=text,
                        input_payload=normalized_input_payload,
                    )
                    resolution = await mcp_resolver.resolve_selections(
                        ctx=mcp_ctx,
                        selections=normalized_mcp_selections,
                        project_id=thread.project_id,
                    )
                    run.mcp_resolution_json = resolution.model_dump(mode="json")

                msg = RunMessageModel(
                    thread_id=thread.id,
                    run_id=run.id,
                    seq=run.next_message_seq,
                    seq_in_thread=thread.next_message_seq,
                    role="user",
                    data={
                        resolved_language: {
                            "contentParts": ([{"type": "content", "text": text}] if text else []),
                            "meta": {
                                "mcpSelections": (
                                    run.mcp_resolution_json.get("audit", [])
                                    if isinstance(run.mcp_resolution_json, dict)
                                    else []
                                )
                            },
                        },
                    },
                )
                db.add(msg)
                db.flush()

                attachment_rows: list[Any] = []
                if normalized_attachments:
                    attachment_rows = chat_attachment_service.ingest_message_attachments(
                        db,
                        project_id=thread.project_id,
                        thread_id=thread.id,
                        run_id=run.id,
                        message_id=msg.id,
                        attachments=normalized_attachments,
                    )

                run.next_message_seq += 1
                thread.next_message_seq += 1
                thread.next_run_seq += 1
                thread.status = "running"
                apply_project_usage_deltas(
                    db,
                    user_id=command.user_id,
                    project_id=thread.project_id,
                    deltas=[
                        build_run_delta(None, snapshot_run_row(run)),
                        build_run_message_delta(None, snapshot_run_message_row(msg)),
                        *[
                            build_run_message_attachment_delta(
                                None,
                                snapshot_run_message_attachment_row(row),
                            )
                            for row in attachment_rows
                        ],
                    ],
                    enforce_quota=True,
                )
                db.commit()
                db.refresh(run)
                db.refresh(msg)
                for attachment_row in attachment_rows:
                    db.refresh(attachment_row)
                _ = run.thread

                user_msg_id = msg.id
                user_msg_seq = msg.seq
                user_msg_seq_in_thread = msg.seq_in_thread
                user_msg_data = msg.data
                user_msg_attachments = _serialize_attachment_rows(attachment_rows)
            except ChatAttachmentValidationError as exc:
                db.rollback()
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            except StorageQuotaExceededError:
                db.rollback()
                raise HTTPException(status_code=413, detail="Storage quota exceeded")
            finally:
                db.close()

            await self._runtime.emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=run.thread.id,
                event_name="message:user",
                data={
                    "run_id": str(run.id),
                    "message_id": str(user_msg_id),
                    "role": "user",
                    "seq": int(user_msg_seq),
                    "seq_in_thread": int(user_msg_seq_in_thread),
                    "data": user_msg_data,
                    "attachments": user_msg_attachments,
                },
            )
            await self._runtime.spawn_task(
                run.id,
                execute_loop_fn=self._execute_loop_fn,
                create_ctx=CreateContext(
                    input_text=text,
                    input_payload=normalized_input_payload,
                ),
            )
        return run

    async def resume_run(self, command: ResumeRunCommand) -> RunModel:
        async with self._runtime.thread_lock(command.thread_id):
            db = self._db_factory()
            try:
                thread = self._load_owned_thread_for_update(
                    db,
                    thread_id=command.thread_id,
                    user_id=command.user_id,
                )
                run = self._latest_run_for_thread(db, thread_id=thread.id)
                if run is None:
                    raise HTTPException(status_code=409, detail="No run exists to resume")

                has_unresolved_tool = (
                    db.query(RunToolCallModel.id)
                    .filter(
                        RunToolCallModel.run_id == run.id,
                        RunToolCallModel.status.in_(_UNRESOLVED_RESUME_TOOL_STATUSES),
                    )
                    .first()
                    is not None
                )
                if has_unresolved_tool:
                    raise HTTPException(
                        status_code=409,
                        detail="Unresolved tool call exists in latest run",
                    )

                if run.status in {"running"}:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Run status '{run.status}' is not resumable",
                    )

                if command.run_mode is not None:
                    run.run_mode = command.run_mode
                if command.surface is not None:
                    run.surface = command.surface
                if command.context_object_ids:
                    run.context_object_ids = [str(x) for x in command.context_object_ids]
                if command.journey_target_ids:
                    run.journey_target_ids = [str(x) for x in command.journey_target_ids]
                if command.language is not None:
                    run.language = command.language

                await self._status_transitions.apply_status_transition(
                    db,
                    run=run,
                    thread=thread,
                    status="running",
                    error=None,
                    emit_run_status=False,
                )
                db.refresh(run)
                _ = run.thread
            finally:
                db.close()

            await self._runtime.spawn_task(run.id, execute_loop_fn=self._execute_loop_fn)
        return run

    async def pause_run(self, *, thread_id: UUID, user_id: UUID) -> None:
        async with self._runtime.thread_lock(thread_id):
            db = self._db_factory()
            run_id: UUID | None = None
            try:
                thread = self._load_owned_thread_for_update(db, thread_id=thread_id, user_id=user_id)
                if thread.thread_type not in {"subAgent", "journey"}:
                    raise HTTPException(
                        status_code=409,
                        detail="Only sub-agent and journey threads can be paused",
                    )

                run = self._latest_run_for_thread(db, thread_id=thread.id)
                if run is None:
                    raise HTTPException(status_code=409, detail="No run exists to pause")
                if run.status == "paused":
                    return
                if run.status not in {"running", "waiting", "processing"}:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Run status '{run.status}' is not pausable",
                    )

                run_id = run.id
                await self._status_transitions.apply_status_transition(
                    db,
                    run=run,
                    thread=thread,
                    status="paused",
                    error=None,
                )
            finally:
                db.close()

            await self._runtime.cancel_task_and_wait(run_id, timeout_s=5.0)

    async def cancel_run(self, *, thread_id: UUID, user_id: UUID) -> None:
        async with self._runtime.thread_lock(thread_id):
            db = self._db_factory()
            run_id: UUID | None = None
            project_id: UUID | None = None
            try:
                run = (
                    db.query(RunModel)
                    .join(Thread, Thread.id == RunModel.thread_id)
                    .filter(
                        Thread.id == thread_id,
                        Thread.user_id == user_id,
                        RunModel.status.in_(["queued", "running", "waiting", "processing", "paused"]),
                    )
                    .order_by(RunModel.created_at.desc())
                    .first()
                )
                if run is None:
                    return
                run_id = run.id
                project_id = run.project_id
                thread_row = run.thread
                if thread_row is not None:
                    await self._status_transitions.apply_status_transition(
                        db,
                        run=run,
                        thread=thread_row,
                        status="canceled",
                        error=None,
                    )
            finally:
                db.close()

            await self._runtime.cancel_task_and_wait(run_id, timeout_s=5.0)

            if project_id is not None:
                await self._runtime.emit(
                    user_id=user_id,
                    project_id=project_id,
                    thread_id=thread_id,
                    event_name="run:canceled",
                    data={"run_id": str(run_id)},
                )

                db2 = self._db_factory()
                try:
                    canceled_run = db2.query(RunModel).filter(RunModel.id == run_id).first()
                    if canceled_run is not None:
                        canceled_thread = canceled_run.thread
                        if canceled_thread is not None:
                            await tool_engine.propagate_child_terminal_state_to_parent(
                                db2,
                                thread=canceled_thread,
                                run=canceled_run,
                                emit=self._runtime.emit,
                            )
                except Exception:
                    logger.warning(
                        "Failed to propagate cancel to parent for run %s",
                        run_id,
                        exc_info=True,
                    )
                finally:
                    db2.close()

    async def cancel_run_for_delete(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
        timeout_s: float = 5.0,
    ) -> None:
        async with self._runtime.thread_lock(thread_id):
            db = self._db_factory()
            run_id: UUID | None = None
            project_id: UUID | None = None
            try:
                run = (
                    db.query(RunModel)
                    .join(Thread, Thread.id == RunModel.thread_id)
                    .filter(
                        Thread.id == thread_id,
                        Thread.user_id == user_id,
                        RunModel.status.in_(["queued", "running", "waiting", "processing"]),
                    )
                    .order_by(RunModel.created_at.desc())
                    .first()
                )
                if run is None:
                    return
                run_id = run.id
                project_id = run.project_id
                thread_row = run.thread
                if thread_row is not None:
                    await self._status_transitions.apply_status_transition(
                        db,
                        run=run,
                        thread=thread_row,
                        status="canceled",
                        error=None,
                    )
            finally:
                db.close()

            canceled = await self._runtime.cancel_task_and_wait(
                run_id,
                timeout_s=max(float(timeout_s), 0.1),
            )
            if not canceled:
                raise HTTPException(
                    status_code=409,
                    detail="Run cancellation timed out; retry deletion",
                )

            if project_id is not None:
                await self._runtime.emit(
                    user_id=user_id,
                    project_id=project_id,
                    thread_id=thread_id,
                    event_name="run:canceled",
                    data={"run_id": str(run_id)},
                )
