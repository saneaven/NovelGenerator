"""
Unified CRUD Routes for New Translation System

All story objects use the same pattern:
- GET: Returns object with data in requested language from object_translations
- PUT: Updates object, creates new version, updates translation cache
- POST /translations: Adds new language translation
- PATCH /active-language: Switches displayed language without creating version
- GET /versions: Returns version history
- PATCH /versions/{version_id}/activate: Reverts to previous version
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from uuid import UUID, uuid4
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import (
    User, BasicInfo, Character, Organization, Location, LorebookEntry,
    Act, Chapter, Manuscript, Outline
)
from ..schemas.story_objects import ImagePromptUpdate
from ..models.translation_models import ObjectTranslation, ObjectVersion
from ..utils.object_type_aliases import normalize_object_type, externalize_object_type

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


class AddTranslationRequest(BaseModel):
    """Request to add a new language translation"""
    language: str
    data: Dict[str, Any]
    user_request: Optional[str] = "Translation"


class SwitchLanguageRequest(BaseModel):
    """Request to switch active language"""
    language: str


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
        'character': Character,
        'organization': Organization,
        'location': Location,
        LOREBOOK_TYPE: LorebookEntry,
        'act': Act,
        'chapter': Chapter,
        'manuscript': Manuscript,
    }

    if object_type not in type_map:
        raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")

    return type_map[object_type]


def get_object_or_404(db: Session, object_type: str, object_id: UUID) -> Any:
    """Get object by type and ID or raise 404"""
    object_type = normalize_object_type(object_type)
    model_class = get_object_model_class(object_type)
    obj = db.query(model_class).filter(model_class.id == object_id).first()

    if not obj:
        raise HTTPException(status_code=404, detail=f"{object_type} not found")

    return obj


def get_object_metadata(obj: Any, object_type: str) -> Dict[str, Any]:
    """Extract metadata from object"""
    metadata = {
        'id': str(obj.id),
        'created_at': obj.created_at.isoformat() if obj.created_at else None,
        'updated_at': obj.updated_at.isoformat() if obj.updated_at else None,
    }

    # Add parent ID based on object type
    if object_type == 'basic_info':
        metadata['project_id'] = str(obj.project_id)
    elif object_type in ['character', 'organization', 'location', LOREBOOK_TYPE]:
        metadata['project_id'] = str(obj.project_id)
        # Include image prompt fields for story objects that support them
        metadata['image_prompt'] = getattr(obj, 'image_prompt', None)
        metadata['image_prompt_positive'] = getattr(obj, 'image_prompt_positive', None)
        metadata['image_prompt_negative'] = getattr(obj, 'image_prompt_negative', None)
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


def get_available_languages(db: Session, object_type: str, object_id: UUID) -> Dict[str, Any]:
    """Get language information for an object"""
    translations = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id
    ).all()

    available = [t.language for t in translations]
    active_translation = next((t for t in translations if t.is_active), None)
    active_lang = active_translation.language if active_translation else (available[0] if available else None)

    return {
        'available': available,
        'active': active_lang,
        'default': available[0] if available else None  # First available is considered default
    }


def get_translation_data(db: Session, object_type: str, object_id: UUID, language: str) -> Optional[Dict[str, Any]]:
    """Get translation data for specific language"""
    translation = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id,
        ObjectTranslation.language == language
    ).first()

    return translation.data if translation else None


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


def update_translation_cache(
    db: Session,
    object_type: str,
    object_id: UUID,
    language: str,
    data: Dict[str, Any],
    is_active: bool = False
):
    """Update or create translation cache entry"""
    translation = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id,
        ObjectTranslation.language == language
    ).first()

    if translation:
        # Update existing
        translation.data = data
        translation.is_active = is_active
        translation.updated_at = datetime.utcnow()
    else:
        # Create new
        translation = ObjectTranslation(
            id=uuid4(),
            object_type=object_type,
            object_id=object_id,
            language=language,
            data=data,
            is_active=is_active,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(translation)


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
    obj = get_object_or_404(db, object_type, object_id)

    # Get metadata
    metadata = get_object_metadata(obj, object_type)

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
    Creates new version and updates translation cache.

    Edit Restriction: If creating a new version, the language being edited
    must exist in the latest version. Otherwise, return 400 error.
    """
    object_type = normalize_object_type(object_type)

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id)

    # Get the latest version
    latest_version = get_latest_version(db, object_type, object_id)

    # Edit restriction check: if creating new version, language must be in latest version
    if request.create_new_version and latest_version:
        version_data = latest_version.data or {}
        if request.language not in version_data:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot edit. Language '{request.language}' is not in the latest version (v{latest_version.version_number}). Translate first."
            )

    # Update object's updated_at timestamp
    obj.updated_at = datetime.utcnow()

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

    # Update translation cache for this language only
    update_translation_cache(
        db=db,
        object_type=object_type,
        object_id=object_id,
        language=request.language,
        data=request.data,
        is_active=True  # Mark as active when updated
    )

    # Deactivate other languages (but DO NOT delete them - they stay at their old versions)
    db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id,
        ObjectTranslation.language != request.language
    ).update({'is_active': False})

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
    obj = get_object_or_404(db, object_type, object_id)

    # Check if translation already exists
    existing = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id,
        ObjectTranslation.language == request.language
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail=f"Translation for {request.language} already exists")

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

    # Update translation cache (don't set as active - keep current active language)
    update_translation_cache(
        db=db,
        object_type=object_type,
        object_id=object_id,
        language=request.language,
        data=request.data,
        is_active=False
    )

    db.commit()

    return {"message": f"Translation added for {request.language}", "version_id": str(version.id)}


