from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models.db_models import Project, RunMessageModel, RunModel, RunToolCallModel, Thread, User
from ..providers.sse_encoder import encode_sse
from ..schemas.thread_api import (
    ChatRequest,
    ChatResponse,
    CreateThreadRequest,
    SubAgentCompleteRequest,
    ThreadMessagesResponse,
    ToolCallBatchDecisionRequest,
    ToolCallBatchDecisionResponse,
    ToolCallDecisionRequest,
    ToolCallDecisionResponse,
)
from ..services.run_event_bus import run_event_bus
from ..services.run_pipeline import run_pipeline
from ..services.tool_call_executor import complete_sub_agent_tool_call, execute as execute_tool_call


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
        "result_message_id": row.result_message_id,
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


def _owned_thread_or_404(db: Session, *, thread_id: UUID, user_id: UUID) -> Thread:
    thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == user_id).first()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


def _sync_run_thread_status(db: Session, *, run_id: UUID) -> None:
    run = db.query(RunModel).filter(RunModel.id == run_id).first()
    if run is None:
        return
    thread = run.thread
    if thread is None:
        return

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


def _apply_tool_decision_sync(
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
            tool_call.status = "rejected"
            tool_call.reason = reason
            tool_call.updated_at = datetime.utcnow()
            _sync_run_thread_status(db, run_id=tool_call.run_id)
            db.commit()
            db.refresh(tool_call)
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
        tool_call.updated_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()

    if project_id is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Execute using dedicated session(s)
    execution = asyncio.run(
        execute_tool_call(
            SessionLocal,
            tool_call_id,
            user_id=user_id,
            project_id=project_id,
            language=run_language,
        )
    )

    db2 = SessionLocal()
    try:
        executed_row = db2.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
        if executed_row is None:
            raise HTTPException(status_code=404, detail="Tool call not found after execution")
        _sync_run_thread_status(db2, run_id=executed_row.run_id)
        db2.commit()
        db2.refresh(executed_row)
        return {
            "tool_call": _serialize_tool_call(executed_row),
            "new_objects": execution.get("new_objects"),
        }
    finally:
        db2.close()


@router.post("/threads/{thread_id}/chat", response_model=ChatResponse)
async def chat_thread(
    thread_id: UUID,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    text = (payload.input_text or "").strip()
    if text:
        run = await run_pipeline.start_run(
            thread_id=thread_id,
            user_id=current_user.id,
            input_text=text,
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


@router.get("/threads/{thread_id}/stream")
async def stream_thread_events(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)

    async def event_gen():
        async for event in run_event_bus.subscribe(thread_id):
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

    result = await asyncio.to_thread(
        _apply_tool_decision_sync,
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
        asyncio.to_thread(
            _apply_tool_decision_sync,
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


@router.post("/threads/{thread_id}/tool-calls/{tool_call_id}/complete", response_model=ToolCallDecisionResponse)
async def complete_sub_agent_call(
    thread_id: UUID,
    tool_call_id: UUID,
    payload: SubAgentCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Tool call not found")

    if not row.tool_name.startswith("call_"):
        raise HTTPException(status_code=409, detail="Tool call is not a sub-agent call")

    await complete_sub_agent_tool_call(db, tool_call=row, result_text=payload.result)
    _sync_run_thread_status(db, run_id=row.run_id)
    db.commit()
    db.refresh(row)

    return ToolCallDecisionResponse(tool_call=_serialize_tool_call(row), new_objects=None)


@router.delete("/threads/{thread_id}/messages/{message_id}", status_code=204)
async def delete_thread_message(
    thread_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
    _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Tool call not found")
    # Cascade-delete the associated tool_call and tool_result messages.
    if row.message_id:
        msg = db.query(RunMessageModel).filter(RunMessageModel.id == row.message_id).first()
        if msg:
            db.delete(msg)
    if row.result_message_id:
        result_msg = db.query(RunMessageModel).filter(RunMessageModel.id == row.result_message_id).first()
        if result_msg:
            db.delete(result_msg)
    db.delete(row)
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
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

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
