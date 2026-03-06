from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models.db_models import Project, RunMessageModel, RunModel, RunToolCallModel, Thread, User
from ..models.memory_models import MessageMemorySummary
from ..providers.sse_encoder import encode_sse
from ..schemas.thread_api import (
    ChatRequest,
    ChatResponse,
    CreateThreadRequest,
    MessageResponse,
    PatchMessageRequest,
    ProjectThreadRuntimeResponse,
    ThreadMessagesResponse,
    ToolCallBatchDecisionRequest,
    ToolCallBatchDecisionResponse,
    ToolCallDecisionRequest,
    ToolCallDecisionResponse,
)
from ..services.run_event_bus import run_event_bus
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.notification_service import (
    default_journey_label,
    message_from_notification_status,
    serialize_notification,
    upsert_notification,
)
from ..services.run_pipeline import run_pipeline
from ..services.tool_engine import tool_engine
from ..services.reasoning.normalize import normalize_reasoning_detail


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
        "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
        "status": row.status,
        "reason": row.reason,
        "result": row.result if isinstance(row.result, dict) else None,
        "child_thread_id": row.child_thread_id,
        "accepted_at": row.accepted_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _normalize_content_parts(parts: Any) -> list[dict[str, str]]:
    if not isinstance(parts, list):
        raise HTTPException(status_code=422, detail="content_parts must be a list")
    out: list[dict[str, str]] = []
    for item in parts:
        if hasattr(item, "model_dump"):
            item = item.model_dump()
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="content_parts items must be objects")
        ptype = str(item.get("type") or "")
        text = item.get("text")
        if ptype != "content":
            raise HTTPException(status_code=422, detail="content_parts.type must be content")
        if not isinstance(text, str):
            raise HTTPException(status_code=422, detail="content_parts.text must be string")
        out.append({"type": ptype, "text": text})
    return out


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


def _assistant_has_content_or_reasoning(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    for entry in data.values():
        if not isinstance(entry, dict):
            continue
        parts = entry.get("contentParts")
        if _has_non_empty_part_text(parts, part_type="content"):
            return True
        reasoning_detail = entry.get("reasoningDetail")
        if isinstance(reasoning_detail, dict):
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
            }

        if decision != "accept":
            raise HTTPException(status_code=422, detail="Invalid decision")

        if tool_call.status in {"applied", "failed", "processing"}:
            return {
                "tool_call": _serialize_tool_call(tool_call),
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

    execution = await tool_engine.execute_tool_call_by_id(
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
            except Exception as exc:  # noqa: BLE001
                db3 = SessionLocal()
                try:
                    thread3 = _owned_thread_or_404(db3, thread_id=thread_id, user_id=user_id)
                    failed_row = (
                        db3.query(RunToolCallModel)
                        .with_for_update()
                        .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread3.id)
                        .first()
                    )
                    if failed_row is not None and failed_row.status == "processing":
                        failed_row.status = "failed"
                        failed_row.reason = f"Child run start failed: {exc}"
                        base_result = failed_row.result if isinstance(failed_row.result, dict) else {}
                        failed_row.result = {
                            **base_result,
                            "success": False,
                            "message": "Child run start failed",
                            "error": str(exc),
                        }
                        failed_row.updated_at = datetime.utcnow()

                        synced_run, synced_thread, _ = _sync_run_thread_status(db3, run_id=failed_row.run_id)
                        db3.commit()
                        db3.refresh(failed_row)
                        if synced_run is not None and synced_thread is not None:
                            await _emit_tool_call_status(thread=synced_thread, tool_call=failed_row)
                            await _emit_run_status(thread=synced_thread, run=synced_run)
                finally:
                    db3.close()

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
    after_event_id: int | None = Query(default=None, ge=0),
    start_from: Literal["latest", "history"] = Query(default="latest"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    async def event_gen():
        async for envelope in run_event_bus.subscribe(
            f"project:{project_id}",
            after_event_id=after_event_id,
            start_from=start_from,
        ):
            event_id: int | None = None
            event: dict[str, Any]
            if isinstance(envelope, dict) and isinstance(envelope.get("event"), dict):
                event = envelope.get("event") or {}
                raw_event_id = envelope.get("event_id")
                if isinstance(raw_event_id, int):
                    event_id = raw_event_id
            else:
                event = envelope if isinstance(envelope, dict) else {}

            name = str(event.get("event") or "message")
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            yield encode_sse(name, data, event_id=event_id)

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

    boundary_row = (
        db.query(MessageMemorySummary.to_message_id)
        .filter(
            MessageMemorySummary.user_id == current_user.id,
            MessageMemorySummary.project_id == thread.project_id,
            MessageMemorySummary.thread_id == thread.id,
        )
        .order_by(
            MessageMemorySummary.to_seq_in_thread.desc().nullslast(),
            MessageMemorySummary.created_at.desc(),
        )
        .first()
    )
    memory_boundary_message_id = boundary_row[0] if boundary_row else None

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
            "memory_boundary_message_id": memory_boundary_message_id,
        },
        latest_run={
            "id": latest_run.id,
            "status": latest_run.status,
            "run_seq": latest_run.run_seq,
            "language": latest_run.language,
            "created_at": latest_run.created_at,
            "updated_at": latest_run.updated_at,
            "input_payload": latest_run.input_payload,
            "journey_target_ids": latest_run.journey_target_ids,
        }
        if latest_run
        else None,
        messages=[_serialize_message(m) for m in messages],
        tool_calls=[_serialize_tool_call(t) for t in tool_calls],
    )


