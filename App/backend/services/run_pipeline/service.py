from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from ..runtime_event_dispatcher import RuntimeEventDispatcher
from ..settings_service import settings_service
from ..tool_engine import tool_engine
from ..tool_engine.contracts import ToolOffer
from .contracts import CreateContext
from . import llm_executor
from . import prompt_assembly

logger = logging.getLogger(__name__)


def _build_tool_call_summaries(
    db: Session,
    assistant_message_id: Any,
) -> list[dict[str, Any]]:
    rows = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.assistant_message_id == assistant_message_id)
        .order_by(RunToolCallModel.call_seq)
        .all()
    )
    return [
        {
            "tool_call_id": str(row.id),
            "message_id": str(row.message_id),
            "assistant_message_id": str(row.assistant_message_id),
            "index": idx,
            "name": row.tool_name,
            "arguments": row.arguments,
            "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
            "status": row.status,
            "reason": row.reason,
            "seq_in_thread": int(row.message.seq_in_thread) if row.message else 0,
        }
        for idx, row in enumerate(rows)
    ]


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
        project_id: UUID,
        thread_id: UUID,
        event_name: str,
        data: dict[str, Any],
    ) -> None:
        await self._event_dispatcher.emit_runtime_event(
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
    ) -> RunModel:
        text = (input_text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="input_text is required for create run")

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
                )
                db.add(run)
                db.flush()

                msg = RunMessageModel(
                    thread_id=thread.id,
                    run_id=run.id,
                    seq=run.next_message_seq,
                    seq_in_thread=thread.next_message_seq,
                    role="user",
                    data={
                        resolved_language: {"contentParts": [{"type": "content", "text": text}]},
                        "_final": {"contentParts": [{"type": "content", "text": text}]},
                    },
                )
                db.add(msg)

                run.next_message_seq += 1
                thread.next_message_seq += 1
                thread.next_run_seq += 1
                thread.status = "running"
                db.commit()
                db.refresh(run)
                db.refresh(msg)
                _ = run.thread  # eager-load before session closes

                # Capture user message fields before session closes.
                user_msg_id = msg.id
                user_msg_seq = msg.seq
                user_msg_seq_in_thread = msg.seq_in_thread
                user_msg_data = msg.data
            finally:
                db.close()

        await self._emit(
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

                has_pending_tool = (
                    db.query(RunToolCallModel.id)
                    .filter(RunToolCallModel.thread_id == thread.id, RunToolCallModel.status == "pending")
                    .first()
                    is not None
                )
                if has_pending_tool:
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                run = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
                if run is None:
                    raise HTTPException(status_code=409, detail="No run exists to resume")

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

                run.status = "running"
                run.error = None
                thread.status = "running"
                db.commit()
                db.refresh(run)
                _ = run.thread  # eager-load before session closes
            finally:
                db.close()

        await self._spawn_task(run.id)
        return run

    async def cancel_run(self, *, thread_id: UUID, user_id: UUID) -> None:
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
                    RunModel.status.in_(["queued", "running", "waiting", "processing"]),
                )
                .order_by(RunModel.created_at.desc())
                .first()
            )
            if run is None:
                return  # No active run to cancel
            run_id = run.id
            project_id = run.project_id
            run.status = "canceled"
            thread_row = run.thread
            if thread_row is not None:
                thread_row.status = "canceled"
            db.commit()
        finally:
            db.close()

        # Cancel the asyncio task.
        async with self._task_lock:
            task = self._tasks.get(run_id)
            if task is not None and not task.done():
                task.cancel()

        if project_id is not None:
            await self._emit(
                project_id=project_id,
                thread_id=thread_id,
                event_name="run:canceled",
                data={"run_id": str(run_id)},
            )
            await self._emit(
                project_id=project_id,
                thread_id=thread_id,
                event_name="run:status",
                data={"run_id": str(run_id), "status": "canceled"},
            )

            # Propagate cancellation to parent if this is a sub-agent child thread
            db2 = self._db_factory()
            try:
                canceled_run = db2.query(RunModel).filter(RunModel.id == run_id).first()
                if canceled_run is not None:
                    canceled_thread = canceled_run.thread
                    if canceled_thread is not None:
                        await tool_engine.complete_parent_tool_call(
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

        for idx, tc in enumerate(tool_calls):
            llm_call_id = str(tc.id or f"tool_call_{idx}")
            tool_name = str(tc.tool_name or "")
            arguments = tc.arguments if isinstance(tc.arguments, dict) else {}

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
                    "_final": {"contentParts": [{"type": "content", "text": tool_call_text}]},
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

            validation = await tool_engine.validate_tool_call(
                db=db,
                thread=thread,
                run=run,
                tool_name=tool_name,
                args=arguments,
                offer=offer,
                user_id=run.user_id,
                project_id=run.project_id,
                language=run.language,
                preset_id=preset_id,
            )
            if validation.valid:
                row.status = "pending"
                row.reason = None
            else:
                row.status = "failed"
                row.reason = f"[{validation.validator}] {validation.reason}" if validation.validator else validation.reason

            out.append(row)

            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:end",
                data={
                    "run_id": str(run.id),
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
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:status",
                data={
                    "run_id": str(run.id),
                    "tool_call_id": str(row.id),
                    "status": row.status,
                    "reason": row.reason,
                    "result": row.result,
                },
            )

        return out

    # ------------------------------------------------------------------
    # Execution loop
    # ------------------------------------------------------------------

    async def execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        db = self._db_factory()
        assistant_message_ref: list[RunMessageModel | None] = [None]
        try:
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is None:
                return
            thread = db.query(Thread).filter(Thread.id == run.thread_id).first()
            if thread is None:
                return

            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:status",
                data={"run_id": str(run.id), "status": "running", "thread_type": thread.thread_type},
            )

            settings: UserSettings = settings_service._get_settings(db, run.user_id)  # pylint: disable=protected-access

            if create_ctx is not None:
                system_prompt, conversation, scenario_bundle = await prompt_assembly.assemble_create(
                    db, run=run, thread=thread, settings=settings, create_ctx=create_ctx,
                )
            else:
                system_prompt, conversation, scenario_bundle = await prompt_assembly.assemble_resume(
                    db, run=run, thread=thread, settings=settings,
                )

            await llm_executor.run_llm(
                db,
                run=run,
                thread=thread,
                settings=settings,
                system_prompt=system_prompt,
                conversation=conversation,
                scenario_bundle=scenario_bundle,
                input_payload=create_ctx.input_payload if create_ctx is not None else {},
                assistant_message_ref_out=assistant_message_ref,
                emit_fn=self._emit,
                persist_tool_calls_fn=self._persist_tool_calls,
            )
        except asyncio.CancelledError:
            try:
                run = db.query(RunModel).filter(RunModel.id == run_id).first()
                if run is not None:
                    thread = run.thread
                    run.status = "canceled"
                    if thread is not None:
                        thread.status = "canceled"
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
                    if thread is not None:
                        if assistant_message_ref[0] is not None:
                            await self._emit(
                                project_id=run.project_id,
                                thread_id=thread.id,
                                event_name="message:end",
                                data={
                                    "run_id": str(run.id),
                                    "message_id": str(assistant_message_ref[0].id),
                                    "seq_in_thread": int(assistant_message_ref[0].seq_in_thread),
                                    "data": assistant_message_ref[0].data or {},
                                    "tool_calls": _build_tool_call_summaries(db, assistant_message_ref[0].id),
                                },
                            )
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="run:canceled",
                            data={"run_id": str(run.id)},
                        )
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="run:status",
                            data={"run_id": str(run.id), "status": "canceled"},
                        )
            finally:
                raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Run %s failed: %s", run_id, exc, exc_info=True)
            db.rollback()
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is not None:
                thread = run.thread
                run.status = "error"
                run.error = str(exc)
                if thread is not None:
                    thread.status = "error"
                try:
                    db.commit()
                except Exception:
                    db.rollback()
                if thread is not None:
                    if assistant_message_ref[0] is not None:
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="message:end",
                            data={
                                "run_id": str(run.id),
                                "message_id": str(assistant_message_ref[0].id),
                                "seq_in_thread": int(assistant_message_ref[0].seq_in_thread),
                                "data": assistant_message_ref[0].data or {},
                                "tool_calls": _build_tool_call_summaries(db, assistant_message_ref[0].id),
                            },
                        )
                    await self._emit(
                        project_id=run.project_id,
                        thread_id=thread.id,
                        event_name="run:error",
                        data={
                            "run_id": str(run.id),
                            "error": str(exc),
                        },
                    )
                    await self._emit(
                        project_id=run.project_id,
                        thread_id=thread.id,
                        event_name="run:status",
                        data={
                            "run_id": str(run.id),
                            "status": "error",
                            "error": str(exc),
                        },
                    )
        finally:
            db.close()
