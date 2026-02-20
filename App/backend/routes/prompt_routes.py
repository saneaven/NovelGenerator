"""API routes for prompt management"""
from fastapi import APIRouter, Depends, HTTPException, status, Path
from sqlalchemy.orm import Session
from typing import List
import uuid

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.prompts import (
    PromptContentResponse,
    PromptVersionCreate,
    PromptVersionResponse,
    VersionHistoryItem,
    PromptRestoreRequest
)
from ..services.prompt_service import prompt_service

router = APIRouter(prefix="/api/v1/prompts", tags=["prompts"])


def get_active_preset_id(current_user: User) -> uuid.UUID:
    """Get active preset ID from user settings, raise 400 if not set"""
    if not current_user.settings or not current_user.settings.active_preset_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active preset set. Please select or create a preset first."
        )
    return current_user.settings.active_preset_id


@router.get(
    "/{task_type}/{task_subtype}/{prompt_category}",
    response_model=PromptContentResponse
)
async def get_prompt(
    task_type: str = Path(..., description="Task type (agent, translation, etc.)"),
    task_subtype: str = Path(..., description="Task subtype (planMode, agentMode, object, etc.)"),
    prompt_category: str = Path(..., description="Prompt category (systemPrompt, userPrompt, prefill, etc.)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get active prompt by task_type/task_subtype/prompt_category"""
    preset_id = get_active_preset_id(current_user)

    result = prompt_service.get_active_prompt(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
        prompt_category=prompt_category,
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt not found: {task_type}/{task_subtype}/{prompt_category}"
        )

    return result


@router.post(
    "/{task_type}/{task_subtype}/{prompt_category}/save",
    response_model=PromptVersionResponse
)
async def save_prompt(
    task_type: str,
    task_subtype: str,
    prompt_category: str,
    data: PromptVersionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save new version of a prompt"""
    preset_id = get_active_preset_id(current_user)

    result = prompt_service.save_new_version(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
        prompt_category=prompt_category,
        content=data.content,
        note=data.note,
    )

    return result


@router.get(
    "/{task_type}/{task_subtype}/{prompt_category}/versions",
    response_model=List[VersionHistoryItem]
)
async def get_version_history(
    task_type: str,
    task_subtype: str,
    prompt_category: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get version history for a prompt"""
    preset_id = get_active_preset_id(current_user)

    versions = prompt_service.get_version_history(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
        prompt_category=prompt_category,
    )

    return versions


@router.post(
    "/{task_type}/{task_subtype}/{prompt_category}/restore",
    status_code=status.HTTP_200_OK
)
async def restore_version(
    task_type: str,
    task_subtype: str,
    prompt_category: str,
    data: PromptRestoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Restore a specific version by creating a new version with the restored content"""
    preset_id = get_active_preset_id(current_user)

    result = prompt_service.restore_version(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        task_type=task_type,
        task_subtype=task_subtype,
        prompt_category=prompt_category,
        version_number=data.version_number,
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {data.version_number} not found"
        )

    return {
        "success": True,
        "restored_from": data.version_number,
        "new_version": result.version_number
    }
