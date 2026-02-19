from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models.db_models import Project, RunMessageModel, RunModel, RunToolCallModel, Thread, User
from ..providers.sse_encoder import encode_sse
from ..schemas.thread_api import (
    ChatRequest,
    ChatResponse,
    CreateThreadRequest,
    ProjectThreadRuntimeResponse,
    ThreadMessagesResponse,
    ToolCallBatchDecisionRequest,
    ToolCallBatchDecisionResponse,
    ToolCallDecisionRequest,
    ToolCallDecisionResponse,
)
from ..services.run_event_bus import run_event_bus
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.run_pipeline import run_pipeline
from ..services.tool_call_executor import execute as execute_tool_call


router = APIRouter(prefix="/api/v1", tags=["threads"])


def _serialize_message(row: RunMessageModel) -> dict:
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "run_id": row.run_id,
        "role": row.role,
        "seq": int(row.seq),
        "seq_in_thread": int(row.seq_in_thread),
        "data": row.data if isinstance(row.data, dict) else {},
        "created_at": row.created_at,
    }


def _serialize_tool_call(row: RunToolCallModel) -> dict:
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "run_id": row.run_id,
        "message_id": row.message_id,
        "assistant_message_id": row.assistant_message_id,
        "call_seq": int(row.call_seq),
        "llm_call_id": row.llm_call_id,
        "tool_name": row.tool_name,
        "arguments": row.arguments if isinstance(row.arguments, dict) else {},
        "status": row.status,
        "reason": row.reason,
        "result": row.result if isinstance(row.result, dict) else None,
        "child_thread_id": row.child_thread_id,
        "accepted_at": row.accepted_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _has_non_empty_part_text(parts: Any, *, part_type: str) -> bool:
    if not isinstance(parts, list):
        return False
    for part in parts:
        if not isinstance(part, dict):
            continue
        if str(part.get("type") or "") != part_type:
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            return True
    return False


def _assistant_has_content_or_thinking(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        parts = entry.get("contentParts")
        if _has_non_empty_part_text(parts, part_type="content"):
            return True
        if _has_non_empty_part_text(parts, part_type="thinking"):
            return True
        thinking_details = entry.get("thinkingDetails")
        if isinstance(thinking_details, list) and len(thinking_details) > 0:
            return True
    return False


def _owned_thread_or_404(db: Session, *, thread_id: UUID, user_id: UUID) -> Thread:
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == user_id).first()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


