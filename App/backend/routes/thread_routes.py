from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models.db_models import Project, RunMessageAttachmentModel, RunMessageModel, RunModel, RunToolCallModel, Thread, User
from ..models.memory_models import MessageMemorySummary
from ..providers.shared.transport.sse_encoder import encode_sse, iter_sse_with_heartbeat
from ..schemas.thread_api import (
    MessageResponse,
    PatchMessageRequest,
    ProjectThreadRuntimeResponse,
    ResumeRunRequest,
    StartRunRequest,
    ThreadMessagesResponse,
    ThreadRunResponse,
    ToolCallBatchDecisionRequest,
    ToolCallBatchDecisionResponse,
    ToolCallDecisionRequest,
    ToolCallDecisionResponse,
)
from ..services.chat_attachment_service import (
    ChatAttachmentValidationError,
    IncomingMessageAttachment,
    chat_attachment_service,
)
from ..services.deletion_service import delete_chat_attachments_with_files
from ..services.run_event_bus import run_event_bus
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.notification_service import collect_thread_delete_deltas, delete_threads
from ..services.run_pipeline import run_pipeline
from ..services.tool_engine import tool_engine
from ..services.reasoning.normalize import normalize_reasoning_detail
from ..services.thread_parent_runtime_service import resolve_parent, thread_runtime_fields
from ..services.thread_runtime_sync_service import (
    RuntimeSyncResult,
    emit_runtime_sync_events,
    refresh_runtime_sync_result,
    sync_explicit_run_thread_status,
    sync_run_thread_status,
)
from ..services.ownership import require_owned_project, require_owned_thread
from ..services.image_run_service import image_run_service
from ..services.storage_usage_service import (
    StorageQuotaExceededError,
    apply_project_usage_deltas,
    build_run_message_delta,
    build_run_message_attachment_delta,
    build_thread_delta,
    build_tool_call_delta,
    snapshot_run_message_attachment_row,
    snapshot_run_message_row,
    snapshot_thread_row,
    snapshot_tool_call_row,
    snapshot_rows,
)


router = APIRouter(prefix="/api/v1", tags=["threads"])
USER_STREAM_HEARTBEAT_INTERVAL_SECONDS = 15.0
_DELETE_UNRESOLVED_TOOL_STATUSES = {"streaming", "validating", "pending", "processing", "working"}
_DELETE_PAUSE_SOURCE_STATUSES = {"waiting", "processing"}
# Run states with a live stream/task that must be canceled before deleting its message.
_DELETE_CANCEL_RUN_STATUSES = {"running", "processing"}


@dataclass
class ParsedStartRunInput:
    request: StartRunRequest
    attachments: list[IncomingMessageAttachment]


def _serialize_attachment(row: RunMessageAttachmentModel) -> dict:
    return dict(chat_attachment_service.serialize_attachment(row))


def _serialize_message(
    row: RunMessageModel,
    attachments_by_message_id: dict[UUID, list[RunMessageAttachmentModel]] | None = None,
) -> dict:
    attachments = attachments_by_message_id.get(row.id, []) if attachments_by_message_id is not None else list(getattr(row, "attachments", []) or [])
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "run_id": row.run_id,
        "role": row.role,
        "seq": int(row.seq),
        "seq_in_thread": int(row.seq_in_thread),
        "data": row.data if isinstance(row.data, dict) else {},
        "attachments": [_serialize_attachment(item) for item in attachments],
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
        "image_run_id": row.image_run_id,
        "child_thread_id": row.child_thread_id,
        "accepted_at": row.accepted_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _attachments_by_message_id(rows: list[RunMessageAttachmentModel]) -> dict[UUID, list[RunMessageAttachmentModel]]:
    grouped: dict[UUID, list[RunMessageAttachmentModel]] = {}
    for row in rows:
        grouped.setdefault(row.message_id, []).append(row)
    for value in grouped.values():
        value.sort(key=lambda item: (item.sort_order, item.created_at))
    return grouped


def _parse_json_field(raw_value: Any, *, default: Any) -> Any:
    if raw_value in (None, "", b""):
        return default
    if isinstance(raw_value, (dict, list)):
        return raw_value
    if isinstance(raw_value, bytes):
        raw_value = raw_value.decode("utf-8")
    if not isinstance(raw_value, str):
        return default
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON form field") from exc