@router.patch("/objects/{object_type}/{object_id}/active-language")
async def switch_active_language(
    object_type: str,
    object_id: UUID,
    request: SwitchLanguageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Switch active language WITHOUT creating a new version.
    Just updates is_active flag in translation cache.
    """
    object_type = normalize_object_type(object_type)

    # Verify object exists
    obj = get_object_or_404(db, object_type, object_id)

    # Verify translation exists for requested language
    translation = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id,
        ObjectTranslation.language == request.language
    ).first()

    if not translation:
        raise HTTPException(status_code=404, detail=f"No translation found for language: {request.language}")

    # Deactivate all languages
    db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id
    ).update({'is_active': False})

    # Activate requested language
    translation.is_active = True
    translation.updated_at = datetime.utcnow()

    db.commit()

    return {"message": f"Active language switched to {request.language}"}


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
    obj = get_object_or_404(db, object_type, object_id)

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
    obj = get_object_or_404(db, object_type, object_id)

    # Verify version to restore exists
    version_to_restore = db.query(ObjectVersion).filter(
        ObjectVersion.id == version_id,
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).first()

    if not version_to_restore:
        raise HTTPException(status_code=404, detail="Version not found")

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

    # Rebuild translation cache from restored version data
    # First, delete all existing translations
    db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id
    ).delete()

    # Create translation entries for each language in the restored version
    restored_data = version_to_restore.data or {}
    if isinstance(restored_data, dict):
        first_language = None
        for language, language_data in restored_data.items():
            if not first_language:
                first_language = language

            update_translation_cache(
                db=db,
                object_type=object_type,
                object_id=object_id,
                language=language,
                data=language_data,
                is_active=(language == first_language)  # First language is active
            )

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

    # Get model class
    model_class = get_object_model_class(object_type)

    # Query core objects based on type
    query = db.query(model_class)

    # Filter by project_id or parent relationship
    if object_type in ['basic_info', 'character', 'organization', 'location', LOREBOOK_TYPE]:
        query = query.filter(model_class.project_id == project_id)
    elif object_type == 'act':
        # Need to join through outline
        outline = db.query(Outline).filter(Outline.project_id == project_id).first()
        if outline:
            query = query.filter(model_class.outline_id == outline.id)
        else:
            # No outline, return empty result set
            query = query.filter(model_class.id == None)
    elif object_type == 'chapter':
        # Need to get acts first, then chapters
        outline = db.query(Outline).filter(Outline.project_id == project_id).first()
        if outline:
            act_ids = [act.id for act in db.query(Act).filter(Act.outline_id == outline.id).all()]
            if act_ids:
                query = query.filter(model_class.act_id.in_(act_ids))
            else:
                query = query.filter(model_class.id == None)
        else:
            # No outline, return empty result set
            query = query.filter(model_class.id == None)
    elif object_type == 'manuscript':
        # Need to get chapters first
        outline = db.query(Outline).filter(Outline.project_id == project_id).first()
        if outline:
            acts = db.query(Act).filter(Act.outline_id == outline.id).all()
            act_ids = [act.id for act in acts]
            chapters = db.query(Chapter).filter(Chapter.act_id.in_(act_ids)).all()
            chapter_ids = [ch.id for ch in chapters]
            if chapter_ids:
                query = query.filter(model_class.chapter_id.in_(chapter_ids))
            else:
                query = query.filter(model_class.id == None)
        else:
            # No outline, return empty result set
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
            metadata = get_object_metadata(core_obj, object_type)

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

    # Get model class
    model_class = get_object_model_class(object_type)

    # Generate new object ID
    object_id = uuid4()

    # Create core object (structure only)
    # Different object types have different required fields
    metadata = request.metadata or {}

    if object_type in ['basic_info', 'character', 'organization', 'location', LOREBOOK_TYPE]:
        core_obj = model_class(
            id=object_id,
            project_id=project_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
    elif object_type == 'act':
        # Need outline_id and order
        outline = db.query(Outline).filter(Outline.project_id == project_id).first()
        if not outline:
            # Create outline on demand so first act creation succeeds
            outline = Outline(
                id=uuid4(),
                project_id=project_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(outline)
            db.flush()

        requested_order = metadata.get('order')
        if isinstance(requested_order, int):
            order_value = requested_order
        else:
            max_order = db.query(Act).filter(Act.outline_id == outline.id).count()
            order_value = max_order + 1

        core_obj = model_class(
            id=object_id,
            outline_id=outline.id,
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

    # Create translation cache
    translation = ObjectTranslation(
        id=uuid4(),
        object_type=object_type,
        object_id=object_id,
        language=request.language,
        data=request.data,
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(translation)

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
    obj = get_object_or_404(db, object_type, object_id)

    # Verify user has access (check project ownership)
    # Different object types have different parent relationships
    if object_type in ['basic_info', 'character', 'organization', 'location', LOREBOOK_TYPE]:
        from ..models.db_models import Project
        project = db.query(Project).filter(
            Project.id == obj.project_id,
            Project.user_id == current_user.id
        ).first()
        if not project:
            raise HTTPException(status_code=403, detail="Access denied")
    elif object_type == 'act':
        from ..models.db_models import Project
        outline = db.query(Outline).filter(Outline.id == obj.outline_id).first()
        if not outline:
            raise HTTPException(status_code=404, detail="Outline not found")
        project = db.query(Project).filter(
            Project.id == outline.project_id,
            Project.user_id == current_user.id
        ).first()
        if not project:
            raise HTTPException(status_code=403, detail="Access denied")
    # Add more cases for other types as needed

    # Delete all related data (order matters due to foreign keys)
    # 1. Delete translations
    db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id
    ).delete()

    # 2. Delete versions
    db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).delete()

    # 3. Delete core object
    db.delete(obj)

    db.commit()

    return {
        "success": True,
        "message": f"{object_type.replace('_', ' ').title()} deleted successfully"
    }


# ============================================================================
# MANUSCRIPT SPECIFIC ENDPOINT (for in-place updates during typing)
# ============================================================================

@router.patch("/objects/manuscript/{object_id}/content")
async def update_manuscript_inplace(
    object_id: UUID,
    request: UpdateObjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Special endpoint for manuscript in-place updates.
    Used during continuous typing in novel editor to avoid version spam.
    """
    return await update_object('manuscript', object_id, request, db, current_user)


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
    allowed_types = ['character', 'organization', 'location', LOREBOOK_TYPE]
    if object_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Image prompts not supported for {object_type}"
        )

    # Get object
    obj = get_object_or_404(db, object_type, object_id)

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
