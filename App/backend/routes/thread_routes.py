"""Thread-based API routes replacing the old run-centric endpoints."""

from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import get_current_user
from ..database import get_db, short_session
from ..models.db_models import Agent, Project, RunMessageModel, RunModel, RunToolCallModel, Thread, User
from ..providers.sse_encoder import encode_sse
from ..schemas.thread_api import (
    DispatchRequest,
    MessageResponse,
    PatchMessageRequest,
    ThreadStateResponse,
    ToolCallResponse,
    ToolDecisionsRequest,
)
from ..services.run_event_bus import run_event_bus
from ..services.run_event_emitter import run_event_emitter
from ..services.run_pipeline import run_pipeline

router = APIRouter(prefix="/api/v1/projects/{project_id}/threads", tags=["threads"])


# ── Helpers ──

def _ensure_project(db: Session, *, user_id: UUID, project_id: UUID) -> None:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")


def _get_thread(db: Session, *, thread_id: UUID, user_id: UUID, project_id: UUID, for_update: bool = False) -> Thread:
    q = db.query(Thread).filter(
        Thread.id == thread_id,
        Thread.user_id == user_id,
        Thread.project_id == project_id,
    )
    if for_update:
        q = q.with_for_update()
    thread = q.first()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


def _serialize_event(event: dict) -> tuple[str, dict]:
    event_name = str(event.get("event") or "message")
    payload = {k: v for k, v in event.items() if k != "event"}
    return event_name, payload


async def _stream_thread_events(
    thread_id: UUID,
    *,
    trigger: asyncio.Task | None = None,
    after_seq: int | None = None,
):
    """Stream SSE events for a thread. Breaks on terminal events."""
    subscription = run_event_bus.subscribe(thread_id, after_seq=after_seq)
    event_iter = subscription.__aiter__()

    try:
        while True:
            try:
                event = await asyncio.wait_for(event_iter.__anext__(), timeout=15.0)
            except asyncio.TimeoutError:
                if trigger is not None and trigger.done():
                    with contextlib.suppress(Exception):
                        await trigger
                    break
                with short_session() as db:
                    run = (
                        db.query(RunModel)
                        .filter(
                            RunModel.thread_id == thread_id,
                            RunModel.status.in_(["running", "waiting", "paused", "error"]),
                        )
                        .order_by(RunModel.run_seq.desc().nullslast())
                        .first()
                    )
                    if run is not None:
                        await run_event_emitter.emit_heartbeat(run)
                continue

            event_name, payload = _serialize_event(event)
            yield encode_sse(event_name, payload)

            if event_name in {"thread:complete", "thread:error"}:
                break
            if event_name == "thread:status":
                body = payload.get("payload") if isinstance(payload, dict) else None
                status = body.get("status") if isinstance(body, dict) else None
                if status in {"waiting", "paused", "cancelled"}:
                    break
    finally:
        if trigger is not None:
            with contextlib.suppress(Exception):
                await trigger
        if hasattr(subscription, "aclose"):
            with contextlib.suppress(Exception):
                await subscription.aclose()


# ── Dispatch ──