def _validation_error_to_http_exception(exc: ValidationError) -> HTTPException:
    detail: list[dict[str, Any]] = []
    for item in exc.errors(include_url=False):
        loc = item.get("loc")
        if isinstance(loc, tuple):
            loc = ["body", *loc]
        elif isinstance(loc, list):
            loc = ["body", *loc]
        elif loc is None:
            loc = ["body"]
        else:
            loc = ["body", loc]
        detail.append({**item, "loc": loc})
    return HTTPException(status_code=422, detail=detail)


def _validate_start_run_request(payload: Any) -> StartRunRequest:
    try:
        return StartRunRequest.model_validate(payload)
    except ValidationError as exc:
        raise _validation_error_to_http_exception(exc) from exc


async def _parse_start_run_input(request: Request) -> ParsedStartRunInput:
    content_type = str(request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in content_type:
        payload = _validate_start_run_request(await request.json())
        return ParsedStartRunInput(request=payload, attachments=[])

    form = await request.form()
    input_payload = _parse_json_field(
        form.get("input_payload_json", form.get("input_payload")),
        default=None,
    )
    context_object_ids = _parse_json_field(form.get("context_object_ids_json"), default=[])
    journey_target_ids = _parse_json_field(form.get("journey_target_ids_json"), default=[])
    mcp_selections = _parse_json_field(form.get("mcp_selections_json"), default=[])
    payload = _validate_start_run_request(
        {
            "input_text": str(form.get("input_text") or ""),
            "input_payload": input_payload,
            "run_mode": str(form.get("run_mode") or "").strip() or None,
            "surface": str(form.get("surface") or "").strip() or None,
            "context_object_ids": context_object_ids if isinstance(context_object_ids, list) else [],
            "journey_target_ids": journey_target_ids if isinstance(journey_target_ids, list) else [],
            "mcp_selections": mcp_selections if isinstance(mcp_selections, list) else [],
        }
    )

    attachments: list[IncomingMessageAttachment] = []
    for item in form.getlist("attachments"):
        filename = getattr(item, "filename", None)
        content_type_value = getattr(item, "content_type", None)
        if filename is None or content_type_value is None or not hasattr(item, "read"):
            continue
        content = await item.read()
        attachments.append(
            IncomingMessageAttachment(
                filename=str(filename or "attachment"),
                mime_type=str(content_type_value or "").strip().lower(),
                content=content,
            )
        )

    return ParsedStartRunInput(request=payload, attachments=attachments)


def _serialize_thread_run_response(*, thread_id: UUID, run: RunModel) -> ThreadRunResponse:
    return ThreadRunResponse(
        thread_id=thread_id,
        run_id=run.id,
        status=run.status,
        thread_status=run.thread.status if run.thread else run.status,
    )


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


def _snapshot_assistant_tool_call_tree(
    db: Session,
    *,
    assistant_message_id: UUID,
) -> tuple[list[object], list[object]]:
    tool_calls = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.assistant_message_id == assistant_message_id)
        .all()
    )
    tool_call_ids = [row.id for row in tool_calls if isinstance(row.id, UUID)]
    tool_messages = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.parent_tool_call_id.in_(tool_call_ids))
        .all()
        if tool_call_ids
        else []
    )
    return (
        snapshot_rows(tool_calls, snapshot_tool_call_row),
        snapshot_rows(tool_messages, snapshot_run_message_row),
    )


def _count_unresolved_run_tool_calls(db: Session, *, run_id: UUID) -> int:
    statuses = [
        s
        for (s,) in db.query(RunToolCallModel.status)
        .filter(RunToolCallModel.run_id == run_id)
        .all()
    ]
    return sum(1 for status in statuses if status in _DELETE_UNRESOLVED_TOOL_STATUSES)


