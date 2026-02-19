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
from ..models.db_models import User, Project
from ..models.translation_models import ObjectVersion
from ..services.object_change_events import queue_object_change
from ..services.object_service import object_service
from ..utils.object_type_aliases import normalize_object_type, externalize_object_type
from .unified_object_routes import get_object_or_404, resolve_project_id_for_object

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
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all object types for this project
    from ..models.db_models import (
        BasicInfo, Guidelines, Character, Organization, Location, LorebookEntry,
        Act, Chapter, Manuscript, Outline
    )

    object_types = {
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

    status_list = []

    for object_type, model_class in object_types.items():
        # Get all objects of this type in the project
        query = db.query(model_class)

        # Filter by project_id (different field names for different types)
        if object_type in ['basic_info', 'guidelines', 'character', 'organization', 'location', LOREBOOK_TYPE, 'outline']:
            query = query.filter(model_class.project_id == project_id)
        elif object_type == 'act':
            # Acts belong to outlines which belong to projects
            query = query.join(Outline).filter(Outline.project_id == project_id)
        elif object_type == 'chapter':
            # Chapters belong to acts which belong to outlines which belong to projects
            query = query.join(Act).join(Outline).filter(Outline.project_id == project_id)
        elif object_type == 'manuscript':
            # Manuscripts belong to chapters which belong to acts which belong to outlines
            query = query.join(Chapter).join(Act).join(Outline).filter(Outline.project_id == project_id)

        objects = query.all()

        for obj in objects:
            latest_version = db.query(ObjectVersion).filter(
                ObjectVersion.object_type == object_type,
                ObjectVersion.object_id == obj.id
            ).order_by(ObjectVersion.version_number.desc()).first()

            version_data = latest_version.data if latest_version else {}
            available_languages = list(version_data.keys()) if isinstance(version_data, dict) else []

            # Determine missing languages / coverage (only against requested targets)
            if target_languages:
                missing_languages = [lang for lang in target_languages if lang not in available_languages]
                present_count = sum(1 for lang in target_languages if lang in available_languages)
                coverage = (present_count / len(target_languages)) * 100 if target_languages else 0
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
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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

    # Count available languages per object (based on latest ObjectVersion only)
    language_counts: Dict[str, int] = {}

    for object_id, object_type in object_ids:
        latest_version = db.query(ObjectVersion).filter(
            ObjectVersion.object_type == object_type,
            ObjectVersion.object_id == UUID(object_id)
        ).order_by(ObjectVersion.version_number.desc()).first()

        version_data = latest_version.data if latest_version else {}
        if not isinstance(version_data, dict):
            continue

        for lang in version_data.keys():
            language_counts[lang] = language_counts.get(lang, 0) + 1

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

            # Verify object exists and belongs to the current user.
            get_object_or_404(db, object_type, object_id, user_id=current_user.id)

            # Remove from latest version data only
            latest_version = db.query(ObjectVersion).filter(
                ObjectVersion.object_type == object_type,
                ObjectVersion.object_id == object_id
            ).order_by(ObjectVersion.version_number.desc()).first()

            if not latest_version:
                continue

            version_data = latest_version.data or {}
            if not isinstance(version_data, dict) or language not in version_data:
                continue

            next_data = dict(version_data)
            del next_data[language]
            latest_version.data = next_data
            project_id = resolve_project_id_for_object(
                db,
                object_type=object_type,
                object_id=object_id,
                user_id=current_user.id,
            )
            queue_object_change(
                db,
                project_id=project_id,
                object_type=object_type,
                object_id=object_id,
                action="updated",
            )
            deleted_count += 1

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
    translated_count = 0
    translated_objects: list[tuple[str, UUID, UUID]] = []
    seen_targets: set[tuple[str, UUID, UUID]] = set()

    try:
        for translation_data in request.translations:
            if translation_data.target_version_number is not None:
                raise HTTPException(
                    status_code=422,
                    detail="target_version_number is not supported for this endpoint",
                )

            object_type = normalize_object_type(translation_data.object_type)
            object_id = UUID(translation_data.object_id)
            project_id = resolve_project_id_for_object(
                db,
                object_type=object_type,
                object_id=object_id,
                user_id=current_user.id,
            )

            object_service.add_translation(
                db,
                project_id=project_id,
                object_type=object_type,
                object_id=object_id,
                language=translation_data.language,
                data=translation_data.data,
                user_request=request.user_request,
                created_by=current_user.id,
            )

            key = (object_type, object_id, project_id)
            if key not in seen_targets:
                seen_targets.add(key)
                translated_objects.append(key)
            translated_count += 1

        db.commit()

        updated_objects = []
        for obj_type, obj_id, project_id in translated_objects:
            obj = object_service.get_object(
                db,
                object_type=obj_type,
                object_id=obj_id,
                project_id=project_id,
                language=None,
            )
            if obj is not None:
                updated_objects.append(obj)

        return {
            "success": True,
            "translated_count": translated_count,
            "message": f"Successfully translated {translated_count} object{'s' if translated_count != 1 else ''}",
            "objects": updated_objects
        }

    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:
        db.rollback()
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    except Exception as e:
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
    get_object_or_404(db, object_type, object_id, user_id=current_user.id)

    latest_version = db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).order_by(ObjectVersion.version_number.desc()).first()

    version_data = latest_version.data if latest_version else {}
    languages = sorted(list(version_data.keys())) if isinstance(version_data, dict) else []

    return {
        "object_id": str(object_id),
        "object_type": externalize_object_type(object_type),
        "languages": languages,
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
    get_object_or_404(db, object_type, object_id, user_id=current_user.id)
    project_id = resolve_project_id_for_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    latest_version = db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).order_by(ObjectVersion.version_number.desc()).first()

    if not latest_version:
        raise HTTPException(status_code=404, detail="Object not found")

    version_data = latest_version.data or {}
    if not isinstance(version_data, dict) or not version_data:
        raise HTTPException(status_code=404, detail="No translations available for this object")

    if len(version_data) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the only translation. Object must have at least one language."
        )

    if language not in version_data:
        raise HTTPException(status_code=404, detail=f"Translation not found for language: {language}")

    next_data = dict(version_data)
    del next_data[language]
    latest_version.data = next_data
    queue_object_change(
        db,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        action="updated",
    )

    db.commit()

    return {"message": f"Translation deleted for language: {language}"}