def _owned_project_or_404(db: Session, *, project_id: UUID, user_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _sync_run_thread_status(db: Session, *, run_id: UUID) -> tuple[RunModel | None, Thread | None, str | None]:
    run = db.query(RunModel).filter(RunModel.id == run_id).first()
    if run is None:
        return None, None, None
    thread = run.thread
    if thread is None:
        return run, None, run.status

    statuses = [
        s
        for (s,) in db.query(RunToolCallModel.status)
        .filter(RunToolCallModel.run_id == run_id)
        .all()
    ]

    if any(s == "pending" for s in statuses):
        next_status = "waiting"
    elif any(s in {"streaming", "validating", "processing"} for s in statuses):
        next_status = "processing"
    elif any(s == "rejected" for s in statuses):
        next_status = "paused"
    elif statuses:
        next_status = "done"
    else:
        next_status = run.status

    run.status = next_status
    latest_run = (
        db.query(RunModel)
        .filter(RunModel.thread_id == thread.id)
        .order_by(RunModel.run_seq.desc())
        .first()
    )
    if latest_run is not None and latest_run.id == run.id:
        thread.status = next_status
    return run, thread, next_status


async def _emit_tool_call_status(*, thread: Thread, tool_call: RunToolCallModel) -> None:
    await runtime_event_dispatcher.emit_runtime_event(
        project_id=thread.project_id,
        thread_id=thread.id,
        event_name="tool_call:status",
        data={
            "run_id": str(tool_call.run_id),
            "tool_call_id": str(tool_call.id),
            "status": tool_call.status,
            "reason": tool_call.reason,
            "result": tool_call.result if isinstance(tool_call.result, dict) else None,
            "child_thread_id": str(tool_call.child_thread_id) if tool_call.child_thread_id else None,
        },
    )


async def _emit_run_status(*, thread: Thread, run: RunModel) -> None:
    await runtime_event_dispatcher.emit_runtime_event(
        project_id=thread.project_id,
        thread_id=thread.id,
        event_name="run:status",
        data={
            "run_id": str(run.id),
            "status": run.status,
            "error": run.error,
        },
    )


async def _apply_tool_decision(
    *,
    user_id: UUID,
    thread_id: UUID,
    tool_call_id: UUID,
    decision: str,
    reason: str | None,
) -> dict:
    db = SessionLocal()
    project_id: UUID | None = None
    run_language = "English"
    try:
        thread = _owned_thread_or_404(db, thread_id=thread_id, user_id=user_id)
        project_id = thread.project_id
        tool_call = (
            db.query(RunToolCallModel)
            .with_for_update()
            .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread.id)
            .first()
        )
        if tool_call is None:
            raise HTTPException(status_code=404, detail="Tool call not found")
        run = db.query(RunModel).filter(RunModel.id == tool_call.run_id).first()
        if run is not None and isinstance(run.language, str) and run.language.strip():
            run_language = run.language

        if decision == "reject":
            if tool_call.status == "processing":
                raise HTTPException(status_code=409, detail="Cannot reject processing tool call")
            if tool_call.status in {"rejected", "applied", "failed"}:
                return {
                    "tool_call": _serialize_tool_call(tool_call),
                    "new_objects": None,
                }
            if tool_call.status not in {"pending", "validating", "streaming"}:
                raise HTTPException(status_code=409, detail=f"Cannot reject tool call in status={tool_call.status}")

            tool_call.status = "rejected"
            tool_call.reason = reason
            tool_call.updated_at = datetime.utcnow()
            synced_run, synced_thread, _ = _sync_run_thread_status(db, run_id=tool_call.run_id)
            db.commit()
            db.refresh(tool_call)

            if synced_run is not None and synced_thread is not None:
                await _emit_tool_call_status(thread=synced_thread, tool_call=tool_call)
                await _emit_run_status(thread=synced_thread, run=synced_run)

            return {
                "tool_call": _serialize_tool_call(tool_call),
                "new_objects": None,
            }

        if decision != "accept":
            raise HTTPException(status_code=422, detail="Invalid decision")

        if tool_call.status in {"applied", "failed", "processing"}:
            return {
                "tool_call": _serialize_tool_call(tool_call),
                "new_objects": None,
            }
        if tool_call.status not in {"pending", "validating", "streaming"}:
            raise HTTPException(status_code=409, detail=f"Cannot accept tool call in status={tool_call.status}")

        tool_call.status = "processing"
        tool_call.reason = None
        tool_call.accepted_at = tool_call.accepted_at or datetime.utcnow()
        tool_call.updated_at = datetime.utcnow()
        synced_run, synced_thread, _ = _sync_run_thread_status(db, run_id=tool_call.run_id)
        db.commit()
        db.refresh(tool_call)

        if synced_run is not None and synced_thread is not None:
            await _emit_tool_call_status(thread=synced_thread, tool_call=tool_call)
            await _emit_run_status(thread=synced_thread, run=synced_run)
    finally:
        db.close()

    if project_id is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    execution = await execute_tool_call(
        SessionLocal,
        tool_call_id,
        user_id=user_id,
        project_id=project_id,
        language=run_language,
    )

    db2 = SessionLocal()
    try:
        thread2 = _owned_thread_or_404(db2, thread_id=thread_id, user_id=user_id)
        executed_row = (
            db2.query(RunToolCallModel)
            .with_for_update()
            .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread2.id)
            .first()
        )
        if executed_row is None:
            raise HTTPException(status_code=404, detail="Tool call not found after execution")
        synced_run, synced_thread, _ = _sync_run_thread_status(db2, run_id=executed_row.run_id)
        db2.commit()
        db2.refresh(executed_row)

        if synced_run is not None and synced_thread is not None:
            await _emit_tool_call_status(thread=synced_thread, tool_call=executed_row)
            await _emit_run_status(thread=synced_thread, run=synced_run)

        result_payload = {
            "tool_call": _serialize_tool_call(executed_row),
            "new_objects": execution.get("new_objects"),
        }
    finally:
        db2.close()

    # Start child run for sub-agent calls
    exec_result = execution.get("result") if isinstance(execution.get("result"), dict) else None
    if isinstance(exec_result, dict) and exec_result.get("child_thread_id"):
        child_input = exec_result.get("input_text", "")
        if child_input:
            try:
                await run_pipeline.start_run(
                    thread_id=UUID(exec_result["child_thread_id"]),
                    user_id=user_id,
                    input_text=child_input,
                    input_payload=None,
                    run_mode=None,
                    surface=None,
                    context_object_ids=[],
                    journey_target_ids=[],
                    language=None,
                )
            except Exception:
                pass  # Child run failure shouldn't crash parent decision

    return result_payload


