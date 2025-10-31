"""API routes for prompt management"""
from fastapi import APIRouter, Depends, HTTPException, status, Path
from sqlalchemy.orm import Session
from typing import Optional, List

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.prompts import (
    PromptContentResponse,
    PromptVersionCreate,
    PromptVersionResponse,
    VersionHistoryItem,
    PromptValidationRequest,
    ValidationResult,
    PromptRestoreRequest
)
from ..services.prompt_service import prompt_service
from ..services.template_validator import validator

router = APIRouter(prefix="/api/v1/prompts", tags=["prompts"])


# Routes without prompt_name (must come before routes with {prompt_name} to avoid conflicts)

@router.get(
    "/{function_type}/{prompt_category}",
    response_model=PromptContentResponse
)
async def get_prompt_without_name(
    function_type: str = Path(..., description="Function type (chat, translation, storyEdit, chapterGen)"),
    prompt_category: str = Path(..., description="Prompt category (systemPrompt, userPrompt, prefill, functionInstructions, userMessageTag)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get active prompt for prompts without a name (e.g., translation/systemPrompt)"""

    result = prompt_service.get_active_prompt(
        db=db,
        user_id=current_user.id,
        function_type=function_type,
        prompt_category=prompt_category,
        prompt_name=None
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt not found: {function_type}/{prompt_category}"
        )

    return result


@router.post(
    "/{function_type}/{prompt_category}/save",
    response_model=PromptVersionResponse
)
async def save_prompt_without_name(
    function_type: str,
    prompt_category: str,
    data: PromptVersionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save new version of a prompt without a name"""

    # Validate the template
    validation = validator.validate(data.content)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Invalid template syntax", "validation": validation.dict()}
        )

    result = prompt_service.save_new_version(
        db=db,
        user_id=current_user.id,
        function_type=function_type,
        prompt_category=prompt_category,
        content=data.content,
        note=data.note,
        prompt_name=None
    )

    return result


@router.get(
    "/{function_type}/{prompt_category}/versions",
    response_model=List[VersionHistoryItem]
)
async def get_version_history_without_name(
    function_type: str,
    prompt_category: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get version history for a prompt without a name"""

    versions = prompt_service.get_version_history(
        db=db,
        user_id=current_user.id,
        function_type=function_type,
        prompt_category=prompt_category,
        prompt_name=None
    )

    return versions


@router.post(
    "/{function_type}/{prompt_category}/restore",
    status_code=status.HTTP_200_OK
)
async def restore_version_without_name(
    function_type: str,
    prompt_category: str,
    data: PromptRestoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Restore a specific version for a prompt without a name"""

    success = prompt_service.restore_version(
        db=db,
        user_id=current_user.id,
        function_type=function_type,
        prompt_category=prompt_category,
        version_number=data.version_number,
        prompt_name=None
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {data.version_number} not found"
        )

    return {"success": True, "restored_version": data.version_number}


# Routes with prompt_name (must come after literal path segments like /save, /versions, /restore)

@router.get(
    "/{function_type}/{prompt_category}/{prompt_name}",
    response_model=PromptContentResponse
)
async def get_prompt_with_name(
    function_type: str = Path(..., description="Function type"),
    prompt_category: str = Path(..., description="Prompt category (systemPrompt, userPrompt, prefill, functionInstructions, userMessageTag)"),
    prompt_name: str = Path(..., description="Prompt name (workspace, novelEditor, etc.)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get active prompt for prompts with a name (e.g., chat/systemPrompt/workspace)"""

    result = prompt_service.get_active_prompt(
        db=db,
        user_id=current_user.id,
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

    # Validate the template
    validation = validator.validate(data.content)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Invalid template syntax", "validation": validation.dict()}
        )

    result = prompt_service.save_new_version(
        db=db,
        user_id=current_user.id,
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

    versions = prompt_service.get_version_history(
        db=db,
        user_id=current_user.id,
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
    """Restore a specific version for a prompt with a name"""

    success = prompt_service.restore_version(
        db=db,
        user_id=current_user.id,
        function_type=function_type,
        prompt_category=prompt_category,
        version_number=data.version_number,
        prompt_name=prompt_name
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {data.version_number} not found"
        )

    return {"success": True, "restored_version": data.version_number}


# Validation endpoint (doesn't use function_type/category pattern)

@router.post(
    "/validate",
    response_model=ValidationResult
)
async def validate_template(
    data: PromptValidationRequest,
    current_user: User = Depends(get_current_user)
):
    """Validate template syntax without saving"""

    validation = validator.validate(data.content)
    return validation