def _pause_run_after_delete_if_needed(
    db: Session,
    *,
    run_id: UUID,
    previous_thread_status: str | None,
    previous_unresolved_count: int,
) -> tuple[RunModel | None, Thread | None, bool]:
    if previous_unresolved_count <= 0 or previous_thread_status not in _DELETE_PAUSE_SOURCE_STATUSES:
        return None, None, False

    run = db.query(RunModel).filter(RunModel.id == run_id).first()
    if run is None:
        return None, None, False

    thread = run.thread
    if thread is None:
        return run, None, False

    current_unresolved_count = _count_unresolved_run_tool_calls(db, run_id=run_id)
    if current_unresolved_count != 0:
        return run, thread, False

    run.status = "paused"
    latest_run = (
        db.query(RunModel)
        .filter(RunModel.thread_id == thread.id)
        .order_by(RunModel.run_seq.desc())
        .first()
    )
    if latest_run is not None and latest_run.id == run.id:
        thread.status = "paused"

    return run, thread, True


async def _emit_tool_call_status(*, thread: Thread, tool_call: RunToolCallModel) -> None:
    await runtime_event_dispatcher.emit_runtime_event(
        user_id=thread.user_id,
        project_id=thread.project_id,
        thread_id=thread.id,
        event_name="tool_call:status",
        data={
            "run_id": str(tool_call.run_id),
            "tool_call_id": str(tool_call.id),
            "status": tool_call.status,
            "reason": tool_call.reason,
            "result": tool_call.result if isinstance(tool_call.result, dict) else None,
            "extra_content": tool_call.extra_content if isinstance(tool_call.extra_content, dict) else None,
            "image_run_id": str(tool_call.image_run_id) if tool_call.image_run_id else None,
            "assistant_message_id": str(tool_call.assistant_message_id) if tool_call.assistant_message_id else None,
            "child_thread_id": str(tool_call.child_thread_id) if tool_call.child_thread_id else None,
        },
    )


async def _emit_thread_snapshot_invalidated(
    *,
    user_id: UUID | str,
    project_id: UUID | str,
    thread_id: UUID | str,
    run_id: UUID | str | None,
) -> None:
    await runtime_event_dispatcher.emit_runtime_event(
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        event_name="thread:snapshot_invalidated",
        data={
            "run_id": str(run_id) if run_id else None,
        },
    )


def _apply_tool_decision_sync(
    *,
    user_id: UUID,
    thread_id: UUID,
    tool_call_id: UUID,
    decision: str,
    reason: str | None,
) -> tuple[dict | None, RuntimeSyncResult | None, Thread | None, object | None]:
    """Run the synchronous DB portion of tool decision in a thread.

    Returns (result_dict, sync_result, thread, tool_call).
    If result_dict is not None, the caller can return it directly.
    If result_dict is None, the caller should proceed to the async accept flow.
    """
    db = SessionLocal()
    try:
        thread = require_owned_thread(db, thread_id=thread_id, user_id=user_id)
        tool_call = (
            db.query(RunToolCallModel)
            .with_for_update()
            .filter(RunToolCallModel.id == tool_call_id, RunToolCallModel.thread_id == thread.id)
            .first()
        )
        if tool_call is None:
            raise HTTPException(status_code=404, detail="Tool call not found")

        if decision == "reject":
            if tool_call.status in {"processing", "working"}:
                raise HTTPException(status_code=409, detail="Cannot reject in-progress tool call")
            if tool_call.status in {"rejected", "applied", "failed"}:
                return {"tool_call": _serialize_tool_call(tool_call)}, None, None, None
            if tool_call.status not in {"pending", "validating", "streaming"}:
                raise HTTPException(status_code=409, detail=f"Cannot reject tool call in status={tool_call.status}")

            tool_call.status = "rejected"
            tool_call.reason = reason
            tool_call.updated_at = datetime.utcnow()
            sync_result = sync_run_thread_status(db, run_id=tool_call.run_id)
            db.commit()
            refresh_runtime_sync_result(db, result=sync_result)
            db.refresh(tool_call)

            return (
                {"tool_call": _serialize_tool_call(tool_call)},
                sync_result,
                sync_result.thread,
                tool_call,
            )

        if decision != "accept":
            raise HTTPException(status_code=422, detail="Invalid decision")

        if tool_call.status in {"applied", "failed", "processing", "working", "rejected"}:
            return {"tool_call": _serialize_tool_call(tool_call)}, None, None, None
        if tool_call.status not in {"pending", "validating", "streaming"}:
            raise HTTPException(status_code=409, detail=f"Cannot accept tool call in status={tool_call.status}")

        return None, None, None, None
    finally:
        db.close()


