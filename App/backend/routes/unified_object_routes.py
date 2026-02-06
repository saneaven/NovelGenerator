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
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from uuid import UUID, uuid4
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import (
    User, Project, BasicInfo, Guidelines, Character, Organization, Location, LorebookEntry,
    Act, Chapter, Manuscript, Outline, Asset, StoryObjectAsset
)
from ..schemas.story_objects import ImagePromptUpdate
from ..models.translation_models import ObjectVersion
from ..utils.object_type_aliases import normalize_object_type, externalize_object_type
from ..services.manuscript_image_index_service import rebuild_manuscript_images_for_language
from ..services.deletion_service import (
    collect_act_subtree_object_ids,
    collect_chapter_subtree_object_ids,
    collect_outline_subtree_object_ids,
    delete_assets_with_files,
    delete_object_versions_bulk,
    delete_rag_sources_bulk,
    delete_removed_manuscript_assets,
    delete_story_object_assets_with_files,
    get_manuscript_indexed_asset_ids,
)

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


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_object_model_class(object_type: str):
    """Get SQLAlchemy model class for object type"""
    object_type = normalize_object_type(object_type)
    type_map = {
        'basic_info': BasicInfo,
        'guidelines': Guidelines,
        'character': Character,
        'organization': Organization,
        'location': Location,
        LOREBOOK_TYPE: LorebookEntry,
        'outline': Outline,
        'act': Act,
        'chapter': Chapter,
        'manuscript': Manuscript,
    }

    if object_type not in type_map:
        raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")

    return type_map[object_type]


