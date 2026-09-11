"""Durable continuation scheduler running alongside the existing API runtime.

DB rows are the work queue, not SSE subscribers. Leases protect long approvals;
the lifecycle atomically claims the next response before launching the model.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import or_

from ..models.db_models import RunContinuationModel, RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from .continuation_policy import STOPPED_RUN_STATUSES, UNRESOLVED_TOOL_STATUSES, auto_approval_ids, can_continue

logger = logging.getLogger(__name__)
LEASE_SECONDS = 60


class ContinuationCoordinator:
    def __init__(self, *, db_factory, pipeline, apply_tools=None):
        self.db_factory = db_factory
        self.pipeline = pipeline
        self.apply_tools = apply_tools
        self._wake = asyncio.Event()
        self._loop_task: asyncio.Task | None = None
        self._jobs: dict[UUID, asyncio.Task] = {}

    def start(self) -> None:
        if self._loop_task is None:
            self._loop_task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._loop_task is not None:
            self._loop_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._loop_task
            self._loop_task = None
        tasks = list(self._jobs.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._jobs.clear()

    def wake(self) -> None:
        self._wake.set()

    async def _loop(self) -> None:
        while True:
            self._wake.clear()
            try:
                ids = await asyncio.to_thread(self._due_ids)
                for job_id in ids:
                    if job_id in self._jobs:
                        continue
                    task = asyncio.create_task(self.process(job_id))
                    self._jobs[job_id] = task
                    task.add_done_callback(lambda _task, key=job_id: self._jobs.pop(key, None))
            except Exception:
                logger.exception("Could not poll continuation work")
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass

    def _due_ids(self) -> list[UUID]:
        now = datetime.utcnow()
        with self.db_factory() as db:
            return [row.id for row in db.query(RunContinuationModel.id).filter(
                RunContinuationModel.state != "done",
                RunContinuationModel.next_check_at <= now,
                or_(RunContinuationModel.lease_until.is_(None), RunContinuationModel.lease_until < now),
            ).order_by(RunContinuationModel.next_check_at).limit(max(0, 16 - len(self._jobs))).all()]

    def _claim(self, job_id: UUID, owner: UUID) -> bool:
        now = datetime.utcnow()
        with self.db_factory() as db:
            job = db.query(RunContinuationModel).filter(
                RunContinuationModel.id == job_id, RunContinuationModel.state != "done",
                or_(RunContinuationModel.lease_until.is_(None), RunContinuationModel.lease_until < now),
            ).with_for_update(skip_locked=True).first()
            if job is None:
                return False
            job.owner = owner
            job.lease_until = now + timedelta(seconds=LEASE_SECONDS)
            db.commit()
            return True

    async def _heartbeat(self, job_id: UUID, owner: UUID) -> None:
        while True:
            await asyncio.sleep(LEASE_SECONDS / 3)
            await asyncio.to_thread(self._renew, job_id, owner)

    def _renew(self, job_id: UUID, owner: UUID) -> None:
        with self.db_factory() as db:
            db.query(RunContinuationModel).filter(
                RunContinuationModel.id == job_id, RunContinuationModel.owner == owner,
            ).update({"lease_until": datetime.utcnow() + timedelta(seconds=LEASE_SECONDS)})
            db.commit()

    def _release(self, job_id: UUID, owner: UUID, error: str | None) -> None:
        with self.db_factory() as db:
            job = db.query(RunContinuationModel).filter(
                RunContinuationModel.id == job_id, RunContinuationModel.owner == owner,
            ).with_for_update().first()
            if job is None:
                return
            job.owner = None
            job.lease_until = None
            job.last_error = error
            job.attempts = job.attempts + 1 if error else 0
            delay = min(30, 2 ** min(job.attempts, 5)) if error else 0.5
            job.next_check_at = datetime.utcnow() + timedelta(seconds=delay)
            db.commit()

    async def process(self, job_id: UUID) -> None:
        owner = uuid4()
        if not await asyncio.to_thread(self._claim, job_id, owner):
            return
        heartbeat = asyncio.create_task(self._heartbeat(job_id, owner))
        error = None
        try:
            await self._advance(job_id, owner)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            error = str(exc)
            logger.exception("Continuation %s failed", job_id)
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
            await asyncio.to_thread(self._release, job_id, owner, error)

    async def _advance(self, job_id: UUID, owner: UUID) -> None:
        # The thread lock also serializes manual resume/cancel with auto resume.
        # It is deliberately released before long tool execution.
        with self.db_factory() as db:
            job = db.get(RunContinuationModel, job_id)
            if job is None or job.owner != owner:
                return
            thread_id = job.thread_id
        async with self.pipeline._thread_lock(thread_id):
            with self.db_factory() as db:
                thread = db.query(Thread).filter(Thread.id == thread_id).with_for_update().first()
                job = db.get(RunContinuationModel, job_id)
                if thread is None or job is None or job.owner != owner:
                    return
                run = db.query(RunModel).filter(RunModel.thread_id == thread_id).order_by(RunModel.run_seq.desc()).first()
                latest = db.query(RunMessageModel).filter(
                    RunMessageModel.thread_id == thread_id, RunMessageModel.role == "assistant",
                ).order_by(RunMessageModel.seq_in_thread.desc()).first()
                if run is None or run.id != job.run_id or run.status in STOPPED_RUN_STATUSES:
                    job.state = "done"
                    db.commit()
                    return
                if self.pipeline._runtime.has_active_task(run.id):
                    return
                if job.state == "started":
                    if run.status == "running":
                        # No local execution owns a leased, started continuation.
                        # Do not replay a potentially billed LLM/tool request.
                        await self.pipeline._apply_status_transition(
                            db, run=run, thread=thread, status="error",
                            error="Generation was interrupted by a server restart. Resume to continue.",
                            emit_error=True,
                        )
                    job.state = "done"
                    db.commit()
                    return
                if run.status == "running":
                    return
                if latest is None or latest.id != job.assistant_message_id or latest.run_id != run.id:
                    job.state = "done"
                    db.commit()
                    return
                calls = db.query(RunToolCallModel).filter(
                    RunToolCallModel.assistant_message_id == latest.id,
                ).order_by(RunToolCallModel.call_seq).all()
                if job.state == "applying" and any(call.status == "processing" for call in calls):
                    interrupted = []
                    for call in calls:
                        if call.status != "processing":
                            continue
                        call.status = "failed"
                        call.reason = "Tool execution was interrupted; its outcome is unknown. Check the result before retrying."
                        call.result = {"success": False, "outcome_unknown": True, "error": call.reason}
                        call.updated_at = datetime.utcnow()
                        interrupted.append(call)
                    job.state = "done"
                    await self.pipeline._apply_status_transition(
                        db, run=run, thread=thread, status="error",
                        error="Tool execution was interrupted. Review its result before continuing.", emit_error=True,
                    )
                    db.commit()
                    for call in interrupted:
                        await self.pipeline._runtime.emit(
                            user_id=run.user_id, project_id=run.project_id, thread_id=thread.id,
                            event_name="tool_call:status",
                            data={"run_id": str(run.id), "tool_call_id": str(call.id),
                                  "assistant_message_id": str(latest.id), "status": call.status,
                                  "reason": call.reason, "result": call.result},
                        )
                    return
                settings = db.query(UserSettings).filter(UserSettings.user_id == run.user_id).first()
                config = settings.tool_call_auto_approve if settings else {}
                approved = auto_approval_ids(calls, config or {})
                unresolved = db.query(RunToolCallModel.id).filter(
                    RunToolCallModel.thread_id == thread_id,
                    RunToolCallModel.status.in_(UNRESOLVED_TOOL_STATUSES),
                ).first() is not None
                should_resume = can_continue(status=run.status, tools=calls, unresolved=unresolved)
                user_id, assistant_id = run.user_id, latest.id
                job.state = "applying" if approved else "pending"
                if not calls or any(call.status == "rejected" for call in calls):
                    job.state = "done"
                    approved = []
                    should_resume = False
                elif not unresolved and any(call.tool_name == "submit_image_prompt" for call in calls):
                    # Terminal tools still follow the existing approval rules;
                    # only the subsequent model request is suppressed.
                    job.state = "done"
                db.commit()

        if approved:
            apply_tools = self.apply_tools
            if apply_tools is None:
                from .tool_decision_service import apply_accepted_tool_calls
                apply_tools = apply_accepted_tool_calls
            await apply_tools(user_id=user_id, thread_id=thread_id, tool_call_ids=approved,
                              automatic=True, assistant_message_id=assistant_id)
            with self.db_factory() as db:
                db.query(RunContinuationModel).filter(
                    RunContinuationModel.id == job_id, RunContinuationModel.owner == owner,
                ).update({"state": "pending"})
                db.commit()
            self.wake()
        elif should_resume:
            from .run_pipeline.contracts import ResumeRunCommand
            from fastapi import HTTPException
            try:
                resumed = await self.pipeline._lifecycle.resume_run(ResumeRunCommand(
                    thread_id=thread_id, user_id=user_id, run_mode=None, surface=None,
                    context_object_ids=[], journey_target_ids=[],
                    continuation_id=job_id, continuation_owner=owner,
                ))
                # Keep the lease while the task runs, including its terminal
                # events. Other workers may not mistake it for abandoned work.
                await self.pipeline._runtime.wait_for_task(resumed.id)
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
