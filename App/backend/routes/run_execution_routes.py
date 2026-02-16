from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import get_current_user
from ..database import get_db, short_session
from ..models.db_models import Project, RunMessageModel, RunModel, User
from ..providers.sse_encoder import encode_sse
from ..schemas.run_execution import (
    AppendRunMessageRequest,
    QueryRunsRequest,
    RunDecisionsRequest,
    RunQueryResponse,
    RunResponse,
    RunStateResponse,
    StartRunRequest,
)
from ..services.run_engine import run_engine
from ..services.run_event_bus import run_event_bus
from ..services.run_event_emitter import run_event_emitter


router = APIRouter(prefix="/api/v1/projects/{project_id}/runs", tags=["run-execution"])


class PatchRunMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: str
    content_parts: list[dict] | None = None
    thinking_details: list[dict] | None = None


class PatchRunMessageResponse(BaseModel):
    message: dict = Field(default_factory=dict)


def _run_to_response(run: RunModel) -> RunResponse:
    return RunResponse.model_validate(run)


def _ensure_project_access(db: Session, *, user_id: UUID, project_id: UUID) -> None:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")


def _get_owned_run(db: Session, *, run_id: UUID, project_id: UUID, user_id: UUID, for_update: bool = False) -> RunModel:
    query = db.query(RunModel).filter(
        RunModel.id == run_id,
        RunModel.project_id == project_id,
        RunModel.user_id == user_id,
    )
    if for_update:
        query = query.with_for_update()
    run = query.first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _message_to_dict(message: RunMessageModel) -> dict:
    return {
        "id": str(message.id),
        "run_id": str(message.run_id),
        "seq": int(message.seq),
        "role": message.role,
        "data": message.data if isinstance(message.data, dict) else {},
        "created_at": message.created_at.isoformat() if message.created_at else datetime.now(timezone.utc).isoformat(),
    }


def _serialize_event_payload(event: dict) -> tuple[str, dict]:
    event_name = str(event.get("event") or "message")
    payload = {k: v for k, v in event.items() if k != "event"}
    return event_name, payload


async def _stream_run_events(
    run_id: UUID,
    *,
    trigger: asyncio.Task | None = None,
    after_seq: int | None = None,
):
    subscription = run_event_bus.subscribe(run_id, after_seq=after_seq)
    event_iter = subscription.__aiter__()
    last_seq = after_seq or 0

    try:
        while True:
            try:
                event = await asyncio.wait_for(event_iter.__anext__(), timeout=15.0)
            except asyncio.TimeoutError:
                if trigger is not None and trigger.done():
                    with contextlib.suppress(Exception):
                        await trigger
                    break
                # Keep event_seq monotonic by emitting heartbeat through the run event emitter.
                with short_session() as db:
                    run = db.query(RunModel).filter(RunModel.id == run_id).first()
                    if run is not None:
                        await run_event_emitter.emit_heartbeat(run)
                continue

            seq = int(event.get("event_seq") or 0)
            if seq > last_seq:
                last_seq = seq
            event_name, payload = _serialize_event_payload(event)
            yield encode_sse(event_name, payload)

            if event_name in {"run:complete", "run:error"}:
                break
            if event_name == "run:status":
                body = payload.get("payload") if isinstance(payload, dict) else None
                status = body.get("status") if isinstance(body, dict) else None
                if status in {"paused", "cancelled"}:
                    break
            if event_name == "run:step_completed":
                body = payload.get("payload") if isinstance(payload, dict) else None
                should_continue = body.get("should_continue") if isinstance(body, dict) else None
                if should_continue is False:
                    break
    finally:
        if trigger is not None:
            with contextlib.suppress(Exception):
                await trigger
        if hasattr(subscription, "aclose"):
            with contextlib.suppress(Exception):
                await subscription.aclose()