@router.post("/threads/{thread_id}/chat", response_model=ChatResponse)
async def chat_thread(
    thread_id: UUID,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    text = (payload.input_text or "").strip()

    if text:
        run = await run_pipeline.start_run(
            thread_id=thread_id,
            user_id=current_user.id,
            input_text=text,
            input_payload=payload.input_payload,
            run_mode=payload.run_mode,
            surface=payload.surface,
            context_object_ids=payload.context_object_ids,
            journey_target_ids=payload.journey_target_ids,
            language=payload.language,
        )
    else:
        last_msg = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.thread_id == thread_id)
            .order_by(RunMessageModel.seq_in_thread.desc())
            .first()
        )
        if last_msg is not None and last_msg.role == "user":
            reuse_text = last_msg.data["_final"]["contentParts"][0]["text"]
            stale_run = db.query(RunModel).filter(RunModel.id == last_msg.run_id).first()
            if stale_run:
                db.delete(stale_run)
                db.commit()
            run = await run_pipeline.start_run(
                thread_id=thread_id,
                user_id=current_user.id,
                input_text=reuse_text,
                input_payload=payload.input_payload,
                run_mode=payload.run_mode,
                surface=payload.surface,
                context_object_ids=payload.context_object_ids,
                journey_target_ids=payload.journey_target_ids,
                language=payload.language,
            )
        else:
            run = await run_pipeline.resume_run(
                thread_id=thread_id,
                user_id=current_user.id,
                run_mode=payload.run_mode,
                surface=payload.surface,
                context_object_ids=payload.context_object_ids,
                journey_target_ids=payload.journey_target_ids,
                language=payload.language,
            )

    return ChatResponse(
        thread_id=thread_id,
        run_id=run.id,
        status=run.status,
        thread_status=run.thread.status if run.thread else run.status,
    )


@router.get("/projects/{project_id}/stream")
async def stream_project_events(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    async def event_gen():
        async for event in run_event_bus.subscribe(f"project:{project_id}"):
            name = str(event.get("event") or "message")
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            yield encode_sse(name, data)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/projects/{project_id}/threads/runtime", response_model=ProjectThreadRuntimeResponse)
async def list_project_threads_runtime(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    threads = (
        db.query(Thread)
        .filter(Thread.project_id == project_id, Thread.user_id == current_user.id)
        .order_by(Thread.updated_at.desc())
        .all()
    )
    if not threads:
        return ProjectThreadRuntimeResponse(threads=[])

    thread_ids = [row.id for row in threads]

    unresolved_counts = {
        thread_id: int(count)
        for thread_id, count in (
            db.query(RunToolCallModel.thread_id, func.count(RunToolCallModel.id))
            .filter(
                RunToolCallModel.thread_id.in_(thread_ids),
                RunToolCallModel.status.in_(["streaming", "validating", "pending", "processing"]),
            )
            .group_by(RunToolCallModel.thread_id)
            .all()
        )
    }

    latest_run_seq_subq = (
        db.query(
            RunModel.thread_id.label("thread_id"),
            func.max(RunModel.run_seq).label("max_run_seq"),
        )
        .filter(RunModel.thread_id.in_(thread_ids))
        .group_by(RunModel.thread_id)
        .subquery()
    )
    latest_runs = (
        db.query(RunModel)
        .join(
            latest_run_seq_subq,
            and_(
                RunModel.thread_id == latest_run_seq_subq.c.thread_id,
                RunModel.run_seq == latest_run_seq_subq.c.max_run_seq,
            ),
        )
        .all()
    )
    latest_run_by_thread = {row.thread_id: row for row in latest_runs}

    latest_message_at_by_thread = {
        thread_id: created_at
        for thread_id, created_at in (
            db.query(RunMessageModel.thread_id, func.max(RunMessageModel.created_at))
            .filter(RunMessageModel.thread_id.in_(thread_ids))
            .group_by(RunMessageModel.thread_id)
            .all()
        )
    }

    runtime_rows = []
    for thread in threads:
        latest_run = latest_run_by_thread.get(thread.id)
        runtime_rows.append(
            {
                "id": thread.id,
                "project_id": thread.project_id,
                "thread_type": thread.thread_type,
                "owner_id": thread.owner_id,
                "journey_kind": thread.journey_kind,
                "status": thread.status,
                "last_error": latest_run.error if latest_run is not None else None,
                "updated_at": thread.updated_at,
                "latest_run_id": latest_run.id if latest_run is not None else None,
                "latest_run_status": latest_run.status if latest_run is not None else None,
                "latest_message_at": latest_message_at_by_thread.get(thread.id),
                "unresolved_tool_call_count": unresolved_counts.get(thread.id, 0),
            }
        )

    return ProjectThreadRuntimeResponse(threads=runtime_rows)


@router.get("/threads/{thread_id}/messages", response_model=ThreadMessagesResponse)
async def list_thread_messages(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)

    latest_run = (
        db.query(RunModel)
        .filter(RunModel.thread_id == thread.id)
        .order_by(RunModel.run_seq.desc())
        .first()
    )

    messages = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.thread_id == thread.id)
        .order_by(RunMessageModel.seq_in_thread.asc())
        .all()
    )

    tool_calls = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.thread_id == thread.id)
        .order_by(RunToolCallModel.created_at.asc(), RunToolCallModel.call_seq.asc())
        .all()
    )

    return ThreadMessagesResponse(
        thread={
            "id": thread.id,
            "project_id": thread.project_id,
            "thread_type": thread.thread_type,
            "owner_id": thread.owner_id,
            "journey_kind": thread.journey_kind,
            "status": thread.status,
            "created_at": thread.created_at,
            "updated_at": thread.updated_at,
        },
        latest_run={
            "id": latest_run.id,
            "status": latest_run.status,
            "run_seq": latest_run.run_seq,
            "language": latest_run.language,
            "created_at": latest_run.created_at,
            "updated_at": latest_run.updated_at,
        }
        if latest_run
        else None,
        messages=[_serialize_message(m) for m in messages],
        tool_calls=[_serialize_tool_call(t) for t in tool_calls],
    )


