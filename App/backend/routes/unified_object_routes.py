"""
Unified CRUD routes for canonical project objects.

All project objects use the same pattern:
- GET: returns data from the latest object_versions row
- PUT: updates the object and creates a new version unless create_new_version=false
- POST /translations: adds a new language translation
- GET /versions: returns version history
- PATCH /versions/{version_id}/activate: reverts to a previous version
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from uuid import UUID

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import (
    User,
)
from ..schemas.object_schemas import ImagePromptUpdate
from ..utils.story_entities import STORY_ENTITY_TYPE, require_story_entity_kind
from ..services.object_service import object_service
from ..services.ownership import (
    require_owned_project,
    resolve_project_id_for_object,
)
from ..services.storage_usage_service import StorageQuotaExceededError


router = APIRouter()


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class UnifiedObjectResponse(BaseModel):
    """Standard response for canonical project objects."""
    id: str
    type: str
    kind: Optional[str] = None
    metadata: Dict[str, Any]  # project_id, created_at, updated_at, structure metadata
    data: Dict[str, Any]  # Language-keyed data: {"English": {...}, "Korean": {...}}
    # languages field removed - use Object.keys(data) for available, settings.mainLanguage for default
    version: Dict[str, Any]  # id, number, created_at

    class Config:
        from_attributes = True


class UpdateObjectRequest(BaseModel):
    """Request to update an object"""
    data: Dict[str, Any]
    language: str
    kind: Optional[str] = None
    user_request: Optional[str] = "User Edit"
    create_new_version: bool = True
    metadata: Optional[Dict[str, Any]] = None  # For structural updates like parent_id/position


class AddTranslationRequest(BaseModel):
    """Request to add a new language translation"""
    language: str
    data: Dict[str, Any]
    user_request: Optional[str] = "Translation"


class CreateObjectRequest(BaseModel):
    """Request to create a new object"""
    data: Dict[str, Any]
    language: str
    kind: Optional[str] = None
    user_request: Optional[str] = "Initial Creation"
    metadata: Optional[Dict[str, Any]] = None


class ListObjectsResponse(BaseModel):
    """Response for list objects endpoint"""
    objects: List[UnifiedObjectResponse]
    total: int
    page: int
    page_size: int


class VersionResponse(BaseModel):
    """Version history entry"""
    id: str
    number: int
    data: Dict[str, Any]  # All languages
    user_request: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


# ============================================================================
# UNIFIED CRUD ENDPOINTS
# ============================================================================

@router.get("/objects/{object_type}/{object_id}", response_model=UnifiedObjectResponse)
async def get_object(
    object_type: str,
    object_id: UUID,
    language: Optional[str] = Query(None, description="Optional: return only this language. Default: return all languages."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get object with language data.

    Default (no language param): Returns ALL languages in data field.
    With ?language=X: Returns only that language in data field.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )
    result = object_service.get_object(
        db,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
        language=language,
    )
    if result is None:
        raise HTTPException(status_code=404, detail=f"{object_type} not found")
    return UnifiedObjectResponse(**result)


@router.put("/objects/{object_type}/{object_id}")
async def update_object(
    object_type: str,
    object_id: UUID,
    request: UpdateObjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update object in specified language.
    Delegates all write logic to ObjectService (flush-only), then commits in route.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    try:
        updated = object_service.update_object(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            data=request.data,
            language=request.language,
            kind=request.kind,
            metadata=request.metadata,
            user_request=request.user_request or "User Edit",
            create_new_version=request.create_new_version,
            created_by=current_user.id,
        )
        db.commit()
        return updated
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        if "requires data.doc" in message or "does not accept data.content" in message:
            raise HTTPException(status_code=422, detail=message)
        raise HTTPException(status_code=400, detail=message)


@router.post("/objects/{object_type}/{object_id}/translations")
async def add_translation(
    object_type: str,
    object_id: UUID,
    request: AddTranslationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Add new language translation for an object.
    Updates the latest version in-place so translations remain tied to the
    originating content version rather than spawning a new version entry.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    try:
        result = object_service.add_translation(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            language=request.language,
            data=request.data,
            user_request=request.user_request or "Translation",
            created_by=current_user.id,
        )
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


@router.get("/objects/{object_type}/{object_id}/versions", response_model=List[VersionResponse])
async def get_versions(
    object_type: str,
    object_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get version history for an object.
    Returns all versions in reverse chronological order.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )
    try:
        versions = object_service.list_versions(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
        )
        return [VersionResponse(**v) for v in versions]
    except StorageQuotaExceededError:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


@router.patch("/objects/{object_type}/{object_id}/versions/{version_id}/activate")
async def restore_version(
    object_type: str,
    object_id: UUID,
    version_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Restore a previous version by creating a NEW version with the restored content.
    The restored content becomes the latest version.
    This is NOT a pointer change - it creates a new version entry.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )
    try:
        result = object_service.restore_version(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            version_id=version_id,
            created_by=current_user.id,
        )
        db.commit()
        return result
    except HTTPException:
        db.rollback()
        raise
    except StorageQuotaExceededError:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


# ============================================================================
# LIST & COLLECTION OPERATIONS
# ============================================================================

@router.get("/projects/{project_id}/objects/{object_type}", response_model=ListObjectsResponse)
async def list_objects(
    project_id: UUID,
    object_type: str,
    language: Optional[str] = Query(None, description="Optional: return only this language. Default: return all languages."),
    kinds: Optional[List[str]] = Query(None, description="Optional story entity kind filters."),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    List all objects of a specific type for a project.

    Default (no language param): Returns ALL languages in data field for each object.
    With ?language=X: Returns only that language in data field.
    """
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    normalized_kinds: list[str] | None = None
    if kinds:
        if object_type == STORY_ENTITY_TYPE:
            normalized_kinds = [require_story_entity_kind(kind) for kind in kinds]
        elif object_type == "outline":
            normalized_kinds = [str(kind) for kind in kinds]

    serialized = object_service.list_objects(
        db,
        project_id=project_id,
        object_type=object_type,
        language=language,
        kinds=normalized_kinds,
    )
    result_objects = [UnifiedObjectResponse(**item) for item in serialized]

    total = len(result_objects)
    start = (page - 1) * page_size
    end = start + page_size
    paginated_objects = result_objects[start:end]

    return ListObjectsResponse(
        objects=paginated_objects,
        total=total,
        page=page,
        page_size=page_size
    )


