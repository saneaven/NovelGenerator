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


# All prompt routes require an explicit prompt_name.

@router.get(
    "/{function_type}/{prompt_category}/{prompt_name}",
    response_model=PromptContentResponse
)
async def get_prompt_with_name(
    function_type: str = Path(..., description="Function type"),
    prompt_category: str = Path(..., description="Prompt category (systemPrompt, userPrompt, prefill, userMessageTag)"),
    prompt_name: str = Path(..., description="Prompt name (workspace, novelEditor, etc.)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get active prompt for prompts with a name (e.g., chat/systemPrompt/workspace)"""
    preset_id = get_active_preset_id(current_user)

    result = prompt_service.get_active_prompt(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        function_type=function_type,
        prompt_category=prompt_category,
        prompt_name=prompt_name
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt not found: {function_type}/{prompt_category}/{prompt_name}"
        )

    return result


@router.post(
    "/{function_type}/{prompt_category}/{prompt_name}/save",
    response_model=PromptVersionResponse
)
async def save_prompt_with_name(
    function_type: str,
    prompt_category: str,
    prompt_name: str,
    data: PromptVersionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save new version of a prompt with a name"""
    preset_id = get_active_preset_id(current_user)

    result = prompt_service.save_new_version(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        function_type=function_type,
        prompt_category=prompt_category,
        content=data.content,
        note=data.note,
        prompt_name=prompt_name
    )

    return result


@router.get(
    "/{function_type}/{prompt_category}/{prompt_name}/versions",
    response_model=List[VersionHistoryItem]
)
async def get_version_history_with_name(
    function_type: str,
    prompt_category: str,
    prompt_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get version history for a prompt with a name"""
    preset_id = get_active_preset_id(current_user)

    versions = prompt_service.get_version_history(
        db=db,
        user_id=current_user.id,
        preset_id=preset_id,
        function_type=function_type,
        prompt_category=prompt_category,
        prompt_name=prompt_name
    )

    return versions


@router.post(
    "/{function_type}/{prompt_category}/{prompt_name}/restore",
    status_code=status.HTTP_200_OK
)
async def restore_version_with_name(
    function_type: str,
    prompt_category: str,
    prompt_name: str,
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
        function_type=function_type,
        prompt_category=prompt_category,
        version_number=data.version_number,
        prompt_name=prompt_name
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
