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


@router.get("", response_model=List[SubAgentDefinition])
async def list_sub_agents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    preset_id = get_active_preset_id(current_user)
    return sub_agent_service.list_sub_agents(db=db, user_id=current_user.id, preset_id=preset_id)


@router.get("/available_tools", response_model=List[str])
async def list_available_tools(
    _current_user: User = Depends(get_current_user),
):
    return tool_engine._registry.list_static_tool_names("agent_agent_mode")


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
    try:
        sub_agent_service.delete_sub_agent(db=db, user_id=current_user.id, preset_id=preset_id, sub_agent_id=sub_agent_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return {"success": True}