async def _apply_tool_decision(
    *,
    user_id: UUID,
    thread_id: UUID,
    tool_call_id: UUID,
    decision: str,
    reason: str | None,
) -> dict:
    result_dict, sync_result, thread, tool_call = await asyncio.to_thread(
        _apply_tool_decision_sync,
        user_id=user_id,
        thread_id=thread_id,
        tool_call_id=tool_call_id,
        decision=decision,
        reason=reason,
    )

    if result_dict is not None:
        if sync_result is not None and thread is not None and tool_call is not None:
            await _emit_tool_call_status(thread=thread, tool_call=tool_call)
            await emit_runtime_sync_events(runtime_event_dispatcher, result=sync_result)
        return result_dict

    applied_results = await tool_engine.apply_tool_call_ids(
        SessionLocal,
        user_id=user_id,
        thread_id=thread_id,
        tool_call_ids=[tool_call_id],
    )
    await _start_applied_tool_call_followups(
        user_id=user_id,
        thread_id=thread_id,
        applied_results=applied_results,
    )
    result_map = await _finalize_applied_tool_calls(
        user_id=user_id,
        thread_id=thread_id,
        tool_call_ids=[tool_call_id],
    )
    return result_map.get(tool_call_id, {"tool_call": None})

def _finalize_applied_tool_calls_sync(
    *,
    user_id: UUID,
    thread_id: UUID,
    tool_call_ids: list[UUID],
) -> tuple[Thread, list[object], list[RuntimeSyncResult], dict[UUID, dict]]:
    """Sync DB portion: lock rows, sync statuses, commit, return data for async emission."""
    db = SessionLocal()
    try:
        thread = require_owned_thread(db, thread_id=thread_id, user_id=user_id)
        rows = (
            db.query(RunToolCallModel)
            .with_for_update()
            .filter(
                RunToolCallModel.thread_id == thread.id,
                RunToolCallModel.id.in_(tool_call_ids),
            )
            .order_by(RunToolCallModel.call_seq.asc())
            .all()
        )
        sync_results: list[RuntimeSyncResult] = []
        seen_run_ids: set[UUID] = set()
        for row in rows:
            if row.run_id in seen_run_ids:
                continue
            seen_run_ids.add(row.run_id)
            sync_results.append(sync_run_thread_status(db, run_id=row.run_id))
        db.commit()
        db.refresh(thread)
        for sync_result in sync_results:
            refresh_runtime_sync_result(db, result=sync_result)
        for row in rows:
            db.refresh(row)
        result_map = {row.id: {"tool_call": _serialize_tool_call(row)} for row in rows}
        return thread, rows, sync_results, result_map
    finally:
        db.close()


async def _finalize_applied_tool_calls(
    *,
    user_id: UUID,
    thread_id: UUID,
    tool_call_ids: list[UUID],
) -> dict[UUID, dict]:
    thread, rows, sync_results, result_map = await asyncio.to_thread(
        _finalize_applied_tool_calls_sync,
        user_id=user_id,
        thread_id=thread_id,
        tool_call_ids=tool_call_ids,
    )
    for row in rows:
        await _emit_tool_call_status(thread=thread, tool_call=row)
    for sync_result in sync_results:
        await emit_runtime_sync_events(runtime_event_dispatcher, result=sync_result)
    return result_map