@router.patch("/threads/{thread_id}/tool-calls/{tool_call_id}", response_model=ToolCallDecisionResponse)
async def decide_tool_call(
    thread_id: UUID,
    tool_call_id: UUID,
    payload: ToolCallDecisionRequest,
    current_user: User = Depends(get_current_user),
):
    if payload.decision not in {"accept", "reject"}:
        raise HTTPException(status_code=422, detail="decision must be accept|reject")

    result = await _apply_tool_decision(
        user_id=current_user.id,
        thread_id=thread_id,
        tool_call_id=tool_call_id,
        decision=payload.decision,
        reason=payload.reason,
    )
    return ToolCallDecisionResponse(**result)


@router.post("/threads/{thread_id}/tool-calls/decisions", response_model=ToolCallBatchDecisionResponse)
async def decide_tool_calls_batch(
    thread_id: UUID,
    payload: ToolCallBatchDecisionRequest,
    current_user: User = Depends(get_current_user),
):
    tasks = [
        _apply_tool_decision(
            user_id=current_user.id,
            thread_id=thread_id,
            tool_call_id=item.tool_call_id,
            decision=item.decision,
            reason=item.reason,
        )
        for item in payload.decisions
    ]
    results = await asyncio.gather(*tasks)
    return ToolCallBatchDecisionResponse(results=[ToolCallDecisionResponse(**r) for r in results])


@router.delete("/threads/{thread_id}/messages/{message_id}", status_code=204)
async def delete_thread_message(
    thread_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a message. FK cascades handle cleanup:
    - assistant message: CASCADE deletes tool calls via assistant_message_id FK,
      which CASCADE deletes their tool_call messages via parent_tool_call_id FK.
    - tool_call message: SET NULL on the tool call's message_id.
    """
    _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.thread_id == thread_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.delete("/threads/{thread_id}/tool-calls/{tool_call_id}", status_code=204)
async def delete_thread_tool_call(
    thread_id: UUID,
    tool_call_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a tool call. FK CASCADE via parent_tool_call_id on run_messages
    automatically deletes the associated tool_call messages."""
    _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Tool call not found")
    assistant_message_id = row.assistant_message_id
    db.delete(row)
    db.flush()

    if assistant_message_id is not None:
        has_remaining_tool_calls = (
            db.query(RunToolCallModel.id)
            .filter(
                RunToolCallModel.thread_id == thread_id,
                RunToolCallModel.assistant_message_id == assistant_message_id,
            )
            .first()
            is not None
        )
        if not has_remaining_tool_calls:
            assistant_row = (
                db.query(RunMessageModel)
                .filter(
                    RunMessageModel.id == assistant_message_id,
                    RunMessageModel.thread_id == thread_id,
                    RunMessageModel.role == "assistant",
                )
                .first()
            )
            if assistant_row is not None and not _assistant_has_content_or_thinking(assistant_row.data):
                db.delete(assistant_row)

    db.commit()
    return Response(status_code=204)


@router.post("/threads/{thread_id}/runs/{run_id}/cancel", status_code=200)
async def cancel_run(
    thread_id: UUID,
    run_id: UUID,
    current_user: User = Depends(get_current_user),
):
    await run_pipeline.cancel_run(thread_id=thread_id, run_id=run_id, user_id=current_user.id)
    return {"success": True}


@router.post("/projects/{project_id}/threads", status_code=201)
async def create_thread(
    project_id: UUID,
    payload: CreateThreadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    thread = Thread(
        project_id=project_id,
        user_id=current_user.id,
        thread_type=payload.thread_type,
        owner_id=payload.owner_id,
        journey_kind=payload.journey_kind,
        status="done",
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)

    return {
        "thread_id": str(thread.id),
        "status": thread.status,
    }
