"""
Translation Management Endpoints

Advanced translation operations:
- Translation
- Translation status/progress
- Language availability queries
- Bulk operations
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from uuid import UUID

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..models.translation_models import ObjectTranslation, ObjectVersion
from ..utils.object_type_aliases import normalize_object_type, externalize_object_type

LOREBOOK_TYPE = normalize_object_type('lorebook')


router = APIRouter()


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class TranslationStatus(BaseModel):
    """Translation status for an object"""
    object_id: str
    object_type: str
    available_languages: List[str]
    missing_languages: List[str]
    translation_coverage: float  # Percentage

    class Config:
        from_attributes = True


class TranslationData(BaseModel):
    """Single object translation data"""
    object_type: str
    object_id: str
    language: str
    data: Dict[str, Any]
    target_version_number: Optional[int] = None


class AddTranslationsRequest(BaseModel):
    """Request to add translations (single or batch)"""
    translations: List[TranslationData]
    user_request: str = "Translation"


class LanguageAvailabilityResponse(BaseModel):
    """Language availability across project"""
    language: str
    object_count: int
    total_objects: int
    coverage_percentage: float


# ============================================================================
# TRANSLATION STATUS ENDPOINTS
# ============================================================================

@router.get("/projects/{project_id}/translation-status")
async def get_project_translation_status(
    project_id: UUID,
    target_languages: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get translation status for all objects in a project.
    Shows which objects have translations in which languages.
    """
    # Get all object types for this project
    from ..models.db_models import (
        BasicInfo, Character, Organization, Location, LorebookEntry,
        Act, Chapter, Manuscript, Outline
    )

    object_types = {
        'basic_info': BasicInfo,
        'character': Character,
        'organization': Organization,
        'location': Location,
        LOREBOOK_TYPE: LorebookEntry,
        'act': Act,
        'chapter': Chapter,
        'manuscript': Manuscript,
    }

    status_list = []

    for object_type, model_class in object_types.items():
        # Get all objects of this type in the project
        query = db.query(model_class)

        # Filter by project_id (different field names for different types)
        if object_type == 'basic_info':
            query = query.filter(model_class.project_id == project_id)
        elif object_type in ['character', 'organization', 'location', LOREBOOK_TYPE]:
            query = query.filter(model_class.project_id == project_id)
        elif object_type == 'act':
            # Acts belong to outlines which belong to projects
            from ..models.db_models import Outline
            query = query.join(Outline).filter(Outline.project_id == project_id)
        elif object_type == 'chapter':
            # Chapters belong to acts which belong to outlines which belong to projects
            query = query.join(Act).join(Outline).filter(Outline.project_id == project_id)
        elif object_type == 'manuscript':
            # Manuscripts belong to chapters which belong to acts which belong to outlines
            query = query.join(Chapter).join(Act).join(Outline).filter(Outline.project_id == project_id)

        objects = query.all()

        for obj in objects:
            # Get available languages for this object
            translations = db.query(ObjectTranslation).filter(
                ObjectTranslation.object_type == object_type,
                ObjectTranslation.object_id == obj.id
            ).all()

            available_languages = [t.language for t in translations]

            # Determine missing languages
            if target_languages:
                missing_languages = [lang for lang in target_languages if lang not in available_languages]
                coverage = (len(available_languages) / len(target_languages)) * 100 if target_languages else 0
            else:
                missing_languages = []
                coverage = 100.0 if available_languages else 0.0

            status_list.append(TranslationStatus(
                object_id=str(obj.id),
                object_type=externalize_object_type(object_type),
                available_languages=available_languages,
                missing_languages=missing_languages,
                translation_coverage=coverage
            ))

    return {"translation_status": status_list}