@router.post("/start")
async def start_run(
    project_id: UUID,
    req: StartRunRequest,
    after_seq: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)

    if req.run_type == "agent":
        agent = req.agent_id
        from ..models.db_models import Agent

        exists = db.query(Agent).filter(Agent.id == agent, Agent.project_id == project_id).first()
        if exists is None:
            raise HTTPException(status_code=404, detail="Agent not found")

    run_id = await run_engine.start_run(current_user.id, project_id, req)

    async def gen():
        async for chunk in _stream_run_events(run_id, after_seq=after_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/{run_id}/decisions")
async def apply_decisions(
    project_id: UUID,
    run_id: UUID,
    req: RunDecisionsRequest,
    after_seq: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == current_user.id, RunModel.project_id == project_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    async def trigger_apply() -> None:
        await run_engine.apply_decisions(current_user.id, run_id, req)

    task = asyncio.create_task(trigger_apply())

    async def gen():
        async for chunk in _stream_run_events(run_id, trigger=task, after_seq=after_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/{run_id}/resume")
async def resume_run(
    project_id: UUID,
    run_id: UUID,
    after_seq: int | None = Query(default=None, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == current_user.id, RunModel.project_id == project_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    async def trigger_resume() -> None:
        await run_engine.resume_run(current_user.id, run_id)

    task = asyncio.create_task(trigger_resume())

    async def gen():
        async for chunk in _stream_run_events(run_id, trigger=task, after_seq=after_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/{run_id}/pause")
async def pause_run(
    project_id: UUID,
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    await run_engine.pause_run(current_user.id, run_id)
    return {"ok": True}


@router.post("/{run_id}/cancel")
async def cancel_run(
    project_id: UUID,
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    await run_engine.cancel_run(current_user.id, run_id)
    return {"ok": True}


@router.post("/{run_id}/messages")
async def append_run_message(
    project_id: UUID,
    run_id: UUID,
    req: AppendRunMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)

    run = (
        db.query(RunModel)
        .filter(RunModel.id == run_id, RunModel.user_id == current_user.id, RunModel.project_id == project_id)
        .with_for_update()
        .first()
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    message = RunMessageModel(
        run_id=run.id,
        seq=run.next_message_seq,
        role="user",
        data={
            req.language: {
                "contentParts": [{"type": "content", "text": req.text}],
                "thinkingDetails": [],
            }
        },
    )
    run.next_message_seq += 1
    db.add(message)
    db.commit()

    return {"ok": True, "message_id": str(message.id)}


@router.patch("/{run_id}/messages/{message_id}", response_model=PatchRunMessageResponse)
async def patch_run_message(
    project_id: UUID,
    run_id: UUID,
    message_id: UUID,
    req: PatchRunMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    run = _get_owned_run(db, run_id=run_id, project_id=project_id, user_id=current_user.id, for_update=False)

    message = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.run_id == run.id)
        .first()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="Run message not found")

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
    return PatchRunMessageResponse(message=_message_to_dict(message))


@router.put("/{run_id}/messages/{message_id}/translate", response_model=PatchRunMessageResponse)
async def translate_run_message(
    project_id: UUID,
    run_id: UUID,
    message_id: UUID,
    req: PatchRunMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await patch_run_message(
        project_id=project_id,
        run_id=run_id,
        message_id=message_id,
        req=req,
        current_user=current_user,
        db=db,
    )


@router.delete("/{run_id}/messages/{message_id}")
async def delete_run_message(
    project_id: UUID,
    run_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    run = _get_owned_run(db, run_id=run_id, project_id=project_id, user_id=current_user.id, for_update=False)

    message = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id == message_id, RunMessageModel.run_id == run.id)
        .first()
    )
    if message is None:
        raise HTTPException(status_code=404, detail="Run message not found")

    db.delete(message)
    db.flush()

    remaining = db.query(RunMessageModel).filter(RunMessageModel.run_id == run.id).count()
    if remaining == 0:
        db.delete(run)

    db.commit()
    return {"ok": True}


@router.get("/{run_id}", response_model=RunStateResponse)
async def get_run_state(
    project_id: UUID,
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)
    run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == current_user.id, RunModel.project_id == project_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunStateResponse(run=_run_to_response(run))


@router.post("/query", response_model=RunQueryResponse)
async def query_runs(
    project_id: UUID,
    req: QueryRunsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_project_access(db, user_id=current_user.id, project_id=project_id)

    query = db.query(RunModel).filter(RunModel.project_id == project_id, RunModel.user_id == current_user.id)
    if req.run_types:
        query = query.filter(RunModel.run_type.in_(req.run_types))
    if req.statuses:
        query = query.filter(RunModel.status.in_(req.statuses))

    rows = (
        query.order_by(RunModel.created_at.desc(), RunModel.id.desc()).limit(req.limit).all()
    )
    return RunQueryResponse(items=[_run_to_response(r) for r in rows])
