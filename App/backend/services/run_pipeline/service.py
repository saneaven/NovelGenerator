from __future__ import annotations

import asyncio
import json
import logging
from types import SimpleNamespace
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException
from jinja2.exceptions import TemplateSyntaxError, UndefinedError
from jinja2.sandbox import SecurityError
from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from ..chat_attachment_service import (
    ChatAttachmentValidationError,
    IncomingMessageAttachment,
    chat_attachment_service,
)
from ..runtime_event_dispatcher import RuntimeEventDispatcher
from ..settings_service import settings_service
from ..mcp import mcp_policy_service, mcp_resolver
from ..storage_usage_service import (
    StorageQuotaExceededError,
    apply_project_usage_deltas,
    build_run_delta,
    build_run_message_delta,
    build_run_message_attachment_delta,
    build_tool_call_delta,
    snapshot_run_message_attachment_row,
    snapshot_run_message_row,
    snapshot_run_row,
    snapshot_tool_call_row,
)
from ..thread_runtime_sync_service import emit_runtime_sync_events, sync_explicit_run_thread_status
from ..template_engine import FragmentNotFoundError, TemplateRenderLimitError, format_template_error
from ..tool_engine import tool_engine
from ..tool_engine.contracts import ToolOffer
from .contracts import AssistantMessageExecutionState, CreateContext
from . import llm_executor
from . import prompt_assembly

logger = logging.getLogger(__name__)

_UNRESOLVED_RESUME_TOOL_STATUSES = {"streaming", "validating", "pending", "processing", "working"}


def _has_message_content(data: dict | None) -> bool:
    """Return True if *data* contains at least one language entry with real content."""
    if not data or not isinstance(data, dict):
        return False
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        parts = entry.get("contentParts")
        if isinstance(parts, list) and any(
            isinstance(p, dict)
            and p.get("type") == "content"
            and isinstance(p.get("text"), str)
            and p["text"].strip()
            for p in parts
        ):
            return True
        if entry.get("reasoningDetail"):
            return True
    return False


def _has_persisted_tool_calls(db: Session, assistant_message_id: Any) -> bool:
    row = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.assistant_message_id == assistant_message_id)
        .first()
    )
    return row is not None


def _format_user_run_error(exc: Exception) -> str:
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