async def _start_applied_tool_call_followups(
    *,
    user_id: UUID,
    thread_id: UUID,
    applied_results: list[object],
) -> None:
    for applied in applied_results:
        tool_call_id = getattr(applied, "tool_call_id", None)
        image_run_id = getattr(applied, "image_run_id", None)
        child_thread_id = getattr(applied, "child_thread_id", None)
        child_input_text = getattr(applied, "child_input_text", None)

        if isinstance(image_run_id, UUID):
            try:
                await image_run_service.start_run(image_run_id)
            except Exception as exc:  # noqa: BLE001
                try:
                    await image_run_service.fail_run(
                        image_run_id=image_run_id,
                        failure_code="startup_failed",
                        error_message=f"Image run start failed: {exc}",
                    )
                except Exception:
                    pass

        if not (isinstance(child_thread_id, UUID) and isinstance(child_input_text, str) and child_input_text.strip()):
            continue

        try:
            await run_pipeline.start_run(
                thread_id=child_thread_id,
                user_id=user_id,
                input_text=child_input_text,
                input_payload=None,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_target_ids=[],
            )
        except Exception as exc:  # noqa: BLE001
            if not isinstance(tool_call_id, UUID):
                continue

            def _mark_child_run_failed(
                exc: Exception = exc,
                tc_id: UUID = tool_call_id,
            ) -> tuple[RuntimeSyncResult | None, Thread | None, object | None]:
                db = SessionLocal()
                try:
                    thread = require_owned_thread(db, thread_id=thread_id, user_id=user_id)
                    failed_row = (
                        db.query(RunToolCallModel)
                        .with_for_update()
                        .filter(RunToolCallModel.id == tc_id, RunToolCallModel.thread_id == thread.id)
                        .first()
                    )
                    if failed_row is not None and failed_row.status in {"processing", "working"}:
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
                        sr = sync_run_thread_status(db, run_id=failed_row.run_id)
                        db.commit()
                        refresh_runtime_sync_result(db, result=sr)
                        db.refresh(failed_row)
                        return sr, sr.thread, failed_row
                    return None, None, None
                finally:
                    db.close()

            sr, sr_thread, failed_tc = await asyncio.to_thread(_mark_child_run_failed)
            if sr is not None and sr_thread is not None and failed_tc is not None:
                await _emit_tool_call_status(thread=sr_thread, tool_call=failed_tc)
                await emit_runtime_sync_events(runtime_event_dispatcher, result=sr)


