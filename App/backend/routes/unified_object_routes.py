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
from typing import Optional, Dict, Any, List, Literal
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
RichTextFormat = Literal["tiptap", "markdown", "tree"]


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class UnifiedObjectResponse(BaseModel):
    """Standard response for canonical project objects."""
    id: str
    type: str
    kind: Optional[str] = None
    metadata: Dict[str, Any]  # project_id, created_at, updated_at, structure metadata
    data: Dict[str, Any]
    language_state: Dict[str, Any]
    version: Dict[str, Any]  # id, number, created_at

    class Config:
        from_attributes = True


class UpdateObjectRequest(BaseModel):
    """Request to update an object"""
    data: Dict[str, Any]
    language: str
    rich_text_format: Literal["tiptap", "markdown"] = "tiptap"
    kind: Optional[str] = None
    user_request: Optional[str] = "User Edit"
    create_new_version: bool = True
    metadata: Optional[Dict[str, Any]] = None  # For structural updates like parent_id/position


class AddTranslationRequest(BaseModel):
    """Request to add a new language translation"""
    language: str
    data: Dict[str, Any]
    rich_text_format: Literal["tiptap", "markdown"] = "tiptap"
    user_request: Optional[str] = "Translation"


class CreateObjectRequest(BaseModel):
    """Request to create a new object"""
    data: Dict[str, Any]
    language: str
    rich_text_format: Literal["tiptap", "markdown"] = "tiptap"
    kind: Optional[str] = None
    user_request: Optional[str] = "Initial Creation"
    metadata: Optional[Dict[str, Any]] = None


class StructurePatchRequest(BaseModel):
    """Request to update structural metadata without creating a version."""
    metadata: Dict[str, Any]


class ListObjectsResponse(BaseModel):
    """Response for list objects endpoint"""
    objects: List[UnifiedObjectResponse]
    total: int
    page: int
    page_size: int


class VersionResponse(BaseModel):
    """Version history entry. ``data`` is omitted in metadata-only responses."""
    id: str
    number: int
    data: Optional[Dict[str, Any]] = None  # All languages; None when metadata_only
    languages: Optional[List[str]] = None  # Language keys, populated when metadata_only
    user_request: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


# ============================================================================
# UNIFIED CRUD ENDPOINTS
# ============================================================================


def _main_language(current_user: User) -> str:
    settings = getattr(current_user, "settings", None)
    value = getattr(settings, "main_language", None)
    return str(value or "English")

@router.get("/objects/{object_type}/{object_id}", response_model=UnifiedObjectResponse)
async def get_object(
    object_type: str,
    object_id: UUID,
    language: Optional[str] = Query(None, description="Requested projection language. Defaults to the user's main language."),
    rich_text_format: RichTextFormat = Query("tiptap"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get one object projected into a single requested language."""
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )
    main_language = _main_language(current_user)
    requested_language = language or main_language
    result = object_service.get_object(
        db,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
        language=requested_language,
        rich_text_format=rich_text_format,
        fallback_language=main_language,
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
            rich_text_format=request.rich_text_format,
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
            rich_text_format=request.rich_text_format,
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
    rich_text_format: RichTextFormat = Query("tiptap"),
    metadata_only: bool = Query(False, description="Return only version metadata, omitting heavy data"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get version history for an object.
    Returns all versions in reverse chronological order.

    When ``metadata_only=true``, the response omits the ``data`` field and includes
    a ``languages`` list instead, avoiding the cost of loading and rendering the
    full content for every version.
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
            rich_text_format=rich_text_format,
            metadata_only=metadata_only,
        )
        return [VersionResponse(**v) for v in versions]
    except StorageQuotaExceededError:
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)


@router.get(
    "/objects/{object_type}/{object_id}/versions/{version_id}",
    response_model=VersionResponse,
)
async def get_version(
    object_type: str,
    object_id: UUID,
    version_id: UUID,
    rich_text_format: RichTextFormat = Query("tiptap"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get a single version with its full rendered content.

    Used by the version history modal to lazy-load content when the user expands
    a version's details, instead of shipping every version's content up front.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )
    try:
        result = object_service.get_version(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            version_id=version_id,
            rich_text_format=rich_text_format,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    if result is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return VersionResponse(**result)


@router.patch("/objects/{object_type}/{object_id}/versions/{version_id}/activate")
async def restore_version(
    object_type: str,
    object_id: UUID,
    version_id: UUID,
    rich_text_format: RichTextFormat = Query("tiptap"),
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
            rich_text_format=rich_text_format,
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
    language: Optional[str] = Query(None, description="Requested projection language. Defaults to the user's main language."),
    kinds: Optional[List[str]] = Query(None, description="Optional story entity kind filters."),
    rich_text_format: RichTextFormat = Query("tiptap"),
    include_content: bool = Query(True, description="When false, omit heavy rich-text body (content/authorNote); keep labels/metadata/wordCount."),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List project objects projected into a single requested language."""
    require_owned_project(db, user_id=current_user.id, project_id=project_id)
    normalized_kinds: list[str] | None = None
    if kinds:
        if object_type == STORY_ENTITY_TYPE:
            normalized_kinds = [require_story_entity_kind(kind) for kind in kinds]
        elif object_type == "outline":
            normalized_kinds = [str(kind) for kind in kinds]

    main_language = _main_language(current_user)
    requested_language = language or main_language
    serialized = object_service.list_objects(
        db,
        project_id=project_id,
        object_type=object_type,
        language=requested_language,
        kinds=normalized_kinds,
        rich_text_format=rich_text_format,
        fallback_language=main_language,
        include_content=include_content,
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
            rich_text_format=request.rich_text_format,
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
        raise HTTPException(status_code=400, detail=message)


@router.patch("/objects/{object_type}/{object_id}/structure", response_model=UnifiedObjectResponse)
async def patch_object_structure(
    object_type: str,
    object_id: UUID,
    request: StructurePatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update structural metadata for tree-backed objects without creating a new version.
    """
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    try:
        updated = object_service.update_object_structure(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            metadata=request.metadata,
            created_by=current_user.id,
        )
        db.commit()
        return UnifiedObjectResponse(**updated)
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
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
    Stores natural, positive/negative, and NovelAI character prompts together.
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
            image_prompts=request.image_prompts.model_dump(),
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