class RunPipeline:

    def __init__(self, db_factory: Callable[[], Session], event_dispatcher: RuntimeEventDispatcher):
        self._db_factory = db_factory
        self._event_dispatcher = event_dispatcher
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._task_lock = asyncio.Lock()
        self._thread_locks: dict[UUID, asyncio.Lock] = {}

    def _thread_lock(self, thread_id: UUID) -> asyncio.Lock:
        lock = self._thread_locks.get(thread_id)
        if lock is None:
            lock = asyncio.Lock()
            self._thread_locks[thread_id] = lock
        return lock

    async def _emit(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        thread_id: UUID,
        event_name: str,
        data: dict[str, Any],
    ) -> None:
        await self._event_dispatcher.emit_runtime_event(
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            event_name=event_name,
            data=data,
        )

    async def _spawn_task(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is not None and not existing.done():
                return

            task = asyncio.create_task(self.execute_loop(run_id, create_ctx=create_ctx))
            self._tasks[run_id] = task

            def _cleanup(done_task: asyncio.Task) -> None:
                _ = done_task
                self._tasks.pop(run_id, None)

            task.add_done_callback(_cleanup)

    async def spawn_execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        await self._spawn_task(run_id, create_ctx=create_ctx)

    async def _cancel_task_and_wait(self, run_id: UUID, *, timeout_s: float = 5.0) -> bool:
        task: asyncio.Task | None = None
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is None or existing.done():
                return True
            existing.cancel()
            task = existing

        try:
            await asyncio.wait_for(task, timeout=max(float(timeout_s), 0.1))
            return True
        except asyncio.CancelledError:
            return True
        except asyncio.TimeoutError:
            return False
        except Exception:
            return True

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
        sync_result = sync_explicit_run_thread_status(
            db,
            run=run,
            thread=thread,
            error=error,
        )
        db.commit()
        for event_name, payload in pre_emit_events or []:
            await self._emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name=event_name,
                data=payload,
            )
        if emit_error and error:
            await self._emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:error",
                data={
                    "run_id": str(run.id),
                    "error": error,
                },
            )
        await emit_runtime_sync_events(
            SimpleNamespace(
                emit_runtime_event=self._emit,
                emit_project_event=getattr(self._event_dispatcher, "emit_project_event", None),
            ),
            result=sync_result,
            emit_run_status=emit_run_status,
            extra_status_data=extra_status_data,
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
        run_before = snapshot_run_row(run)
        run.status = status
        run.error = error if status == "error" else None
        thread.status = status
        apply_project_usage_deltas(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            deltas=[build_run_delta(run_before, snapshot_run_row(run))],
            enforce_quota=False,
        )
        db.flush()
        await self._sync_status_side_effects(
            db,
            run=run,
            thread=thread,
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
        assistant_message_state: AssistantMessageExecutionState,
    ) -> UUID | None:
        message_id = assistant_message_state.message_id
        if message_id is None or assistant_message_state.finalized:
            return None

        assistant_message = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.id == message_id)
            .first()
        )
        if assistant_message is None:
            return None

        msg_data = assistant_message.data if isinstance(assistant_message.data, dict) else {}
        if _has_message_content(msg_data):
            return None
        if _has_persisted_tool_calls(db, assistant_message.id):
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

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

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
        text = (input_text or "").strip()
        normalized_attachments = list(attachments or [])
        normalized_mcp_selections = list(mcp_selections or [])
        if not text and not normalized_attachments and not normalized_mcp_selections:
            raise HTTPException(status_code=400, detail="input_text, attachments, or mcp_selections are required for create run")

        normalized_input_payload = input_payload if isinstance(input_payload, dict) else {}
        latest_active_run_id: UUID | None = None

        async with self._thread_lock(thread_id):
            db = self._db_factory()
            try:
                thread = (
                    db.query(Thread)
                    .filter(Thread.id == thread_id, Thread.user_id == user_id)
                    .with_for_update()
                    .first()
                )
                if thread is None:
                    raise HTTPException(status_code=404, detail="Thread not found")

                has_pending_tool = (
                    db.query(RunToolCallModel.id)
                    .filter(RunToolCallModel.thread_id == thread.id, RunToolCallModel.status == "pending")
                    .first()
                    is not None
                )
                if has_pending_tool:
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                latest = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
                if latest is not None and latest.status in {"running", "waiting", "processing"}:
                    latest_active_run_id = latest.id
            finally:
                db.close()

            if latest_active_run_id is not None:
                canceled = await self._cancel_task_and_wait(latest_active_run_id, timeout_s=5.0)
                if not canceled:
                    raise HTTPException(status_code=409, detail="Existing run cancellation timed out; retry")

            db = self._db_factory()
            try:
                thread = (
                    db.query(Thread)
                    .filter(Thread.id == thread_id, Thread.user_id == user_id)
                    .with_for_update()
                    .first()
                )
                if thread is None:
                    raise HTTPException(status_code=404, detail="Thread not found")

                has_pending_tool = (
                    db.query(RunToolCallModel.id)
                    .filter(RunToolCallModel.thread_id == thread.id, RunToolCallModel.status == "pending")
                    .first()
                    is not None
                )
                if has_pending_tool:
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                settings = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
                resolved_language = language or settings.main_language
                preset_id = settings_service.get_active_preset_id(db, user_id)

                latest = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
                if latest is not None and latest.status in {"running", "waiting", "processing"}:
                    latest.status = "canceled"

                run = RunModel(
                    thread_id=thread.id,
                    user_id=user_id,
                    project_id=thread.project_id,
                    status="running",
                    run_seq=thread.next_run_seq,
                    language=resolved_language,
                    run_mode=run_mode,
                    surface=surface,
                    context_object_ids=[str(x) for x in context_object_ids],
                    journey_target_ids=[str(x) for x in journey_target_ids],
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
                        user_id=user_id,
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

                attachment_rows = []
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
                    user_id=user_id,
                    project_id=thread.project_id,
                    deltas=[
                        build_run_delta(None, snapshot_run_row(run)),
                        build_run_message_delta(None, snapshot_run_message_row(msg)),
                        *[
                            build_run_message_attachment_delta(None, snapshot_run_message_attachment_row(row))
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
                _ = run.thread  # eager-load before session closes

                # Capture user message fields before session closes.
                user_msg_id = msg.id
                user_msg_seq = msg.seq
                user_msg_seq_in_thread = msg.seq_in_thread
                user_msg_data = msg.data
                user_msg_attachments = [
                    {
                        **chat_attachment_service.serialize_attachment(row),
                        "created_at": row.created_at.isoformat(),
                    }
                    for row in attachment_rows
                ]
            except ChatAttachmentValidationError as exc:
                db.rollback()
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            except StorageQuotaExceededError:
                db.rollback()
                raise HTTPException(status_code=413, detail="Storage quota exceeded")
            finally:
                db.close()

            await self._emit(
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
            await self._spawn_task(run.id, create_ctx=CreateContext(
                input_text=text,
                input_payload=normalized_input_payload,
            ))
        return run

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
        async with self._thread_lock(thread_id):
            db = self._db_factory()
            try:
                thread = (
                    db.query(Thread)
                    .filter(Thread.id == thread_id, Thread.user_id == user_id)
                    .with_for_update()
                    .first()
                )
                if thread is None:
                    raise HTTPException(status_code=404, detail="Thread not found")

                run = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
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
                    raise HTTPException(status_code=409, detail="Unresolved tool call exists in latest run")

                _UNRESUMABLE_STATUSES = {"running"}
                if run.status in _UNRESUMABLE_STATUSES:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Run status '{run.status}' is not resumable",
                    )

                if run_mode is not None:
                    run.run_mode = run_mode
                if surface is not None:
                    run.surface = surface
                if context_object_ids:
                    run.context_object_ids = [str(x) for x in context_object_ids]
                if journey_target_ids:
                    run.journey_target_ids = [str(x) for x in journey_target_ids]
                if language is not None:
                    run.language = language

                await self._apply_status_transition(
                    db,
                    run=run,
                    thread=thread,
                    status="running",
                    error=None,
                    emit_run_status=False,
                )
                db.refresh(run)
                _ = run.thread  # eager-load before session closes
            finally:
                db.close()

            await self._spawn_task(run.id)
        return run

    async def pause_run(self, *, thread_id: UUID, user_id: UUID) -> None:
        async with self._thread_lock(thread_id):
            db = self._db_factory()
            run_id: UUID | None = None
            project_id: UUID | None = None
            try:
                thread = (
                    db.query(Thread)
                    .filter(Thread.id == thread_id, Thread.user_id == user_id)
                    .with_for_update()
                    .first()
                )
                if thread is None:
                    raise HTTPException(status_code=404, detail="Thread not found")
                if thread.thread_type not in {"subAgent", "journey"}:
                    raise HTTPException(status_code=409, detail="Only sub-agent and journey threads can be paused")

                run = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
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
                project_id = run.project_id
                await self._apply_status_transition(
                    db,
                    run=run,
                    thread=thread,
                    status="paused",
                    error=None,
                )
            finally:
                db.close()

            await self._cancel_task_and_wait(run_id, timeout_s=5.0)

    async def cancel_run(self, *, thread_id: UUID, user_id: UUID) -> None:
        async with self._thread_lock(thread_id):
            # Find the latest active run for this thread.
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
                    return  # No active run to cancel
                run_id = run.id
                project_id = run.project_id
                thread_row = run.thread
                if thread_row is not None:
                    await self._apply_status_transition(
                        db,
                        run=run,
                        thread=thread_row,
                        status="canceled",
                        error=None,
                    )
            finally:
                db.close()

            # Cancel the asyncio task and wait for it to finish.
            await self._cancel_task_and_wait(run_id, timeout_s=5.0)

            if project_id is not None:
                await self._emit(
                    user_id=user_id,
                    project_id=project_id,
                    thread_id=thread_id,
                    event_name="run:canceled",
                    data={"run_id": str(run_id)},
                )

                # Propagate cancellation to parent if this is a sub-agent child thread
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
                                emit=self._emit,
                            )
                except Exception:
                    logger.warning(
                        "Failed to propagate cancel to parent for run %s",
                        run_id,
                        exc_info=True,
                    )
                finally:
                    db2.close()

    async def cancel_run_for_delete(self, *, thread_id: UUID, user_id: UUID, timeout_s: float = 5.0) -> None:
        async with self._thread_lock(thread_id):
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
                    await self._apply_status_transition(
                        db,
                        run=run,
                        thread=thread_row,
                        status="canceled",
                        error=None,
                    )
            finally:
                db.close()

            canceled = await self._cancel_task_and_wait(run_id, timeout_s=max(float(timeout_s), 0.1))
            if not canceled:
                raise HTTPException(
                    status_code=409,
                    detail="Run cancellation timed out; retry deletion",
                )

            if project_id is not None:
                await self._emit(
                    user_id=user_id,
                    project_id=project_id,
                    thread_id=thread_id,
                    event_name="run:canceled",
                    data={"run_id": str(run_id)},
                )

    # ------------------------------------------------------------------
    # Tool call persistence
    # ------------------------------------------------------------------

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
        out: list[RunToolCallModel] = []
        deltas = []

        for idx, tc in enumerate(tool_calls):
            llm_call_id = str(tc.id or f"tool_call_{idx}")
            tool_name = str(tc.tool_name or "")
            arguments = tc.arguments if isinstance(tc.arguments, dict) else {}
            parse_error = str(getattr(tc, "parse_error", "") or "").strip() or None
            stream_key = llm_call_id if llm_call_id.startswith(("index:", "anon:")) else f"id:{llm_call_id}"

            tool_call_text = json.dumps(
                {
                    "id": llm_call_id,
                    "tool_name": tool_name,
                    "arguments": arguments,
                },
                ensure_ascii=False,
            )
            tool_msg = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=run.next_message_seq,
                seq_in_thread=thread.next_message_seq,
                role="tool_call",
                data={
                    run.language: {"contentParts": [{"type": "content", "text": tool_call_text}]},
                },
            )
            db.add(tool_msg)
            db.flush()
            run.next_message_seq += 1
            thread.next_message_seq += 1

            row = RunToolCallModel(
                thread_id=thread.id,
                run_id=run.id,
                message_id=tool_msg.id,
                assistant_message_id=assistant_message.id,
                call_seq=idx,
                llm_call_id=llm_call_id,
                tool_name=tool_name,
                arguments=arguments,
                extra_content=(tc.extra_content if isinstance(getattr(tc, "extra_content", None), dict) else None),
                status="validating",
            )
            db.add(row)
            db.flush()

            # Link the tool_call message back to its parent tool call for cascade deletion.
            tool_msg.parent_tool_call_id = row.id

            if parse_error is not None:
                row.status = "failed"
                row.reason = f"[parse_tool_call_arguments] {parse_error}"
            else:
                validation = await tool_engine.validate_tool_call(
                    db=db,
                    thread=thread,
                    run=run,
                    settings=settings_service._get_settings(db, run.user_id),  # pylint: disable=protected-access
                    tool_name=tool_name,
                    args=arguments,
                    offer=offer,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    language=run.language,
                    preset_id=preset_id,
                    input_payload=run.input_payload if isinstance(run.input_payload, dict) else {},
                    vector_storage_enabled=settings_service.is_vector_storage_enabled(db, run.user_id),
                )
                if validation.valid:
                    row.status = "pending"
                    row.reason = None
                else:
                    row.status = "failed"
                    row.reason = f"[{validation.validator}] {validation.reason}" if validation.validator else validation.reason

            deltas.append(build_run_message_delta(None, snapshot_run_message_row(tool_msg)))
            deltas.append(build_tool_call_delta(None, snapshot_tool_call_row(row)))
            out.append(row)

            await self._emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:end",
                data={
                    "run_id": str(run.id),
                    "stream_key": stream_key,
                    "tool_call_id": str(row.id),
                    "message_id": str(tool_msg.id),
                    "assistant_message_id": str(assistant_message.id),
                    "index": idx,
                    "name": tool_name,
                    "arguments": arguments,
                    "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
                    "status": row.status,
                    "seq_in_thread": int(tool_msg.seq_in_thread),
                },
            )
            await self._emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:status",
                data={
                    "run_id": str(run.id),
                    "tool_call_id": str(row.id),
                    "status": row.status,
                    "reason": row.reason,
                    "result": row.result,
                    "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
                    "assistant_message_id": str(row.assistant_message_id) if row.assistant_message_id else None,
                    "child_thread_id": str(row.child_thread_id) if row.child_thread_id else None,
                },
            )

        if deltas:
            apply_project_usage_deltas(
                db,
                user_id=run.user_id,
                project_id=run.project_id,
                deltas=deltas,
                enforce_quota=True,
            )

        return out

    # ------------------------------------------------------------------
    # Execution loop
    # ------------------------------------------------------------------

    async def execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        db = self._db_factory()
        assistant_message_state = AssistantMessageExecutionState()
        try:
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is None:
                return
            thread = db.query(Thread).filter(Thread.id == run.thread_id).first()
            if thread is None:
                return

            if run.status in {"canceled", "paused"}:
                return

            await self._emit(
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
                    db, run=run, thread=thread, settings=settings, create_ctx=create_ctx,
                )
            else:
                system_prompt, conversation, scenario_bundle = await prompt_assembly.assemble_resume(
                    db, run=run, thread=thread, settings=settings,
                    input_payload=restored_payload,
                )

            # Re-check cancellation after prompt assembly committed its transaction.
            db.refresh(run)
            if run.status in {"canceled", "paused"}:
                return

            await llm_executor.run_llm(
                db,
                run=run,
                thread=thread,
                settings=settings,
                system_prompt=system_prompt,
                conversation=conversation,
                scenario_bundle=scenario_bundle,
                input_payload=create_ctx.input_payload if create_ctx is not None else restored_payload,
                assistant_message_state_out=assistant_message_state,
                emit_fn=self._emit,
                persist_tool_calls_fn=self._persist_tool_calls,
                sync_status_fn=self._sync_status_side_effects,
            )
        except asyncio.CancelledError:
            try:
                db.expire_all()
                run = db.query(RunModel).filter(RunModel.id == run_id).first()
                if run is not None:
                    thread = run.thread
                    if run.status not in {"canceled", "paused"}:
                        if thread is not None:
                            await self._apply_status_transition(
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
            # Fail any open LLM log before rollback (uses its own session)
            if assistant_message_state.llm_log_id is not None:
                try:
                    import time as _time
                    from ..llm_log_service import llm_log_service
                    _elapsed = int((_time.monotonic() - (assistant_message_state.llm_log_start or 0)) * 1000)
                    llm_log_service.fail_log(
                        assistant_message_state.llm_log_id,
                        raw_output=None,
                        error=str(exc),
                        meta={"response_time_ms": _elapsed},
                    )
                    assistant_message_state.llm_log_id = None
                except Exception:
                    logger.warning("LLM log fail_log in error handler failed", exc_info=True)
            db.rollback()
            user_error = _format_user_run_error(exc)
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is not None:
                thread = run.thread
                if thread is not None:
                    discarded_message_id = self._discard_unfinished_assistant_message(
                        db,
                        run=run,
                        assistant_message_state=assistant_message_state,
                    )
                    pre_emit_events = (
                        [(
                            "message:error",
                            {
                                "run_id": str(run.id),
                                "message_id": str(discarded_message_id),
                                "error": user_error,
                            },
                        )]
                        if discarded_message_id is not None
                        else None
                    )
                    await self._apply_status_transition(
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
