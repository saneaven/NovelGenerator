from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID

from ..database import SessionLocal
from ..models.db_models import RunToolCallModel, Thread
from .ownership import require_owned_thread
from .runtime_event_dispatcher import runtime_event_dispatcher
from .thread_runtime_sync_service import (
    RuntimeSyncResult, sync_run_thread_status, refresh_runtime_sync_result, emit_runtime_sync_events,
)

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
    from .run_pipeline import run_pipeline
    from .image_run_service import image_run_service

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


async def apply_accepted_tool_calls(*, user_id: UUID, thread_id: UUID, tool_call_ids: list[UUID], automatic: bool = False, assistant_message_id: UUID | None = None) -> None:
    from .tool_engine import tool_engine

    results = await tool_engine.apply_tool_call_ids(
        SessionLocal, user_id=user_id, thread_id=thread_id, tool_call_ids=tool_call_ids,
        automatic=automatic, assistant_message_id=assistant_message_id,
    )
    await _start_applied_tool_call_followups(user_id=user_id, thread_id=thread_id, applied_results=results)
    await _finalize_applied_tool_calls(user_id=user_id, thread_id=thread_id, tool_call_ids=tool_call_ids)