@router.post("/dispatch")
async def dispatch(
    project_id: UUID,
    req: DispatchRequest,
    after_seq: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Single entry point: create or reuse a thread, then start a new run."""
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    if not req.input_text.strip():
        raise HTTPException(status_code=400, detail="input_text must be non-empty for dispatch")

    # Resolve or create thread
    if req.thread_id is not None:
        thread = _get_thread(db, thread_id=req.thread_id, user_id=current_user.id, project_id=project_id)
    else:
        # For agent threads, look up existing thread for the owner
        owner_id: UUID | None = None
        if req.thread_type == "agent":
            # agent_id is passed via input_payload or context
            # For agent dispatch, the frontend should supply thread_id directly
            # since each agent auto-creates a thread. But as a fallback:
            raise HTTPException(status_code=400, detail="thread_id is required for agent dispatch")

        # Create new thread for journey/subAgent
        thread = Thread(
            project_id=project_id,
            user_id=current_user.id,
            thread_type=req.thread_type,
            owner_id=owner_id,
            journey_kind=req.journey_kind,
            status="idle",
        )
        db.add(thread)
        db.flush()

    thread_id = thread.id
    db.expunge(thread)

    # Dispatch via pipeline
    await run_pipeline.dispatch(
        user_id=current_user.id,
        project_id=project_id,
        thread=thread,
        input_text=req.input_text,
        language=req.language,
        run_mode=req.run_mode,
        surface=req.surface,
        context_object_ids=req.context_object_ids,
        input_payload=req.input_payload,
        journey_target_ids=req.journey_target_ids,
        client_message_id=req.client_message_id,
    )

    async def gen():
        async for chunk in _stream_thread_events(thread_id, after_seq=after_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Thread-Id": str(thread_id),
        },
    )


# ── Tool Decisions ──

@router.post("/{thread_id}/tool-decisions")
async def tool_decisions(
    project_id: UUID,
    thread_id: UUID,
    req: ToolDecisionsRequest,
    after_seq: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)

    async def trigger_apply() -> None:
        await run_pipeline.apply_decisions(
            user_id=current_user.id,
            thread_id=thread_id,
            message_id=req.message_id,
            decisions=req.decisions,
            options=req.options,
        )

    task = asyncio.create_task(trigger_apply())

    async def gen():
        async for chunk in _stream_thread_events(thread_id, trigger=task, after_seq=after_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ── Resume ──

SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


@router.post("/{thread_id}/resume")
async def resume(
    project_id: UUID,
    thread_id: UUID,
    after_seq: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)

    # Find latest run regardless of status
    run = (
        db.query(RunModel)
        .filter(RunModel.thread_id == thread_id)
        .order_by(RunModel.run_seq.desc().nullslast())
        .first()
    )
    if run is None:
        raise HTTPException(status_code=404, detail="No run found for this thread")

    # Already running → send warning SSE and close
    if run.status == "running":
        async def warn_gen():
            yield encode_sse("thread:warning", {
                "thread_id": str(thread_id),
                "message": "Run is already in progress",
            })
        return StreamingResponse(warn_gen(), media_type="text/event-stream", headers=SSE_HEADERS)

    async def trigger_resume() -> None:
        await run_pipeline.resume(user_id=current_user.id, thread_id=thread_id)

    task = asyncio.create_task(trigger_resume())

    async def gen():
        async for chunk in _stream_thread_events(thread_id, trigger=task, after_seq=after_seq):
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)


# ── Pause / Cancel ──

@router.post("/{thread_id}/pause")
async def pause(
    project_id: UUID,
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)
    await run_pipeline.pause(user_id=current_user.id, thread_id=thread_id)
    return {"ok": True}


@router.post("/{thread_id}/cancel")
async def cancel(
    project_id: UUID,
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)
    await run_pipeline.cancel(user_id=current_user.id, thread_id=thread_id)
    return {"ok": True}


# ── State Recovery ──

@router.get("/{thread_id}/state", response_model=ThreadStateResponse)
async def get_state(
    project_id: UUID,
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Recovery endpoint — returns DB-committed state for a thread."""
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    thread = _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)

    # Load all messages for the thread
    messages = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.thread_id == thread_id)
        .order_by(
            RunMessageModel.seq_in_thread.asc().nullslast(),
            RunMessageModel.created_at.asc(),
            RunMessageModel.seq.asc(),
        )
        .all()
    )

    # Load all tool calls for the thread
    tool_calls = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.thread_id == thread_id)
        .order_by(RunToolCallModel.call_seq.asc(), RunToolCallModel.created_at.asc())
        .all()
    )

    last_error_row = (
        db.query(RunModel.error)
        .filter(
            RunModel.thread_id == thread_id,
            RunModel.status == "error",
        )
        .order_by(RunModel.run_seq.desc().nullslast(), RunModel.updated_at.desc())
        .first()
    )
    last_error = str(last_error_row[0]) if last_error_row and last_error_row[0] else None
    last_event_seq = await run_event_bus.latest_seq(thread_id)

    return ThreadStateResponse(
        thread=thread,
        messages=[MessageResponse.model_validate(m) for m in messages],
        tool_calls=[ToolCallResponse.model_validate(tc) for tc in tool_calls],
        last_error=last_error,
        last_event_seq=last_event_seq,
    )


# ── Message management ──

@router.delete("/{thread_id}/messages/{message_id}")
async def delete_message(
    project_id: UUID,
    thread_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)

    message = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.thread_id == thread_id)
        .first()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    db.delete(message)
    db.commit()
    return {"ok": True}


@router.patch("/{thread_id}/messages/{message_id}")
async def patch_message(
    project_id: UUID,
    thread_id: UUID,
    message_id: UUID,
    req: PatchMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project(db, user_id=current_user.id, project_id=project_id)
    _get_thread(db, thread_id=thread_id, user_id=current_user.id, project_id=project_id)

    message = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.thread_id == thread_id)
        .first()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    data = dict(message.data or {})
    lang_entry = dict(data.get(req.language) or {})
    if req.content_parts is not None:
        lang_entry["contentParts"] = list(req.content_parts)
    if req.thinking_details is not None:
        lang_entry["thinkingDetails"] = list(req.thinking_details)
    data[req.language] = lang_entry
    message.data = data
    flag_modified(message, "data")
    db.commit()
    db.refresh(message)

    return {
        "message": {
            "id": str(message.id),
            "thread_id": str(message.thread_id),
            "seq": int(message.seq),
            "role": message.role,
            "data": message.data if isinstance(message.data, dict) else {},
            "created_at": message.created_at.isoformat() if message.created_at else datetime.now(timezone.utc).isoformat(),
        }
    }