def require_project_owner(db: Session, *, user_id: UUID, project_id: UUID) -> Project:
    """Verify the user owns the project or raise 404."""
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_object_or_404(db: Session, object_type: str, object_id: UUID, *, user_id: UUID) -> Any:
    """Get object by type and ID for user or raise 404."""
    object_type = normalize_object_type(object_type)
    model_class = get_object_model_class(object_type)

    query = db.query(model_class)

    # Enforce ownership via Project.user_id.
    if object_type in {"basic_info", "guidelines", "character", "organization", "location", LOREBOOK_TYPE, "outline"}:
        query = query.join(Project, Project.id == model_class.project_id).filter(Project.user_id == user_id)
    elif object_type == "act":
        query = (
            query.join(Outline, model_class.outline_id == Outline.id)
            .join(Project, Project.id == Outline.project_id)
            .filter(Project.user_id == user_id)
        )
    elif object_type == "chapter":
        query = (
            query.join(Act, model_class.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .join(Project, Outline.project_id == Project.id)
            .filter(Project.user_id == user_id)
        )
    elif object_type == "manuscript":
        query = (
            query.join(Chapter, model_class.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .join(Project, Outline.project_id == Project.id)
            .filter(Project.user_id == user_id)
        )

    obj = query.filter(model_class.id == object_id).first()

    if not obj:
        raise HTTPException(status_code=404, detail=f"{object_type} not found")

    return obj


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

        outline = getattr(act, 'outline', None)
        if not outline:
            raise HTTPException(status_code=500, detail='Chapter act is missing outline relation')

        metadata['project_id'] = str(outline.project_id)
        metadata['act_id'] = str(obj.act_id)
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


def get_version_by_number(db: Session, object_type: str, object_id: UUID, version_number: int) -> Optional[ObjectVersion]:
    """Get a specific version by version number"""
    return db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id,
        ObjectVersion.version_number == version_number
    ).first()


def get_latest_version_info(db: Session, object_type: str, object_id: UUID) -> Optional[Dict[str, Any]]:
    """Get latest version information (replaces get_latest_version_info)"""
    version = get_latest_version(db, object_type, object_id)

    if not version:
        return None

    return {
        'id': str(version.id),
        'number': version.version_number,
        'created_at': version.created_at.isoformat() if version.created_at else None
    }


def create_or_update_version(
    db: Session,
    object_type: str,
    object_id: UUID,
    language: str,
    new_data: Dict[str, Any],
    user_request: str,
    user_id: UUID,
    create_new: bool = True,
    target_version_number: Optional[int] = None
) -> ObjectVersion:
    """Create new version or update existing one.

    Behavior:
    - Latest version is always determined by MAX(version_number)
    - When create_new=True: creates a new version with only the edited language (translations become stale)
    - When create_new=False: updates existing latest version in-place, preserving other languages (for translations)
    - When target_version_number is provided: updates that specific version instead of latest (for translations)
    """

    # Get current latest version
    current_version = get_latest_version(db, object_type, object_id)

    # If target_version_number is specified, get that specific version instead
    target_version = None
    if target_version_number is not None and not create_new:
        target_version = get_version_by_number(db, object_type, object_id, target_version_number)
        if not target_version:
            raise HTTPException(
                status_code=404,
                detail=f"Version {target_version_number} not found for {object_type}/{object_id}"
            )

    # Determine which version to update
    version_to_update = target_version if target_version else current_version

    # Carry forward existing languages only when updating existing version (not creating new)
    # This ensures translations preserve the original language while user edits start fresh
    carry_forward_languages = (
        version_to_update is not None
        and version_to_update.data
        and not create_new
    )

    # Merge language data
    version_data = dict(version_to_update.data) if carry_forward_languages and version_to_update else {}
    version_data[language] = new_data

    if create_new or not current_version:
        # Create new version
        next_version_number = 1
        if current_version:
            next_version_number = current_version.version_number + 1

        new_version = ObjectVersion(
            id=uuid4(),
            object_type=object_type,
            object_id=object_id,
            version_number=next_version_number,
            data=version_data,
            user_request=user_request,
            created_by=user_id,
            created_at=datetime.utcnow()
        )
        db.add(new_version)
        db.flush()

        return new_version
    else:
        # Update existing version in-place (for translations or novel editor continuous typing)
        version_to_update.data = version_data
        db.flush()
        return version_to_update


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

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Get metadata
    metadata = get_object_metadata(obj, object_type, db)

    # Get latest version (contains all languages)
    latest_version = get_latest_version(db, object_type, object_id)
    if not latest_version:
        raise HTTPException(status_code=500, detail="No version found for this object")

    version_data = latest_version.data or {}

    if not version_data:
        raise HTTPException(status_code=404, detail="No translations available for this object")

    # Determine response data based on language parameter
    if language:
        # Single language mode: return only requested language
        if language not in version_data:
            raise HTTPException(status_code=404, detail=f"Translation not found for language: {language}")
        response_data = {language: version_data[language]}
    else:
        # Default mode: return ALL languages
        response_data = version_data

    # Get version info
    version_info = {
        'id': str(latest_version.id),
        'number': latest_version.version_number,
        'created_at': latest_version.created_at.isoformat() if latest_version.created_at else None
    }

    return UnifiedObjectResponse(
        id=str(object_id),
        type=externalize_object_type(object_type),
        metadata=metadata,
        data=response_data,
        version=version_info
    )


def handle_metadata_update(
    db: Session,
    object_type: str,
    object_id: UUID,
    obj: Any,
    metadata: Dict[str, Any]
) -> None:
    """
    Handle metadata updates for structural fields like order.
    Automatically reorders siblings when order changes.
    """
    if object_type == 'chapter' and ('order' in metadata or 'act_id' in metadata):
        requested_order = metadata.get('order')
        if requested_order is not None and (not isinstance(requested_order, int) or requested_order < 1):
            raise HTTPException(status_code=400, detail="Invalid order value: must be positive integer")

        current_act_id = obj.act_id
        target_act_id = current_act_id

        # Validate and resolve target act (if provided)
        if 'act_id' in metadata:
            act_id_value = metadata.get('act_id')
            if not act_id_value:
                raise HTTPException(status_code=400, detail="Invalid act_id value")

            try:
                target_act_uuid = UUID(str(act_id_value))
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail="Invalid act_id format")

            if target_act_uuid != current_act_id:
                act = getattr(obj, 'act', None)
                if not act:
                    raise HTTPException(status_code=500, detail='Chapter is missing act relation')

                outline = getattr(act, 'outline', None)
                if not outline:
                    raise HTTPException(status_code=500, detail='Chapter act is missing outline relation')

                # Ensure the target act belongs to the same project as the chapter's current outline
                target_act = db.query(Act).join(Outline).filter(
                    Act.id == target_act_uuid,
                    Outline.id == Act.outline_id,
                    Outline.project_id == outline.project_id
                ).first()

                if not target_act:
                    raise HTTPException(status_code=404, detail="Act not found for project")

                target_act_id = target_act_uuid

        # If only act_id was provided but it resolves to the same act, no structural change required
        if requested_order is None and target_act_id == current_act_id:
            return

        if target_act_id != current_act_id:
            # Move chapter to another act (optionally with new order)

            # Reindex remaining chapters in the old act (exclude current) to close any gap
            old_siblings = db.query(Chapter).filter(
                Chapter.act_id == current_act_id,
                Chapter.id != object_id
            ).order_by(Chapter.order).all()
            for i, ch in enumerate(old_siblings, start=1):
                ch.order = i

            # Reindex chapters in the target act before insertion
            target_siblings = db.query(Chapter).filter(
                Chapter.act_id == target_act_id
            ).order_by(Chapter.order).all()
            for i, ch in enumerate(target_siblings, start=1):
                ch.order = i

            max_order = len(target_siblings) + 1
            new_order = requested_order if requested_order is not None else max_order
            new_order = min(new_order, max_order)
            new_order = max(new_order, 1)

            # Shift target siblings to make room for insertion
            for ch in target_siblings:
                if ch.order >= new_order:
                    ch.order += 1

            obj.act_id = target_act_id
            obj.order = new_order
            db.flush()

        else:
            # Reorder chapter within the same act
            new_order = requested_order
            if new_order is None:
                return

            siblings = db.query(Chapter).filter(
                Chapter.act_id == current_act_id,
                Chapter.id != object_id
            ).order_by(Chapter.order).all()

            # Normalize siblings to a contiguous 1-based order
            for i, ch in enumerate(siblings, start=1):
                ch.order = i

            max_order = len(siblings) + 1
            new_order = min(new_order, max_order)
            new_order = max(new_order, 1)

            # Shift siblings to make room for insertion
            for ch in siblings:
                if ch.order >= new_order:
                    ch.order += 1

            obj.order = new_order
            db.flush()

    elif object_type == 'act' and 'order' in metadata:
        new_order = metadata['order']
        if not isinstance(new_order, int) or new_order < 1:
            raise HTTPException(status_code=400, detail="Invalid order value: must be positive integer")

        current_order = obj.order
        outline_id = obj.outline_id

        if new_order != current_order:
            # Get all sibling acts in the same outline (excluding current)
            siblings = db.query(Act).filter(
                Act.outline_id == outline_id,
                Act.id != object_id
            ).order_by(Act.order).all()

            max_order = len(siblings) + 1
            new_order = min(new_order, max_order)
            new_order = max(new_order, 1)

            if new_order < current_order:
                for act in siblings:
                    if new_order <= act.order < current_order:
                        act.order += 1
            else:
                for act in siblings:
                    if current_order < act.order <= new_order:
                        act.order -= 1

            obj.order = new_order
            db.flush()


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
    Creates new version (or updates latest when create_new_version=false).

    Notes:
    - When create_new_version=true: a new version is created for the requested language,
      even if that language does not exist in the latest version. The new version contains
      only the edited language (other languages become stale until re-translated).
    - When create_new_version=false: updates the latest version in-place and preserves
      other languages (used by translation flows and continuous editing).
    """
    object_type = normalize_object_type(object_type)

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Manuscript data validation (doc-only)
    if object_type == "manuscript":
        doc = request.data.get("doc")
        if not isinstance(doc, dict):
            raise HTTPException(status_code=422, detail="Manuscript updates require data.doc (TipTap JSON)")
        if "content" in request.data:
            raise HTTPException(status_code=422, detail="Manuscript updates do not accept data.content (use data.doc)")

    # Get the latest version
    latest_version = get_latest_version(db, object_type, object_id)

    # Update object's updated_at timestamp
    obj.updated_at = datetime.utcnow()

    # Handle metadata updates (structural changes like order)
    if request.metadata:
        handle_metadata_update(db, object_type, object_id, obj, request.metadata)

    # Create or update version
    # - create_new=True: New version with only edited language (translations become stale)
    # - create_new=False: Update existing version, preserving other languages (for translations)
    version = create_or_update_version(
        db=db,
        object_type=object_type,
        object_id=object_id,
        language=request.language,
        new_data=request.data,
        user_request=request.user_request or "User Edit",
        user_id=current_user.id,
        create_new=request.create_new_version
    )

    # Rebuild manuscript image index (manual save only)
    # Policy: when an image is removed from the manuscript, delete the underlying manuscript-owned asset too.
    if object_type == "manuscript" and request.create_new_version:
        doc = request.data.get("doc")
        if isinstance(doc, dict):
            chapter = getattr(obj, "chapter", None)
            act = getattr(chapter, "act", None) if chapter else None
            outline = getattr(act, "outline", None) if act else None
            project_id = getattr(outline, "project_id", None) if outline else None
            if project_id:
                before_asset_ids = get_manuscript_indexed_asset_ids(db, manuscript_id=object_id)

                rebuild_manuscript_images_for_language(
                    db=db,
                    project_id=project_id,
                    manuscript_id=object_id,
                    language=request.language,
                    doc=doc,
                )

                after_asset_ids = get_manuscript_indexed_asset_ids(db, manuscript_id=object_id)
                removed_asset_ids = before_asset_ids - after_asset_ids
                delete_removed_manuscript_assets(
                    db,
                    project_id=project_id,
                    manuscript_id=object_id,
                    removed_asset_ids=removed_asset_ids,
                )

    db.commit()

    # Return updated object with ALL languages (not just the edited one)
    # Frontend replaces the entire object, so we need to return all languages
    return await get_object(object_type, object_id, None, db, current_user)


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

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Check if translation already exists in the latest version
    latest_version = get_latest_version(db, object_type, object_id)
    if not latest_version:
        raise HTTPException(status_code=500, detail="No version found for this object")

    version_data = latest_version.data or {}
    if request.language in version_data:
        raise HTTPException(status_code=400, detail=f"Translation for {request.language} already exists in latest version")

    # Create or update version with new language
    version = create_or_update_version(
        db=db,
        object_type=object_type,
        object_id=object_id,
        language=request.language,
        new_data=request.data,
        user_request=request.user_request or "Translation",
        user_id=current_user.id,
        create_new=False
    )

    db.commit()

    return {"message": f"Translation added for {request.language}", "version_id": str(version.id)}


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

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Get all versions
    versions = db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).order_by(ObjectVersion.version_number.desc()).all()

    return [
        VersionResponse(
            id=str(v.id),
            number=v.version_number,
            data=v.data,
            user_request=v.user_request,
            created_at=v.created_at.isoformat() if v.created_at else None
        )
        for v in versions
    ]


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

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Verify version to restore exists
    version_to_restore = db.query(ObjectVersion).filter(
        ObjectVersion.id == version_id,
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).first()

    if not version_to_restore:
        raise HTTPException(status_code=404, detail="Version not found")

    # Manuscripts are doc-only (TipTap JSON)
    if object_type == "manuscript":
        restored_data_check = version_to_restore.data or {}
        if not isinstance(restored_data_check, dict):
            raise HTTPException(status_code=400, detail="Invalid manuscript version data")
        for _lang, lang_data in restored_data_check.items():
            if not isinstance(lang_data, dict) or not isinstance(lang_data.get("doc"), dict):
                raise HTTPException(status_code=400, detail="Cannot restore manuscript version (missing doc)")

    # Get current latest version to determine next version number
    latest_version = get_latest_version(db, object_type, object_id)
    next_version_number = (latest_version.version_number + 1) if latest_version else 1

    # Create a NEW version with the restored content
    new_version = ObjectVersion(
        id=uuid4(),
        object_type=object_type,
        object_id=object_id,
        version_number=next_version_number,
        data=version_to_restore.data,  # Copy the data from the version to restore
        user_request=f"Restored from v{version_to_restore.version_number}",
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_version)
    db.flush()

    db.commit()

    return {
        "message": f"Restored v{version_to_restore.version_number} as new v{next_version_number}",
        "version_id": str(new_version.id)
    }


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
    response_type = externalize_object_type(object_type)

    # Verify project access.
    require_project_owner(db, user_id=current_user.id, project_id=project_id)

    # Get model class
    model_class = get_object_model_class(object_type)

    # Query core objects based on type
    query = db.query(model_class)

    # Filter by project_id or parent relationship
    if object_type in ['basic_info', 'guidelines', 'character', 'organization', 'location', LOREBOOK_TYPE]:
        query = query.filter(model_class.project_id == project_id)
    elif object_type == 'outline':
        query = query.filter(model_class.project_id == project_id)
    elif object_type == 'act':
        # Get all outlines for the project
        outline_ids = [o.id for o in db.query(Outline).filter(Outline.project_id == project_id).all()]
        if outline_ids:
            query = query.filter(model_class.outline_id.in_(outline_ids))
        else:
            # No outlines, return empty result set
            query = query.filter(model_class.id == None)
    elif object_type == 'chapter':
        # Get all acts from all outlines in the project
        outline_ids = [o.id for o in db.query(Outline).filter(Outline.project_id == project_id).all()]
        if outline_ids:
            act_ids = [act.id for act in db.query(Act).filter(Act.outline_id.in_(outline_ids)).all()]
            if act_ids:
                query = query.filter(model_class.act_id.in_(act_ids))
            else:
                query = query.filter(model_class.id == None)
        else:
            # No outlines, return empty result set
            query = query.filter(model_class.id == None)
    elif object_type == 'manuscript':
        # Get all chapters from all acts from all outlines in the project
        outline_ids = [o.id for o in db.query(Outline).filter(Outline.project_id == project_id).all()]
        if outline_ids:
            act_ids = [act.id for act in db.query(Act).filter(Act.outline_id.in_(outline_ids)).all()]
            if act_ids:
                chapter_ids = [ch.id for ch in db.query(Chapter).filter(Chapter.act_id.in_(act_ids)).all()]
                if chapter_ids:
                    query = query.filter(model_class.chapter_id.in_(chapter_ids))
                else:
                    query = query.filter(model_class.id == None)
            else:
                query = query.filter(model_class.id == None)
        else:
            # No outlines, return empty result set
            query = query.filter(model_class.id == None)

    # Get all core objects
    core_objects = query.all()

    # Build unified object responses
    result_objects = []
    for core_obj in core_objects:
        try:
            # Get latest version (contains all languages)
            latest_version = get_latest_version(db, object_type, core_obj.id)

            if not latest_version:
                continue  # Skip if no version

            version_data = latest_version.data or {}

            if not version_data:
                continue  # Skip objects with no language data

            # Determine response data based on language parameter
            if language:
                # Single language mode: return only requested language
                if language not in version_data:
                    continue  # Skip if requested language not available
                response_data = {language: version_data[language]}
            else:
                # Default mode: return ALL languages
                response_data = version_data

            # Get metadata
            metadata = get_object_metadata(core_obj, object_type, db)

            # Get version info
            version_info = {
                'id': str(latest_version.id),
                'number': latest_version.version_number,
                'created_at': latest_version.created_at.isoformat() if latest_version.created_at else None
            }

            # Build unified object
            unified_obj = UnifiedObjectResponse(
                id=str(core_obj.id),
                type=response_type,
                metadata=metadata,
                data=response_data,
                version=version_info
            )

            result_objects.append(unified_obj)
        except Exception as e:
            # Skip objects with errors, log for debugging
            print(f"Error processing object {core_obj.id}: {e}")
            continue

    # Calculate pagination
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
    Creates core object, initial version, translation cache, and active version pointer.
    """
    object_type = normalize_object_type(object_type)

    # Verify project access.
    require_project_owner(db, user_id=current_user.id, project_id=project_id)

    # Manuscript data validation (doc-only)
    if object_type == "manuscript":
        doc = request.data.get("doc")
        if not isinstance(doc, dict):
            raise HTTPException(status_code=422, detail="Manuscript translations require data.doc (TipTap JSON)")
        if "content" in request.data:
            raise HTTPException(status_code=422, detail="Manuscript translations do not accept data.content (use data.doc)")

    # Block basic_info and guidelines creation - they are auto-created with the project
    if object_type == 'basic_info':
        raise HTTPException(
            status_code=400,
            detail="BasicInfo is automatically created when a project is created. Use update endpoint instead."
        )
    if object_type == 'guidelines':
        raise HTTPException(
            status_code=400,
            detail="Guidelines is automatically created when a project is created. Use update endpoint instead."
        )

    # Manuscript data validation (doc-only)
    if object_type == "manuscript":
        doc = request.data.get("doc")
        if not isinstance(doc, dict):
            raise HTTPException(status_code=422, detail="Manuscript creation requires data.doc (TipTap JSON)")
        if "content" in request.data:
            raise HTTPException(status_code=422, detail="Manuscript creation does not accept data.content (use data.doc)")

    # Get model class
    model_class = get_object_model_class(object_type)

    # Generate new object ID
    object_id = uuid4()

    # Create core object (structure only)
    # Different object types have different required fields
    metadata = request.metadata or {}

    if object_type == 'basic_info':
        core_obj = model_class(
            id=object_id,
            project_id=project_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    elif object_type in ['character', 'organization', 'location', LOREBOOK_TYPE]:
        # Calculate next order value for story objects
        max_order = db.query(func.max(model_class.order)).filter(
            model_class.project_id == project_id
        ).scalar() or 0

        core_obj = model_class(
            id=object_id,
            project_id=project_id,
            order=max_order + 1,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    elif object_type == 'outline':
        # Calculate next order value for outlines
        max_order = db.query(func.max(model_class.order)).filter(
            model_class.project_id == project_id
        ).scalar()
        if max_order is None:
            max_order = -1  # So first outline gets order 0

        core_obj = model_class(
            id=object_id,
            project_id=project_id,
            order=max_order + 1,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    elif object_type == 'act':
        # Need outline_id from metadata
        outline_id_value = metadata.get('outline_id')
        if not outline_id_value:
            raise HTTPException(status_code=400, detail="outline_id is required for act creation")

        try:
            outline_uuid = UUID(str(outline_id_value))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid outline_id format")

        # Verify outline belongs to project
        outline = db.query(Outline).filter(
            Outline.id == outline_uuid,
            Outline.project_id == project_id
        ).first()
        if not outline:
            raise HTTPException(status_code=404, detail="Outline not found for project")

        requested_order = metadata.get('order')
        if isinstance(requested_order, int):
            order_value = requested_order
        else:
            max_order = db.query(Act).filter(Act.outline_id == outline_uuid).count()
            order_value = max_order

        core_obj = model_class(
            id=object_id,
            outline_id=outline_uuid,
            order=order_value,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    elif object_type == 'chapter':
        # Need act_id and order - must be provided in metadata
        act_id_value = metadata.get('act_id')
        if not act_id_value:
            raise HTTPException(status_code=400, detail="Chapter creation requires act_id in request")

        try:
            act_uuid = UUID(str(act_id_value))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid act_id format")

        act = db.query(Act).join(Outline).filter(
            Act.id == act_uuid,
            Outline.id == Act.outline_id,
            Outline.project_id == project_id
        ).first()

        if not act:
            raise HTTPException(status_code=404, detail="Act not found for project")

        requested_order = metadata.get('order')
        if isinstance(requested_order, int):
            chapter_order = requested_order
        else:
            chapter_count = db.query(Chapter).filter(Chapter.act_id == act_uuid).count()
            chapter_order = chapter_count + 1

        core_obj = model_class(
            id=object_id,
            act_id=act_uuid,
            order=chapter_order,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    elif object_type == 'manuscript':
        # Need chapter_id - must be provided in metadata
        chapter_id_value = metadata.get('chapter_id')
        if not chapter_id_value:
            raise HTTPException(status_code=400, detail="Manuscript creation requires chapter_id in request")

        try:
            chapter_uuid = UUID(str(chapter_id_value))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid chapter_id format")

        chapter = db.query(Chapter).join(Act).join(Outline).filter(
            Chapter.id == chapter_uuid,
            Chapter.act_id == Act.id,
            Act.outline_id == Outline.id,
            Outline.project_id == project_id
        ).first()

        if not chapter:
            raise HTTPException(status_code=404, detail="Chapter not found for project")

        existing_manuscript = db.query(Manuscript).filter(
            Manuscript.chapter_id == chapter_uuid
        ).first()

        if existing_manuscript:
            raise HTTPException(status_code=400, detail="Manuscript already exists for this chapter")

        core_obj = model_class(
            id=object_id,
            chapter_id=chapter_uuid,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    else:
        raise HTTPException(status_code=400, detail=f"Creation not supported for {object_type}")

    db.add(core_obj)
    db.flush()

    # Create initial version (no ActiveVersion pointer needed - latest is always active)
    version_id = uuid4()
    version = ObjectVersion(
        id=version_id,
        object_type=object_type,
        object_id=object_id,
        version_number=1,
        data={request.language: request.data},
        user_request=request.user_request or 'Initial Creation',
        created_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(version)

    db.commit()
    db.refresh(core_obj)

    # Return unified object response
    return await get_object(object_type, object_id, request.language, db, current_user)


@router.delete("/objects/{object_type}/{object_id}")
async def delete_object(
    object_type: str,
    object_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete an object and all its translations/versions.
    Cascades to all related translation and version data.
    """
    object_type = normalize_object_type(object_type)

    # Get core object
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Resolve project_id for cleanup (assets/files, RAG, object_versions).
    project_id: Optional[UUID] = None
    if hasattr(obj, "project_id"):
        project_id = getattr(obj, "project_id", None)
    elif object_type == "act":
        project_id = db.query(Outline.project_id).filter(Outline.id == obj.outline_id).scalar()
    elif object_type == "chapter":
        project_id = (
            db.query(Outline.project_id)
            .join(Act, Act.outline_id == Outline.id)
            .join(Chapter, Chapter.act_id == Act.id)
            .filter(Chapter.id == object_id)
            .scalar()
        )
    elif object_type == "manuscript":
        project_id = (
            db.query(Outline.project_id)
            .join(Act, Act.outline_id == Outline.id)
            .join(Chapter, Chapter.act_id == Act.id)
            .join(Manuscript, Manuscript.chapter_id == Chapter.id)
            .filter(Manuscript.id == object_id)
            .scalar()
        )

    if not isinstance(project_id, UUID):
        raise HTTPException(status_code=500, detail="Could not resolve project_id for deletion")

    # Build deletion scope (root + descendants) for non-FK tables.
    ids_by_type: Dict[str, List[UUID]] = {object_type: [object_id]}

    if object_type == "outline":
        subtree = collect_outline_subtree_object_ids(db, outline_id=object_id)
        for t, ids in subtree.items():
            ids_by_type.setdefault(t, []).extend(ids)
    elif object_type == "act":
        subtree = collect_act_subtree_object_ids(db, act_id=object_id)
        for t, ids in subtree.items():
            ids_by_type.setdefault(t, []).extend(ids)
    elif object_type == "chapter":
        subtree = collect_chapter_subtree_object_ids(db, chapter_id=object_id)
        for t, ids in subtree.items():
            ids_by_type.setdefault(t, []).extend(ids)

    # Delete assets/files deterministically before core cascade deletes.
    if object_type in {"basic_info", "character", "organization", "location", LOREBOOK_TYPE}:
        delete_story_object_assets_with_files(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
        )
    elif object_type == "manuscript":
        owned_assets = db.query(Asset).filter(Asset.project_id == project_id, Asset.manuscript_id == object_id).all()
        delete_assets_with_files(db, assets=owned_assets, scrub_references_in_project_id=project_id)
    elif object_type in {"outline", "act", "chapter"}:
        manuscript_ids = ids_by_type.get("manuscript") or []
        if manuscript_ids:
            owned_assets = (
                db.query(Asset)
                .filter(Asset.project_id == project_id, Asset.manuscript_id.in_(list(manuscript_ids)))
                .all()
            )
            delete_assets_with_files(db, assets=owned_assets, scrub_references_in_project_id=project_id)

    # Delete derived/stale data that does not have FKs.
    delete_rag_sources_bulk(db, user_id=current_user.id, project_id=project_id, ids_by_type=ids_by_type)
    delete_object_versions_bulk(db, ids_by_type=ids_by_type)

    # Delete core object (DB cascades handle child core rows).
    db.delete(obj)
    db.commit()

    return {"success": True, "message": f"{object_type.replace('_', ' ').title()} deleted successfully"}


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

    # Only allow for story objects that support images
    allowed_types = ['basic_info', 'character', 'organization', 'location', LOREBOOK_TYPE]
    if object_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Image prompts not supported for {object_type}"
        )

    # Get object
    obj = get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    # Update image prompt fields (empty string clears the field)
    if request.image_prompt is not None:
        obj.image_prompt = request.image_prompt if request.image_prompt else None
    if request.image_prompt_positive is not None:
        obj.image_prompt_positive = request.image_prompt_positive if request.image_prompt_positive else None
    if request.image_prompt_negative is not None:
        obj.image_prompt_negative = request.image_prompt_negative if request.image_prompt_negative else None

    obj.updated_at = datetime.utcnow()
    db.commit()

    return {
        "success": True,
        "image_prompt": obj.image_prompt,
        "image_prompt_positive": obj.image_prompt_positive,
        "image_prompt_negative": obj.image_prompt_negative
    }


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

    # Only allow reordering for story object types and outlines
    allowed_types = ['character', 'organization', 'location', LOREBOOK_TYPE, 'outline']
    if object_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Reordering not supported for {object_type}"
        )

    model_class = get_object_model_class(object_type)

    # Verify project access
    from ..models.db_models import Project
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate and update each object's order
    for i, obj_id_str in enumerate(request.object_ids):
        try:
            obj_uuid = UUID(obj_id_str)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid UUID: {obj_id_str}")

        obj = db.query(model_class).filter(
            model_class.id == obj_uuid,
            model_class.project_id == project_id
        ).first()

        if not obj:
            raise HTTPException(
                status_code=404,
                detail=f"Object {obj_id_str} not found in project"
            )

        # Update order (1-indexed)
        obj.order = i + 1
        obj.updated_at = datetime.utcnow()

    db.commit()

    return {
        "success": True,
        "message": f"Reordered {len(request.object_ids)} {object_type}(s)"
    }