@router.get("/projects/{project_id}/language-coverage")
async def get_language_coverage(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get language coverage statistics for a project.
    Shows how many objects have translations in each language.
    """
    # Get all object IDs in the project
    from ..models.db_models import (
        BasicInfo, Character, Organization, Location, LorebookEntry,
        Act, Chapter, Outline, Manuscript
    )

    object_ids = set()

    # Basic info
    basic_info = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).all()
    object_ids.update([(str(b.id), 'basic_info') for b in basic_info])

    # Characters
    characters = db.query(Character).filter(Character.project_id == project_id).all()
    object_ids.update([(str(c.id), 'character') for c in characters])

    # Organizations
    orgs = db.query(Organization).filter(Organization.project_id == project_id).all()
    object_ids.update([(str(o.id), 'organization') for o in orgs])

    # Locations
    locs = db.query(Location).filter(Location.project_id == project_id).all()
    object_ids.update([(str(l.id), 'location') for l in locs])

    # Lorebook entries
    entries = db.query(LorebookEntry).filter(LorebookEntry.project_id == project_id).all()
    object_ids.update([(str(e.id), LOREBOOK_TYPE) for e in entries])

    # Acts (through outline)
    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if outline:
        acts = db.query(Act).filter(Act.outline_id == outline.id).all()
        object_ids.update([(str(a.id), 'act') for a in acts])

        # Chapters (through acts)
        for act in acts:
            chapters = db.query(Chapter).filter(Chapter.act_id == act.id).all()
            object_ids.update([(str(c.id), 'chapter') for c in chapters])

            # Manuscripts (through chapters)
            for chapter in chapters:
                manuscript = db.query(Manuscript).filter(Manuscript.chapter_id == chapter.id).first()
                if manuscript:
                    object_ids.add((str(manuscript.id), 'manuscript'))

    total_objects = len(object_ids)

    # Count translations per language
    language_counts = {}

    for object_id, object_type in object_ids:
        translations = db.query(ObjectTranslation).filter(
            ObjectTranslation.object_type == object_type,
            ObjectTranslation.object_id == UUID(object_id)
        ).all()

        for translation in translations:
            if translation.language not in language_counts:
                language_counts[translation.language] = 0
            language_counts[translation.language] += 1

    # Build response
    coverage = [
        LanguageAvailabilityResponse(
            language=lang,
            object_count=count,
            total_objects=total_objects,
            coverage_percentage=(count / total_objects * 100) if total_objects > 0 else 0
        )
        for lang, count in language_counts.items()
    ]

    # Sort by coverage percentage descending
    coverage.sort(key=lambda x: x.coverage_percentage, reverse=True)

    return {
        "total_objects": total_objects,
        "language_coverage": coverage
    }


# ============================================================================
# BATCH OPERATIONS
# ============================================================================

@router.post("/batch/delete-translations")
async def batch_delete_translations(
    object_type: str,
    object_ids: List[str],
    language: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete translations for a specific language across multiple objects.
    WARNING: This cannot be undone!
    """
    object_type = normalize_object_type(object_type)
    deleted_count = 0

    for object_id_str in object_ids:
        try:
            object_id = UUID(object_id_str)

            # Delete translation
            deleted = db.query(ObjectTranslation).filter(
                ObjectTranslation.object_type == object_type,
                ObjectTranslation.object_id == object_id,
                ObjectTranslation.language == language
            ).delete()

            deleted_count += deleted

            # Also need to remove from latest version data
            latest_version = db.query(ObjectVersion).filter(
                ObjectVersion.object_type == object_type,
                ObjectVersion.object_id == object_id
            ).order_by(ObjectVersion.version_number.desc()).first()

            if latest_version:
                version_data = latest_version.data or {}
                if language in version_data:
                    version_data = dict(version_data)
                    del version_data[language]
                    latest_version.data = version_data

        except Exception as e:
            print(f"Error deleting translation for {object_id_str}: {e}")
            continue

    db.commit()

    return {
        "message": f"Deleted {deleted_count} translations",
        "deleted_count": deleted_count
    }


@router.post("/translations")
async def add_translations(
    request: AddTranslationsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Unified translation endpoint - handles single or batch translations.
    All translations are atomic - fails immediately if any translation fails.
    Returns updated objects for immediate frontend store update (matches PUT pattern).
    """
    from ..routes.unified_object_routes import (
        create_or_update_version,
        update_translation_cache,
        get_object_or_404,
        get_object
    )

    translated_count = 0
    translated_objects = []  # Track objects to return after commit

    try:
        for translation_data in request.translations:
            object_type = normalize_object_type(translation_data.object_type)
            object_id = UUID(translation_data.object_id)

            # Verify object exists
            get_object_or_404(db, object_type, object_id)

            # Create or update version with new language (in-place, don't create new version)
            # If target_version_number is provided, update that specific version instead of latest
            create_or_update_version(
                db=db,
                object_type=object_type,
                object_id=object_id,
                language=translation_data.language,
                new_data=translation_data.data,
                user_request=request.user_request,
                user_id=current_user.id,
                create_new=False,
                target_version_number=translation_data.target_version_number
            )

            # Update translation cache (don't set as active - keep current active language)
            update_translation_cache(
                db=db,
                object_type=object_type,
                object_id=object_id,
                language=translation_data.language,
                data=translation_data.data,
                is_active=False
            )

            # Track for returning after commit
            translated_objects.append((object_type, object_id))
            translated_count += 1

        # Single commit at the end (atomic operation)
        db.commit()

        # Fetch updated objects to return (matches PUT pattern for immediate store update)
        updated_objects = []
        for obj_type, obj_id in translated_objects:
            obj = await get_object(obj_type, obj_id, None, db, current_user)
            updated_objects.append(obj)

        return {
            "success": True,
            "translated_count": translated_count,
            "message": f"Successfully translated {translated_count} object{'s' if translated_count != 1 else ''}",
            "objects": updated_objects
        }

    except Exception as e:
        # Rollback on any error
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Translation failed: {str(e)}"
        )


@router.get("/objects/{object_type}/{object_id}/languages")
async def get_object_languages(
    object_type: str,
    object_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get list of available languages for a specific object.
    """
    object_type = normalize_object_type(object_type)

    translations = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id
    ).all()

    active_translation = next((t for t in translations if t.is_active), None)

    return {
        "object_id": str(object_id),
        "object_type": externalize_object_type(object_type),
        "languages": [
            {
                "language": t.language,
                "is_active": t.is_active,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None
            }
            for t in translations
        ],
        "active_language": active_translation.language if active_translation else None
    }


@router.delete("/objects/{object_type}/{object_id}/translations/{language}")
async def delete_translation(
    object_type: str,
    object_id: UUID,
    language: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a specific language translation for an object.
    WARNING: Cannot delete if it's the only language!
    """
    object_type = normalize_object_type(object_type)

    # Count existing translations
    translation_count = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id
    ).count()

    if translation_count <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the only translation. Object must have at least one language."
        )

    # Delete translation
    deleted = db.query(ObjectTranslation).filter(
        ObjectTranslation.object_type == object_type,
        ObjectTranslation.object_id == object_id,
        ObjectTranslation.language == language
    ).delete()

    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Translation not found for language: {language}")

    # Remove from latest version data
    latest_version = db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).order_by(ObjectVersion.version_number.desc()).first()

    if latest_version:
        version_data = latest_version.data or {}
        if language in version_data:
            version_data = dict(version_data)
            del version_data[language]
            latest_version.data = version_data

    db.commit()

    return {"message": f"Translation deleted for language: {language}"}
