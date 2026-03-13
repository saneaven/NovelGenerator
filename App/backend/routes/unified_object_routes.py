"""
Unified CRUD Routes for New Translation System

All story objects use the same pattern:
- GET: Returns object with data from latest object_versions
- PUT: Updates object, creates new version (or updates latest when create_new_version=false)
- POST /translations: Adds new language translation
- GET /versions: Returns version history
- PATCH /versions/{version_id}/activate: Reverts to previous version
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import (
    User, Project, BasicInfo, Guidelines, Character, Organization, Location, LorebookEntry,
    Act, Chapter, Manuscript, Outline, StoryObjectAsset
)
from ..schemas.story_objects import ImagePromptUpdate
from ..models.translation_models import ObjectVersion
from ..utils.object_type_aliases import normalize_object_type, externalize_object_type
from ..services.object_service import object_service
from ..services.ownership import (
    get_object_model_class,
    require_owned_project,
    resolve_project_id_for_object,
)
from ..services.storage_usage_service import StorageQuotaExceededError

LOREBOOK_TYPE = normalize_object_type('lorebook')


router = APIRouter()


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class UnifiedObjectResponse(BaseModel):
    """Standard response for all story objects"""
    id: str
    type: str
    metadata: Dict[str, Any]  # project_id, created_at, updated_at, order (if applicable)
    data: Dict[str, Any]  # Language-keyed data: {"English": {...}, "Korean": {...}}
    # languages field removed - use Object.keys(data) for available, settings.mainLanguage for default
    version: Dict[str, Any]  # id, number, created_at

    class Config:
        from_attributes = True


class UpdateObjectRequest(BaseModel):
    """Request to update an object"""
    data: Dict[str, Any]
    language: str
    user_request: Optional[str] = "User Edit"
    create_new_version: bool = True
    metadata: Optional[Dict[str, Any]] = None  # For structural updates like order


class AddTranslationRequest(BaseModel):
    """Request to add a new language translation"""
    language: str
    data: Dict[str, Any]
    user_request: Optional[str] = "Translation"


class CreateObjectRequest(BaseModel):
    """Request to create a new object"""
    data: Dict[str, Any]
    language: str
    user_request: Optional[str] = "Initial Creation"
    metadata: Optional[Dict[str, Any]] = None


class ListObjectsResponse(BaseModel):
    """Response for list objects endpoint"""
    objects: List[UnifiedObjectResponse]
    total: int
    page: int
    page_size: int


class ReorderObjectsRequest(BaseModel):
    """Request to reorder objects of a specific type"""
    object_ids: List[str]  # IDs in desired order


class VersionResponse(BaseModel):
    """Version history entry"""
    id: str
    number: int
    data: Dict[str, Any]  # All languages
    user_request: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


def get_object_metadata(obj: Any, object_type: str, db: Optional[Session] = None) -> Dict[str, Any]:
    """Extract metadata from object"""
    metadata = {
        'id': str(obj.id),
        'created_at': obj.created_at.isoformat() if obj.created_at else None,
        'updated_at': obj.updated_at.isoformat() if obj.updated_at else None,
    }

    # Add parent ID based on object type
    if object_type == 'basic_info':
        metadata['project_id'] = str(obj.project_id)
        # Cover image ID from main StoryObjectAsset (URL resolved at runtime by frontend)
        metadata['cover_image_id'] = None
        if db:
            main_link = db.query(StoryObjectAsset).filter(
                StoryObjectAsset.object_type == 'basic_info',
                StoryObjectAsset.object_id == obj.id,
                StoryObjectAsset.is_main == True
            ).first()
            if main_link:
                metadata['cover_image_id'] = str(main_link.asset_id)
        # Image prompt fields for cover image generation
        metadata['image_prompt'] = getattr(obj, 'image_prompt', None)
        metadata['image_prompt_positive'] = getattr(obj, 'image_prompt_positive', None)
        metadata['image_prompt_negative'] = getattr(obj, 'image_prompt_negative', None)
    elif object_type == 'guidelines':
        metadata['project_id'] = str(obj.project_id)
    elif object_type in ['character', 'organization', 'location', LOREBOOK_TYPE]:
        metadata['project_id'] = str(obj.project_id)
        # Include order field for story objects
        metadata['order'] = getattr(obj, 'order', 0) or 0
        # Include image prompt fields for story objects that support them
        metadata['image_prompt'] = getattr(obj, 'image_prompt', None)
        metadata['image_prompt_positive'] = getattr(obj, 'image_prompt_positive', None)
        metadata['image_prompt_negative'] = getattr(obj, 'image_prompt_negative', None)
    elif object_type == 'outline':
        metadata['project_id'] = str(obj.project_id)
        metadata['order'] = getattr(obj, 'order', 0) or 0
    elif object_type == 'act':
        outline = getattr(obj, 'outline', None)
        if not outline:
            raise HTTPException(status_code=500, detail='Act is missing outline relation')

        metadata['project_id'] = str(outline.project_id)
        metadata['outline_id'] = str(obj.outline_id)
        metadata['order'] = obj.order
    elif object_type == 'chapter':
        act = getattr(obj, 'act', None)
        if not act:
            raise HTTPException(status_code=500, detail='Chapter is missing act relation')

        manuscript = getattr(obj, 'manuscript', None)
        if not manuscript:
            raise HTTPException(status_code=500, detail='Chapter manuscript relation missing')

        outline = getattr(act, 'outline', None)
        if not outline:
            raise HTTPException(status_code=500, detail='Chapter act is missing outline relation')

        metadata['project_id'] = str(outline.project_id)
        metadata['act_id'] = str(obj.act_id)
        metadata['manuscript_id'] = str(manuscript.id)
        metadata['order'] = obj.order
    elif object_type == 'manuscript':
        chapter = getattr(obj, 'chapter', None)
        if not chapter:
            raise HTTPException(status_code=500, detail='Manuscript is missing chapter relation')

        act = getattr(chapter, 'act', None)
        if not act:
            raise HTTPException(status_code=500, detail='Manuscript chapter is missing act relation')

        outline = getattr(act, 'outline', None)
        if not outline:
            raise HTTPException(status_code=500, detail='Manuscript outline relation missing')

        metadata['project_id'] = str(outline.project_id)
        metadata['chapter_id'] = str(obj.chapter_id)

    return metadata


def get_latest_version(db: Session, object_type: str, object_id: UUID) -> Optional[ObjectVersion]:
    """Get the latest version (highest version_number) for an object"""
    return db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).order_by(ObjectVersion.version_number.desc()).first()


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
    object_type = normalize_object_type(object_type)
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
    object_type = normalize_object_type(object_type)
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
    object_type = normalize_object_type(object_type)
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
    object_type = normalize_object_type(object_type)
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
    object_type = normalize_object_type(object_type)
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
    object_type = normalize_object_type(object_type)
    require_owned_project(db, user_id=current_user.id, project_id=project_id)

    serialized = object_service.list_objects(
        db,
        project_id=project_id,
        object_type=object_type,
        language=language,
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
    object_type = normalize_object_type(object_type)

    # Verify project access.
    require_owned_project(db, user_id=current_user.id, project_id=project_id)

    try:
        created = object_service.create_object(
            db,
            project_id=project_id,
            object_type=object_type,
            data=request.data,
            language=request.language,
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
    object_type = normalize_object_type(object_type)
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
    Update image prompts for a story object.
    These are stored directly on the object (not versioned).
    Supports both natural language prompts and tag-based prompts (NovelAI).
    """
    object_type = normalize_object_type(object_type)
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


# ============================================================================
# STORY OBJECT REORDERING
# ============================================================================

@router.patch("/projects/{project_id}/objects/{object_type}/reorder")
async def reorder_objects(
    project_id: UUID,
    object_type: str,
    request: ReorderObjectsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Reorder objects of a specific type within a project.
    Takes an array of object IDs in the desired order.
    Updates the order field for each object (1-indexed).
    """
    object_type = normalize_object_type(object_type)
    require_owned_project(db, user_id=current_user.id, project_id=project_id)

    object_ids: list[UUID] = []
    for value in request.object_ids:
        try:
            object_ids.append(UUID(value))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid UUID: {value}")

    try:
        count = object_service.reorder_objects(
            db,
            project_id=project_id,
            object_type=object_type,
            object_ids=object_ids,
            user_id=current_user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)

    return {"success": True, "message": f"Reordered {count} {object_type}(s)"}