@router.post("/projects/{project_id}/objects/{object_type}")
async def create_object(
    project_id: UUID,
    object_type: str,
    request: CreateObjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new object of a specific type.
    Delegates all write logic to ObjectService (flush-only), then commits in route.
    """
    # Verify project access.
    require_owned_project(db, user_id=current_user.id, project_id=project_id)

    try:
        if object_type in {STORY_ENTITY_TYPE, "outline"} and request.kind is None:
            raise HTTPException(status_code=400, detail=f"{object_type} creation requires kind")
        created = object_service.create_object(
            db,
            project_id=project_id,
            object_type=object_type,
            data=request.data,
            language=request.language,
            kind=request.kind,
            metadata=request.metadata,
            user_request=request.user_request or "Initial Creation",
            create_new_version=True,
            created_by=current_user.id,
        )
        db.commit()
        return created
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        if "requires data.doc" in message or "does not accept data.content" in message:
            raise HTTPException(status_code=422, detail=message)
        raise HTTPException(status_code=400, detail=message)


@router.delete("/objects/{object_type}/{object_id}")
async def delete_object(
    object_type: str,
    object_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete an object and all its translations/versions.
    Delegates delete logic to ObjectService (flush-only), then commits in route.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    try:
        object_service.delete_object(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            user_id=current_user.id,
        )
        db.commit()
        return {"success": True, "message": f"{object_type.replace('_', ' ').title()} deleted successfully"}
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


# ============================================================================
# IMAGE PROMPT MANAGEMENT
# ============================================================================

@router.patch("/objects/{object_type}/{object_id}/image-prompt")
async def update_image_prompt(
    object_type: str,
    object_id: UUID,
    request: ImagePromptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update image prompts for a project object.
    These are stored directly on the object (not versioned).
    Supports both natural language prompts and tag-based prompts (NovelAI).
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    try:
        result = object_service.update_image_prompt(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            user_id=current_user.id,
            image_prompt=request.image_prompt,
            image_prompt_positive=request.image_prompt_positive,
            image_prompt_negative=request.image_prompt_negative,
        )
        db.commit()
        return result
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


