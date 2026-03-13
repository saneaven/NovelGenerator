"""API routes for Sub Agents (per active prompt preset)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status, Path
from sqlalchemy.orm import Session
import uuid
from typing import List

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.sub_agents import SubAgentCreate, SubAgentDefinition, SubAgentUpdate
from ..services.demo_policy import require_demo_off
from ..services.notification_service import ACTIVE_THREAD_DELETE_STATUSES, collect_thread_delete_deltas, delete_threads
from ..services.run_pipeline import run_pipeline
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.storage_usage_service import apply_project_usage_deltas
from ..services.sub_agent_service import sub_agent_service
from ..services.tool_engine import tool_engine


router = APIRouter(prefix="/api/v1/sub_agents", tags=["sub_agents"])


def get_active_preset_id(current_user: User) -> uuid.UUID:
    """Get active preset ID from user settings, raise 400 if not set."""
    if not current_user.settings or not current_user.settings.active_preset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active preset set. Please select or create a preset first."
        )
    return current_user.settings.active_preset_id


async def _cancel_linked_sub_agent_threads_for_delete(
    *,
    threads: List[object],
    user_id: uuid.UUID,
) -> None:
    seen: set[uuid.UUID] = set()
    for thread in threads:
        thread_id = getattr(thread, "id", None)
        thread_status = getattr(thread, "status", None)
        if (
            not isinstance(thread_id, uuid.UUID)
            or thread_id in seen
            or thread_status not in ACTIVE_THREAD_DELETE_STATUSES
        ):
            continue
        seen.add(thread_id)
        await run_pipeline.cancel_run_for_delete(thread_id=thread_id, user_id=user_id)


@router.get("", response_model=List[SubAgentDefinition])
async def list_sub_agents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    return sub_agent_service.list_sub_agents(db=db, user_id=current_user.id, preset_id=preset_id)


@router.get("/available_tools", response_model=List[str])
async def list_available_tools(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    return tool_engine.list_static_tool_names_for_agent(db, user_id=current_user.id, preset_id=preset_id)


@router.post("", response_model=SubAgentDefinition, status_code=status.HTTP_201_CREATED)
async def create_sub_agent(
    data: SubAgentCreate,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    try:
        return sub_agent_service.create_sub_agent(db=db, user_id=current_user.id, preset_id=preset_id, data=data)
    except ValueError as e:
        # Duplicate / validation errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put(
    "/{sub_agent_id}",
    response_model=SubAgentDefinition,
    status_code=status.HTTP_200_OK,
)
async def update_sub_agent(
    sub_agent_id: uuid.UUID = Path(..., description="Sub agent UUID id"),
    data: SubAgentUpdate = ...,
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    try:
        return sub_agent_service.update_sub_agent(
            db=db,
            user_id=current_user.id,
            preset_id=preset_id,
            sub_agent_id=sub_agent_id,
            data=data,
        )
    except ValueError as e:
        detail = str(e)
        if detail.startswith("Sub agent not found:"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.delete(
    "/{sub_agent_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_sub_agent(
    sub_agent_id: uuid.UUID = Path(..., description="Sub agent UUID id"),
    _demo_guard: None = Depends(require_demo_off),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    deleted_thread_ids_by_project: dict[uuid.UUID, list[str]] = {}
    try:
        threads = sub_agent_service.list_sub_agent_threads(
            db,
            user_id=current_user.id,
            sub_agent_id=sub_agent_id,
        )
        await _cancel_linked_sub_agent_threads_for_delete(threads=threads, user_id=current_user.id)
        if threads:
            db.expire_all()

        thread_ids = [getattr(thread, "id", None) for thread in threads]
        thread_deltas_by_project = collect_thread_delete_deltas(
            db,
            user_id=current_user.id,
            thread_ids=thread_ids,
            thread_type="subAgent",
        )
        deleted_thread_ids_by_project = delete_threads(
            db,
            user_id=current_user.id,
            thread_ids=thread_ids,
            thread_type="subAgent",
        )

        sub_agent_service.delete_sub_agent(
            db=db,
            user_id=current_user.id,
            preset_id=preset_id,
            sub_agent_id=sub_agent_id,
            commit=False,
        )
        for project_id, deltas in thread_deltas_by_project.items():
            if not deltas:
                continue
            apply_project_usage_deltas(
                db,
                user_id=current_user.id,
                project_id=project_id,
                deltas=deltas,
                enforce_quota=False,
            )
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    for project_id, deleted_thread_ids in deleted_thread_ids_by_project.items():
        if len(deleted_thread_ids) == 1:
            await runtime_event_dispatcher.emit_project_event(
                user_id=current_user.id,
                project_id=project_id,
                event_name="thread:delete",
                data={"id": deleted_thread_ids[0]},
            )
            continue
        if deleted_thread_ids:
            await runtime_event_dispatcher.emit_project_event(
                user_id=current_user.id,
                project_id=project_id,
                event_name="thread:bulk_delete",
                data={"ids": deleted_thread_ids},
            )
    return {"success": True}