@router.post("/threads/{thread_id}/start", response_model=ThreadRunResponse)
async def start_thread_run(
    thread_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    del db
    parsed = await _parse_start_run_input(request)
    payload = parsed.request
    text = (payload.input_text or "").strip()

    run = await run_pipeline.start_run(
        thread_id=thread_id,
        user_id=current_user.id,
        input_text=text,
        input_payload=payload.input_payload,
        run_mode=payload.run_mode,
        surface=payload.surface,
        context_object_ids=payload.context_object_ids,
        journey_target_ids=payload.journey_target_ids,
        attachments=parsed.attachments,
        mcp_selections=payload.mcp_selections,
    )
    return _serialize_thread_run_response(thread_id=thread_id, run=run)


@router.post("/threads/{thread_id}/resume", response_model=ThreadRunResponse)
async def resume_thread_run(
    thread_id: UUID,
    payload: ResumeRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    del db
    run = await run_pipeline.resume_run(
        thread_id=thread_id,
        user_id=current_user.id,
        run_mode=payload.run_mode,
        surface=payload.surface,
        context_object_ids=payload.context_object_ids,
        journey_target_ids=payload.journey_target_ids,
    )
    return _serialize_thread_run_response(thread_id=thread_id, run=run)


@router.get("/stream")
async def stream_user_events(
    after_event_id: int | None = Query(default=None, ge=0),
    start_from: Literal["latest", "history"] = Query(default="latest"),
    current_user: User = Depends(get_current_user),
):
    async def event_gen():
        async for chunk in iter_sse_with_heartbeat(
            run_event_bus.subscribe(
                f"user:{current_user.id}",
                after_event_id=after_event_id,
                start_from=start_from,
            ),
            heartbeat_interval=USER_STREAM_HEARTBEAT_INTERVAL_SECONDS,
        ):
            yield chunk

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
def list_project_threads_runtime(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_owned_project(db, project_id=project_id, user_id=current_user.id)

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
                RunToolCallModel.status.in_(["streaming", "validating", "pending", "processing", "working"]),
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
        runtime_fields = thread_runtime_fields(db, thread)
        runtime_rows.append(
            {
                "id": thread.id,
                "project_id": thread.project_id,
                "thread_type": thread.thread_type,
                "parent_id": runtime_fields["parent_id"],
                "journey_kind": runtime_fields["journey_kind"],
                "display_label": runtime_fields["display_label"],
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
def list_thread_messages(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = require_owned_thread(db, thread_id=thread_id, user_id=current_user.id)

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
    message_ids = [row.id for row in messages]
    attachments = (
        db.query(RunMessageAttachmentModel)
        .filter(RunMessageAttachmentModel.message_id.in_(message_ids))
        .order_by(RunMessageAttachmentModel.message_id.asc(), RunMessageAttachmentModel.sort_order.asc())
        .all()
        if message_ids
        else []
    )
    attachments_by_message_id = _attachments_by_message_id(attachments)

    tool_calls = (
        db.query(RunToolCallModel)
        .filter(RunToolCallModel.thread_id == thread.id)
        .order_by(RunToolCallModel.created_at.asc(), RunToolCallModel.call_seq.asc())
        .all()
    )
    image_runs = image_run_service.list_thread_runs(db, thread_id=thread.id)

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
            **thread_runtime_fields(db, thread),
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
            "run_mode": latest_run.run_mode,
            "surface": latest_run.surface,
            "created_at": latest_run.created_at,
            "updated_at": latest_run.updated_at,
            "input_payload": latest_run.input_payload,
            "context_object_ids": latest_run.context_object_ids,
            "journey_target_ids": latest_run.journey_target_ids,
        }
        if latest_run
        else None,
        messages=[_serialize_message(m, attachments_by_message_id) for m in messages],
        tool_calls=[_serialize_tool_call(t) for t in tool_calls],
        image_runs=[image_run_service.serialize(db, row) for row in image_runs],
    )


@router.patch("/threads/{thread_id}/messages/{message_id}", response_model=MessageResponse)
async def patch_thread_message(
    thread_id: UUID,
    message_id: UUID,
    payload: PatchMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = require_owned_thread(db, thread_id=thread_id, user_id=current_user.id)
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
    thread.captured_prompt_snapshot = None
    db.commit()
    db.refresh(row)

    await runtime_event_dispatcher.emit_runtime_event(
        user_id=current_user.id,
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


@router.post("/threads/{thread_id}/tool-calls/decisions", response_model=ToolCallBatchDecisionResponse)
async def decide_tool_calls_batch(
    thread_id: UUID,
    payload: ToolCallBatchDecisionRequest,
    current_user: User = Depends(get_current_user),
):
    has_accept_decision = any(item.decision == "accept" for item in payload.decisions)

    if payload.pause_after_apply and has_accept_decision:
        def _pause_before_apply_sync() -> RuntimeSyncResult | None:
            db = SessionLocal()
            try:
                thread = require_owned_thread(db, thread_id=thread_id, user_id=current_user.id)
                latest_run = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .with_for_update()
                    .first()
                )
                sr: RuntimeSyncResult | None = None
                if latest_run is not None and latest_run.status in {"running", "waiting", "processing"}:
                    latest_run.status = "paused"
                    thread.status = "paused"
                    sr = sync_explicit_run_thread_status(
                        db,
                        run=latest_run,
                        thread=thread,
                        error=None,
                    )
                db.commit()
                refresh_runtime_sync_result(db, result=sr)
                return sr
            finally:
                db.close()

        sync_result = await asyncio.to_thread(_pause_before_apply_sync)
        if sync_result is not None:
            await emit_runtime_sync_events(runtime_event_dispatcher, result=sync_result)

    result_map: dict[UUID, dict] = {}
    accepted_ids: list[UUID] = []

    for item in payload.decisions:
        if item.decision == "reject":
            result_map[item.tool_call_id] = await _apply_tool_decision(
                user_id=current_user.id,
                thread_id=thread_id,
                tool_call_id=item.tool_call_id,
                decision=item.decision,
                reason=item.reason,
            )
        else:
            accepted_ids.append(item.tool_call_id)

    if accepted_ids:
        applied_results = await tool_engine.apply_tool_call_ids(
            SessionLocal,
            user_id=current_user.id,
            thread_id=thread_id,
            tool_call_ids=accepted_ids,
        )
        await _start_applied_tool_call_followups(
            user_id=current_user.id,
            thread_id=thread_id,
            applied_results=applied_results,
        )
        result_map.update(
            await _finalize_applied_tool_calls(
                user_id=current_user.id,
                thread_id=thread_id,
                tool_call_ids=accepted_ids,
            )
        )

    ordered: list[dict] = []
    for item in payload.decisions:
        if item.tool_call_id in result_map:
            ordered.append(result_map[item.tool_call_id])
        else:
            def _fallback_lookup(tool_call_id: UUID = item.tool_call_id) -> dict | None:
                db_fb = SessionLocal()
                try:
                    tc = db_fb.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
                    return {"tool_call": _serialize_tool_call(tc)} if tc is not None else None
                finally:
                    db_fb.close()

            fallback = await asyncio.to_thread(_fallback_lookup)
            if fallback is not None:
                ordered.append(fallback)
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
    thread = require_owned_thread(db, thread_id=thread_id, user_id=current_user.id)
    row = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.thread_id == thread_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")
    run_id = row.run_id
    # Cancel the active run first so the live stream can't re-persist tool calls after delete.
    if run_id is not None:
        latest_run = (
            db.query(RunModel)
            .filter(RunModel.thread_id == thread_id)
            .order_by(RunModel.run_seq.desc())
            .first()
        )
        if (
            latest_run is not None
            and latest_run.id == run_id
            and latest_run.status in _DELETE_CANCEL_RUN_STATUSES
        ):
            await run_pipeline.cancel_run_for_delete(thread_id=thread_id, user_id=current_user.id)
            db.refresh(thread)
    project_id = thread.project_id
    previous_thread_status = thread.status
    previous_unresolved_count = _count_unresolved_run_tool_calls(db, run_id=run_id)
    thread_before = snapshot_thread_row(thread)
    message_before = snapshot_run_message_row(row)
    tool_calls_before: list[object] = []
    tool_messages_before: list[object] = []
    attachment_rows = (
        db.query(RunMessageAttachmentModel)
        .filter(RunMessageAttachmentModel.message_id == row.id)
        .order_by(RunMessageAttachmentModel.sort_order.asc())
        .all()
    )
    attachments_before = snapshot_rows(attachment_rows, snapshot_run_message_attachment_row)
    if row.role == "assistant":
        tool_calls_before, tool_messages_before = _snapshot_assistant_tool_call_tree(
            db,
            assistant_message_id=row.id,
        )
    delete_chat_attachments_with_files(db, attachments=attachment_rows)
    db.delete(row)
    db.flush()
    paused_run, paused_thread, paused_after_delete = _pause_run_after_delete_if_needed(
        db,
        run_id=run_id,
        previous_thread_status=previous_thread_status,
        previous_unresolved_count=previous_unresolved_count,
    )
    pause_sync_result: RuntimeSyncResult | None = None
    if paused_after_delete and paused_run is not None and paused_thread is not None:
        pause_sync_result = sync_explicit_run_thread_status(
            db,
            run=paused_run,
            thread=paused_thread,
            error=None,
        )
    thread.captured_prompt_snapshot = None
    deltas = [
        build_run_message_delta(message_before, None),
        build_thread_delta(thread_before, snapshot_thread_row(thread)),
    ]
    deltas.extend(build_run_message_attachment_delta(attachment_before, None) for attachment_before in attachments_before)
    deltas.extend(build_tool_call_delta(tool_call, None) for tool_call in tool_calls_before)
    deltas.extend(build_run_message_delta(tool_message, None) for tool_message in tool_messages_before)
    apply_project_usage_deltas(
        db,
        user_id=current_user.id,
        project_id=thread.project_id,
        deltas=deltas,
        enforce_quota=False,
    )
    db.commit()
    if pause_sync_result is not None:
        await emit_runtime_sync_events(runtime_event_dispatcher, result=pause_sync_result)
    await _emit_thread_snapshot_invalidated(
        user_id=current_user.id,
        project_id=project_id,
        thread_id=thread_id,
        run_id=run_id,
    )
    return Response(status_code=204)


@router.post("/threads/{thread_id}/cancel", status_code=200)
async def cancel_thread(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
):
    await run_pipeline.cancel_run(thread_id=thread_id, user_id=current_user.id)
    return {"success": True}


@router.post("/threads/{thread_id}/pause", status_code=200)
async def pause_thread(
    thread_id: UUID,
    current_user: User = Depends(get_current_user),
):
    await run_pipeline.pause_run(thread_id=thread_id, user_id=current_user.id)
    return {"success": True}