@router.patch("/threads/{thread_id}/messages/{message_id}", response_model=MessageResponse)
async def patch_thread_message(
    thread_id: UUID,
    message_id: UUID,
    payload: PatchMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.thread_id == thread.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")

    language = str(payload.language or "").strip()
    if not language:
        raise HTTPException(status_code=422, detail="language is required")

    current = row.data if isinstance(row.data, dict) else {}
    old_entry = current.get(language) if isinstance(current.get(language), dict) else {}
    entry: dict[str, Any] = {
        "contentParts": _normalize_content_parts(payload.content_parts),
    }
    if payload.reasoning_detail is not None:
        normalized_reasoning = normalize_reasoning_detail(payload.reasoning_detail)
        if normalized_reasoning is None:
            raise HTTPException(status_code=422, detail="reasoning_detail is invalid")
        entry["reasoningDetail"] = normalized_reasoning
    elif isinstance(old_entry.get("reasoningDetail"), dict):
        entry["reasoningDetail"] = old_entry["reasoningDetail"]

    updated = dict(current)
    updated[language] = entry
    row.data = updated
    db.commit()
    db.refresh(row)

    await runtime_event_dispatcher.emit_runtime_event(
        project_id=thread.project_id,
        thread_id=thread.id,
        event_name="message:update",
        data={
            "run_id": str(row.run_id),
            "message_id": str(row.id),
            "data": {language: entry},
        },
    )

    return _serialize_message(row)


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


def _tool_call_target_key(tc: RunToolCallModel | None) -> str:
    """Compute a grouping key so patches on the same object are serialized."""
    if tc is None:
        return f"unknown:{id(tc)}"
    args = tc.arguments if isinstance(tc.arguments, dict) else {}
    target_id = args.get("id", "")
    if tc.tool_name in {"patch_manuscript", "replace_manuscript"}:
        return f"manuscript:{target_id}"
    if tc.tool_name in {"patch_story_object", "replace_story_object"}:
        return f"story_object:{args.get('type', '')}:{target_id}"
    if tc.tool_name in {
        "patch_outline", "patch_outline_act", "patch_outline_chapter",
        "replace_outline", "replace_outline_act", "replace_outline_chapter",
    }:
        obj_type = args.get("type", tc.tool_name.replace("patch_", "").replace("replace_", ""))
        return f"outline:{obj_type}:{target_id}"
    # Everything else (sub-agents, reads, creates, deletes) gets a unique key → parallel.
    return f"{tc.tool_name}:{tc.id}"


def _resolve_outline_type_from_tool_name(tool_name: str, args: dict) -> str:
    if "act" in tool_name:
        return "act"
    if "chapter" in tool_name:
        return "chapter"
    return str(args.get("type") or "outline")


def _extract_outline_metadata(object_type: str, args: dict) -> dict | None:
    meta: dict[str, Any] = {}
    if object_type in {"act", "chapter"} and isinstance(args.get("order"), int):
        meta["order"] = args["order"]
    if object_type == "chapter" and isinstance(args.get("actId"), str) and args.get("actId"):
        meta["act_id"] = args["actId"]
    return meta or None


def _mark_tc_failed_by_id(db: Session, tc_id: UUID, reason: str) -> None:
    tc = db.query(RunToolCallModel).filter(RunToolCallModel.id == tc_id).first()
    if tc and tc.status == "applied":
        tc.status = "failed"
        tc.reason = reason
        tc.result = {"success": False, "message": reason, "error": reason}
        tc.updated_at = datetime.utcnow()


async def _execute_batched_patch_group(
    *,
    user_id: UUID,
    thread_id: UUID,
    decisions: list,
) -> list[tuple[UUID, dict]]:
    """Handle a group of batch-eligible tool calls on the same target object.

    Phase 1: triage — mark accepted as 'processing', rejected as 'rejected',
             commit and emit SSE so the frontend sees intermediate status.
    Phase 2: execute — apply patches, mark applied/failed, commit, emit final SSE.
    """
    from ..services.manuscript_batch import ManuscriptBatch
    from ..services.object_patch_batch import ObjectPatchBatch
    from ..services.object_service import object_service
    from ..services.sidecar_client import sidecar_client

    manuscript_batch = ManuscriptBatch()
    object_patch_batch = ObjectPatchBatch()
    results: list[tuple[UUID, dict]] = []

    db = SessionLocal()
    try:
        thread = _owned_thread_or_404(db, thread_id=thread_id, user_id=user_id)
        is_translation = getattr(thread, "journey_kind", None) == "objectTranslation"
        create_new_version = not is_translation
        run_id: UUID | None = None

        # ── Phase 1: Triage — mark processing / rejected ──
        accepted_tcs: list[tuple[object, RunToolCallModel]] = []  # (decision_item, tc)
        modified_tc_ids: list[UUID] = []  # IDs that changed status in this phase

        for item in decisions:
            tc = (
                db.query(RunToolCallModel)
                .with_for_update()
                .filter(RunToolCallModel.id == item.tool_call_id, RunToolCallModel.thread_id == thread.id)
                .first()
            )
            if tc is None:
                raise HTTPException(status_code=404, detail="Tool call not found")

            run_id = run_id or tc.run_id

            # --- Reject path ---
            if item.decision == "reject":
                if tc.status in {"rejected", "applied", "failed"}:
                    results.append((item.tool_call_id, {"tool_call": _serialize_tool_call(tc)}))
                    continue
                if tc.status == "processing":
                    raise HTTPException(status_code=409, detail="Cannot reject processing tool call")
                if tc.status not in {"pending", "validating", "streaming"}:
                    raise HTTPException(status_code=409, detail=f"Cannot reject tool call in status={tc.status}")
                tc.status = "rejected"
                tc.reason = item.reason
                tc.updated_at = datetime.utcnow()
                db.flush()
                results.append((item.tool_call_id, {"tool_call": _serialize_tool_call(tc)}))
                modified_tc_ids.append(item.tool_call_id)
                continue

            # --- Accept path: skip already-terminal ---
            if item.decision != "accept":
                raise HTTPException(status_code=422, detail="Invalid decision")
            if tc.status in {"applied", "failed", "processing"}:
                results.append((item.tool_call_id, {"tool_call": _serialize_tool_call(tc)}))
                continue
            if tc.status not in {"pending", "validating", "streaming"}:
                raise HTTPException(status_code=409, detail=f"Cannot accept tool call in status={tc.status}")

            # Mark processing (actual execution deferred to phase 2)
            tc.status = "processing"
            tc.reason = None
            tc.accepted_at = tc.accepted_at or datetime.utcnow()
            tc.updated_at = datetime.utcnow()
            db.flush()
            accepted_tcs.append((item, tc))
            modified_tc_ids.append(item.tool_call_id)

        # Commit processing/rejected statuses and emit SSE so frontend sees them
        if modified_tc_ids:
            db.commit()
            for tc_id in modified_tc_ids:
                tc = db.query(RunToolCallModel).filter(RunToolCallModel.id == tc_id).first()
                if tc:
                    db.refresh(tc)
                    await _emit_tool_call_status(thread=thread, tool_call=tc)

        # ── Phase 2: Execute accepted tool calls ──
        for item, tc in accepted_tcs:
            db.refresh(tc)
            tool_name = str(tc.tool_name)
            args = tc.arguments if isinstance(tc.arguments, dict) else {}
            run = db.query(RunModel).filter(RunModel.id == tc.run_id).first()
            language = run.language if run and isinstance(run.language, str) and run.language.strip() else "English"

            try:
                if tool_name == "patch_manuscript":
                    r = await manuscript_batch.apply_patch(
                        db=db,
                        manuscript_id=UUID(str(args.get("id"))),
                        project_id=thread.project_id,
                        language=language,
                        old_text=str(args.get("old") or ""),
                        new_text=str(args.get("new") or ""),
                        call_id=str(tc.id),
                        create_new_version=create_new_version,
                        user_request="tool:patch_manuscript",
                        sidecar=sidecar_client,
                    )
                    if not r.get("success"):
                        raise ValueError(r.get("reason", "patch failed"))
                    tc.result = {
                        "success": True, "message": "Patched manuscript",
                        "object_id": str(args.get("id")), "object_type": "manuscript",
                    }

                elif tool_name == "replace_manuscript":
                    r = await manuscript_batch.apply_replace(
                        manuscript_id=UUID(str(args.get("id"))),
                        project_id=thread.project_id,
                        language=language,
                        content=str(args.get("content") or ""),
                        call_id=str(tc.id),
                        create_new_version=create_new_version,
                        user_request="tool:replace_manuscript",
                    )
                    if not r.get("success"):
                        raise ValueError(r.get("reason", "replace failed"))
                    tc.result = {
                        "success": True, "message": "Replaced manuscript",
                        "object_id": str(args.get("id")), "object_type": "manuscript",
                    }

                elif tool_name in {
                    "patch_story_object",
                    "patch_outline", "patch_outline_act", "patch_outline_chapter",
                }:
                    obj_type = (
                        str(args.get("type") or "")
                        if tool_name == "patch_story_object"
                        else _resolve_outline_type_from_tool_name(tool_name, args)
                    )
                    obj_id = UUID(str(args.get("id")))
                    metadata = (
                        _extract_outline_metadata(obj_type, args)
                        if tool_name != "patch_story_object"
                        else None
                    )
                    r = object_patch_batch.apply_patch(
                        db=db,
                        project_id=thread.project_id,
                        object_type=obj_type,
                        object_id=obj_id,
                        language=language,
                        field=str(args.get("field") or ""),
                        old_text=str(args.get("old") or ""),
                        new_text=str(args.get("new") or ""),
                        create_new_version=create_new_version,
                        user_id=user_id,
                        metadata=metadata,
                    )
                    if not r.get("success"):
                        raise ValueError(r.get("reason", "patch failed"))
                    tc.result = {
                        "success": True, "message": f"Patched {obj_type}",
                        "object_id": str(obj_id), "object_type": obj_type,
                    }

                elif tool_name in {
                    "replace_story_object",
                    "replace_outline", "replace_outline_act", "replace_outline_chapter",
                }:
                    obj_type = (
                        str(args.get("type") or "")
                        if tool_name == "replace_story_object"
                        else _resolve_outline_type_from_tool_name(tool_name, args)
                    )
                    obj_id = UUID(str(args.get("id")))
                    fields = {k: args[k] for k in ("name", "description", "content") if k in args}
                    metadata = (
                        _extract_outline_metadata(obj_type, args)
                        if tool_name != "replace_story_object"
                        else None
                    )
                    r = object_patch_batch.apply_replace(
                        db=db,
                        project_id=thread.project_id,
                        object_type=obj_type,
                        object_id=obj_id,
                        language=language,
                        fields=fields,
                        create_new_version=create_new_version,
                        user_id=user_id,
                        metadata=metadata,
                    )
                    if not r.get("success"):
                        raise ValueError(r.get("reason", "replace failed"))
                    tc.result = {
                        "success": True, "message": f"Replaced {obj_type}",
                        "object_id": str(obj_id), "object_type": obj_type,
                    }

                else:
                    raise ValueError(f"Unsupported batch tool: {tool_name}")

                tc.status = "applied"

            except Exception as exc:  # noqa: BLE001
                tc.status = "failed"
                tc.reason = str(exc)
                tc.result = {"success": False, "message": str(exc), "error": str(exc)}

            tc.updated_at = datetime.utcnow()
            db.flush()
            results.append((item.tool_call_id, {"tool_call": _serialize_tool_call(tc)}))

        # --- Flush batches (1 sidecar roundtrip + 1 DB write per unique object) ---
        if manuscript_batch.has_pending:
            flush_results, key_to_call_ids = await manuscript_batch.flush_all(
                db=db,
                sidecar=sidecar_client,
                object_service=object_service,
                created_by=user_id,
            )
            for key, status in flush_results.items():
                if not status.success:
                    for call_id_str in key_to_call_ids.get(key, set()):
                        _mark_tc_failed_by_id(db, UUID(call_id_str), status.reason or "flush failed")

        if object_patch_batch.has_pending:
            object_patch_batch.flush_all(
                db=db,
                object_service=object_service,
                created_by=user_id,
            )

        # --- Sync run/thread status + commit ---
        if run_id is not None:
            _sync_run_thread_status(db, run_id=run_id)
        db.commit()

        # --- Emit SSE events (final statuses) ---
        for tc_id, _ in results:
            tc = db.query(RunToolCallModel).filter(RunToolCallModel.id == tc_id).first()
            if tc:
                db.refresh(tc)
                await _emit_tool_call_status(thread=thread, tool_call=tc)
        if run_id is not None:
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run:
                db.refresh(run)
                await _emit_run_status(thread=thread, run=run)

    finally:
        db.close()

    return results


@router.post("/threads/{thread_id}/tool-calls/decisions", response_model=ToolCallBatchDecisionResponse)
async def decide_tool_calls_batch(
    thread_id: UUID,
    payload: ToolCallBatchDecisionRequest,
    current_user: User = Depends(get_current_user),
):
    from collections import defaultdict

    # Step 1: Group tool calls by target object.
    db = SessionLocal()
    try:
        target_groups: dict[str, list] = defaultdict(list)
        for item in payload.decisions:
            tc = db.query(RunToolCallModel).filter(
                RunToolCallModel.id == item.tool_call_id,
            ).first()
            key = _tool_call_target_key(tc)
            target_groups[key].append(item)
    finally:
        db.close()

    # Step 2: Build tasks — batch path vs single-call path.
    async def run_batch_group(items: list) -> list[tuple[UUID, dict]]:
        return await _execute_batched_patch_group(
            user_id=current_user.id,
            thread_id=thread_id,
            decisions=items,
        )

    async def run_single_group(items: list) -> list[tuple[UUID, dict]]:
        results: list[tuple[UUID, dict]] = []
        for item in items:
            r = await _apply_tool_decision(
                user_id=current_user.id,
                thread_id=thread_id,
                tool_call_id=item.tool_call_id,
                decision=item.decision,
                reason=item.reason,
            )
            results.append((item.tool_call_id, r))
        return results

    tasks = []
    for key, items in target_groups.items():
        first_token = key.split(":")[0]
        if first_token in {"manuscript", "story_object", "outline"}:
            tasks.append(run_batch_group(items))
        else:
            tasks.append(run_single_group(items))

    all_results = await asyncio.gather(*tasks)

    # Step 3: Reorder results to match input order.
    result_map: dict[UUID, dict] = {}
    for group in all_results:
        for tc_id, r in group:
            result_map[tc_id] = r
    ordered = [result_map[item.tool_call_id] for item in payload.decisions]
    return ToolCallBatchDecisionResponse(results=[ToolCallDecisionResponse(**r) for r in ordered])


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
    thread = _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.thread_id == thread_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")
    db.delete(row)
    thread.captured_history_conversation_json = None
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
    thread = _owned_thread_or_404(db, thread_id=thread_id, user_id=current_user.id)
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
            if assistant_row is not None and not _assistant_has_content_or_reasoning(assistant_row.data):
                db.delete(assistant_row)

    thread.captured_history_conversation_json = None
    db.commit()
    return Response(status_code=204)


@router.post("/threads/{thread_id}/cancel", status_code=200)
async def cancel_thread(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
):
    await run_pipeline.cancel_run(thread_id=thread_id, user_id=current_user.id)
    return {"success": True}


@router.post("/projects/{project_id}/threads", status_code=201)
async def create_thread(
    project_id: UUID,
    payload: CreateThreadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _owned_project_or_404(db, project_id=project_id, user_id=current_user.id)

    notification_label = str(payload.notification_label or "").strip()
    notification_meta = (
        dict(payload.notification_meta)
        if isinstance(payload.notification_meta, dict)
        else {}
    )

    thread = Thread(
        project_id=project_id,
        user_id=current_user.id,
        thread_type=payload.thread_type,
        owner_id=payload.owner_id,
        journey_kind=payload.journey_kind,
        status="done",
    )
    db.add(thread)
    db.flush()

    merged_notification_meta = {
        **notification_meta,
        "thread_id": str(thread.id),
        "journey_kind": payload.journey_kind,
        "project_id": str(project_id),
    }

    notification_row = upsert_notification(
        db,
        user_id=current_user.id,
        project_id=project_id,
        source="journey",
        source_ref_id=str(thread.id),
        thread_id=thread.id,
        status="running",
        label=notification_label or default_journey_label(payload.journey_kind),
        message=message_from_notification_status(status="running"),
        warning=None,
        progress=None,
        custom_slot={"type": "none"},
        meta=merged_notification_meta,
    )

    db.commit()
    db.refresh(thread)
    db.refresh(notification_row)

    await runtime_event_dispatcher.emit_project_event(
        project_id=project_id,
        event_name="notification:upsert",
        data=serialize_notification(notification_row),
    )

    return {
        "thread_id": str(thread.id),
        "status": thread.status,
        "notification_id": str(notification_row.id),
    }
