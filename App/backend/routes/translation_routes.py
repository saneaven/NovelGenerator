"""
Translation Management Endpoints

Advanced translation operations:
- Translation
- Translation status/progress
- Language availability queries
- Bulk operations
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from uuid import UUID

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import (
    BasicInfo,
    Guidelines,
    Manuscript,
    Outline,
    Project,
    StoryEntity,
    StoryEntityFolder,
    Timeline,
    TimelineEvent,
    TimelineTrack,
    User,
)
from ..models.translation_models import ObjectVersion, ObjectVersionLanguage
from ..services.object_change_events import queue_object_change
from ..services.object_service import object_service
from ..services.ownership import require_owned_object, resolve_project_id_for_object
from ..services.storage_usage_service import apply_project_usage_delta, build_object_version_delta, snapshot_object_version_row
from ..utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE, require_story_entity_kind


router = APIRouter()


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class TranslationStatus(BaseModel):
    """Translation status for an object"""
    object_id: str
    object_type: str
    kind: Optional[str] = None
    available_languages: List[str]
    missing_languages: List[str]
    translation_coverage: float  # Percentage

    class Config:
        from_attributes = True


class TranslationData(BaseModel):
    """Single object translation data"""
    object_type: str
    object_id: str
    kind: Optional[str] = None
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

def _main_language(current_user: User) -> str:
    settings = getattr(current_user, "settings", None)
    value = getattr(settings, "main_language", None)
    return str(value or "English")


def _collect_project_object_ids(
    db: Session, project_id: UUID
) -> List[tuple]:
    """Collect (object_id, object_type, kind_or_none) for every object in a project.

    Returns lightweight tuples – no full ORM objects loaded.
    """
    results: List[tuple] = []

    # Types with a direct project_id column
    direct_types: list[tuple] = [
        ('basic_info', BasicInfo, None),
        ('guidelines', Guidelines, None),
        (STORY_ENTITY_FOLDER_TYPE, StoryEntityFolder, None),
        (STORY_ENTITY_TYPE, StoryEntity, 'kind'),
        ('outline', Outline, 'kind'),
    ]
    for object_type, model_class, kind_attr in direct_types:
        cols = [model_class.id]
        if kind_attr:
            cols.append(getattr(model_class, kind_attr))
        rows = db.query(*cols).filter(model_class.project_id == project_id).all()
        for row in rows:
            obj_id = row[0] if kind_attr else row[0]
            kind_val = str(row[1]) if kind_attr else None
            results.append((obj_id, object_type, kind_val))

    # Manuscript (via Outline join)
    rows = (
        db.query(Manuscript.id)
        .join(Outline, Manuscript.chapter_id == Outline.id)
        .filter(Outline.project_id == project_id, Outline.kind == 'chapter')
        .all()
    )
    results.extend((row[0], 'manuscript', None) for row in rows)

    # TimelineTrack
    rows = (
        db.query(TimelineTrack.id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    results.extend((row[0], 'timeline_track', None) for row in rows)

    # TimelineEvent
    rows = (
        db.query(TimelineEvent.id)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    results.extend((row[0], 'timeline_event', None) for row in rows)

    return results


def _batch_latest_versions(
    db: Session, object_refs: List[tuple]
) -> Dict[tuple, list[str]]:
    """Fetch language names on the latest version for object refs.

    Uses a window function to pick the latest version per (object_type, object_id)
    in a single query, avoiding the N+1 problem and never loading payload JSON.

    Returns {(str(object_id), object_type): [language, ...]}.
    """
    if not object_refs:
        return {}

    # Deduplicate (object_id, object_type) pairs
    unique_pairs: set[tuple] = set()
    for obj_id, obj_type, _ in object_refs:
        unique_pairs.add((obj_id, obj_type))

    obj_ids = [pair[0] for pair in unique_pairs]
    obj_types = list({pair[1] for pair in unique_pairs})

    # Window function: rank versions per (object_type, object_id) by version_number desc
    row_num = (
        func.row_number()
        .over(
            partition_by=[ObjectVersion.object_type, ObjectVersion.object_id],
            order_by=ObjectVersion.version_number.desc(),
        )
        .label("rn")
    )

    subq = (
        db.query(
            ObjectVersion.id.label("version_id"),
            ObjectVersion.object_type,
            ObjectVersion.object_id,
            row_num,
        )
        .filter(
            ObjectVersion.object_id.in_(obj_ids),
            ObjectVersion.object_type.in_(obj_types),
        )
        .subquery()
    )

    rows = (
        db.query(
            subq.c.object_type,
            subq.c.object_id,
            func.array_agg(ObjectVersionLanguage.language).label("languages"),
        )
        .outerjoin(ObjectVersionLanguage, ObjectVersionLanguage.version_id == subq.c.version_id)
        .filter(subq.c.rn == 1)
        .group_by(subq.c.object_type, subq.c.object_id)
        .all()
    )

    result: Dict[tuple, list[str]] = {}
    for obj_type, obj_id, languages in rows:
        result[(str(obj_id), obj_type)] = [lang for lang in (languages or []) if isinstance(lang, str)]
    return result


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

    object_refs = _collect_project_object_ids(db, project_id)
    version_map = _batch_latest_versions(db, object_refs)

    status_list = []
    for obj_id, object_type, kind_val in object_refs:
        available_languages = version_map.get((str(obj_id), object_type), [])

        if target_languages:
            missing_languages = [lang for lang in target_languages if lang not in available_languages]
            present_count = sum(1 for lang in target_languages if lang in available_languages)
            coverage = (present_count / len(target_languages)) * 100 if target_languages else 0
        else:
            missing_languages = []
            coverage = 100.0 if available_languages else 0.0

        status_list.append(TranslationStatus(
            object_id=str(obj_id),
            object_type=object_type,
            kind=kind_val,
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

    object_refs = _collect_project_object_ids(db, project_id)
    total_objects = len(object_refs)
    version_map = _batch_latest_versions(db, object_refs)

    language_counts: Dict[str, int] = {}
    for obj_id, object_type, _ in object_refs:
        for lang in version_map.get((str(obj_id), object_type), []):
            language_counts[lang] = language_counts.get(lang, 0) + 1

    coverage = [
        LanguageAvailabilityResponse(
            language=lang,
            object_count=count,
            total_objects=total_objects,
            coverage_percentage=(count / total_objects * 100) if total_objects > 0 else 0
        )
        for lang, count in language_counts.items()
    ]
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
    deleted_count = 0

    for object_id_str in object_ids:
        try:
            object_id = UUID(object_id_str)

            # Verify object exists and belongs to the current user.
            require_owned_object(
                db,
                object_type=object_type,
                object_id=object_id,
                user_id=current_user.id,
            )

            # Remove from latest version data only
            latest_version = db.query(ObjectVersion).filter(
                ObjectVersion.object_type == object_type,
                ObjectVersion.object_id == object_id
            ).order_by(ObjectVersion.version_number.desc()).first()

            if not latest_version:
                continue

            lang_row = (
                db.query(ObjectVersionLanguage)
                .filter(
                    ObjectVersionLanguage.version_id == latest_version.id,
                    ObjectVersionLanguage.language == language,
                )
                .first()
            )
            if lang_row is None:
                continue
            version_before = snapshot_object_version_row(latest_version)
            db.delete(lang_row)
            db.flush()
            db.expire(latest_version, ["languages"])
            project_id = resolve_project_id_for_object(
                db,
                object_type=object_type,
                object_id=object_id,
                user_id=current_user.id,
            )
            queue_object_change(
                db,
                user_id=current_user.id,
                project_id=project_id,
                object_type=object_type,
                object_id=object_id,
                action="updated",
            )
            apply_project_usage_delta(
                db,
                user_id=current_user.id,
                project_id=project_id,
                delta=build_object_version_delta(
                    object_type=object_type,
                    before=version_before,
                    after=snapshot_object_version_row(latest_version),
                ),
                enforce_quota=False,
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
    translated_objects: list[tuple[str, UUID, UUID, str]] = []
    seen_targets: set[tuple[str, UUID, UUID, str]] = set()

    try:
        for translation_data in request.translations:
            if translation_data.target_version_number is not None:
                raise HTTPException(
                    status_code=422,
                    detail="target_version_number is not supported for this endpoint",
                )

            object_type = translation_data.object_type
            if object_type == STORY_ENTITY_TYPE and translation_data.kind is not None:
                require_story_entity_kind(translation_data.kind)
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

            key = (object_type, object_id, project_id, translation_data.language)
            if key not in seen_targets:
                seen_targets.add(key)
                translated_objects.append(key)
            translated_count += 1

        db.commit()

        main_language = _main_language(current_user)
        updated_objects = []
        for obj_type, obj_id, project_id, language in translated_objects:
            obj = object_service.get_object(
                db,
                object_type=obj_type,
                object_id=obj_id,
                project_id=project_id,
                language=language,
                fallback_language=main_language,
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
    require_owned_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )

    latest_version = db.query(ObjectVersion).filter(
        ObjectVersion.object_type == object_type,
        ObjectVersion.object_id == object_id
    ).order_by(ObjectVersion.version_number.desc()).first()

    languages = []
    if latest_version is not None:
        rows = (
            db.query(ObjectVersionLanguage.language)
            .filter(ObjectVersionLanguage.version_id == latest_version.id)
            .distinct()
            .all()
        )
        languages = sorted(str(row[0]) for row in rows if row and isinstance(row[0], str))

    return {
        "object_id": str(object_id),
        "object_type": object_type,
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
    require_owned_object(
        db,
        object_type=object_type,
        object_id=object_id,
        user_id=current_user.id,
    )
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

    language_rows = (
        db.query(ObjectVersionLanguage.language)
        .filter(ObjectVersionLanguage.version_id == latest_version.id)
        .all()
    )
    languages = [row[0] for row in language_rows if row and isinstance(row[0], str)]
    if not languages:
        raise HTTPException(status_code=404, detail="No translations available for this object")

    if len(languages) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the only translation. Object must have at least one language."
        )

    if language not in languages:
        raise HTTPException(status_code=404, detail=f"Translation not found for language: {language}")

    lang_row = (
        db.query(ObjectVersionLanguage)
        .filter(ObjectVersionLanguage.version_id == latest_version.id, ObjectVersionLanguage.language == language)
        .first()
    )
    if lang_row is None:
        raise HTTPException(status_code=404, detail=f"Translation not found for language: {language}")

    version_before = snapshot_object_version_row(latest_version)
    db.delete(lang_row)
    db.flush()
    db.expire(latest_version, ["languages"])
    queue_object_change(
        db,
        user_id=current_user.id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        action="updated",
    )
    apply_project_usage_delta(
        db,
        user_id=current_user.id,
        project_id=project_id,
        delta=build_object_version_delta(
            object_type=object_type,
            before=version_before,
            after=snapshot_object_version_row(latest_version),
        ),
        enforce_quota=False,
    )

    db.commit()

    return {"message": f"Translation deleted for language: {language}"}
