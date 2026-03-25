from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import (
    Asset,
    BasicInfo,
    Guidelines,
    Manuscript,
    ManuscriptImage,
    Outline,
    RunMessageAttachmentModel,
    StoryEntity,
    ObjectAssetLink,
    Timeline,
    TimelineEvent,
    TimelineTrack,
)
from ..models.semantic_models import SemanticSource
from ..models.translation_models import ObjectVersion
from .storage_service import storage_service


STORY_ENTITY_OBJECT_TYPE = "story_entity"


def _ids(rows: Sequence[tuple[Any]] | Sequence[Any]) -> List[UUID]:
    out: List[UUID] = []
    for row in rows:
        if isinstance(row, tuple):
            value = row[0] if row else None
        else:
            value = row
        if isinstance(value, UUID):
            out.append(value)
    return out


def collect_project_object_ids(db: Session, *, project_id: UUID) -> Dict[str, List[UUID]]:
    """Collect all object IDs in a project by ObjectVersion.object_type."""
    basic_info_ids = _ids(db.query(BasicInfo.id).filter(BasicInfo.project_id == project_id).all())
    guideline_ids = _ids(db.query(Guidelines.id).filter(Guidelines.project_id == project_id).all())
    story_entity_ids = _ids(db.query(StoryEntity.id).filter(StoryEntity.project_id == project_id).all())
    outline_ids = _ids(db.query(Outline.id).filter(Outline.project_id == project_id).all())
    timeline_track_ids = _ids(
        db.query(TimelineTrack.id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )
    timeline_event_ids = _ids(
        db.query(TimelineEvent.id)
        .join(TimelineTrack, TimelineTrack.id == TimelineEvent.track_id)
        .join(Timeline, Timeline.id == TimelineTrack.timeline_id)
        .filter(Timeline.project_id == project_id)
        .all()
    )

    manuscript_ids = _ids(
        db.query(Manuscript.id)
        .join(Outline, Outline.id == Manuscript.chapter_id)
        .filter(Outline.project_id == project_id, Outline.kind == "chapter")
        .all()
    )

    return {
        "basic_info": basic_info_ids,
        "guidelines": guideline_ids,
        STORY_ENTITY_OBJECT_TYPE: story_entity_ids,
        "outline": outline_ids,
        "manuscript": manuscript_ids,
        "timeline_track": timeline_track_ids,
        "timeline_event": timeline_event_ids,
    }


def _collect_outline_descendant_ids(db: Session, *, root_id: UUID) -> List[UUID]:
    rows = db.query(Outline.id, Outline.parent_id).all()
    children_by_parent: dict[UUID | None, list[UUID]] = {}
    for node_id, parent_id in rows:
        if isinstance(node_id, UUID):
            children_by_parent.setdefault(parent_id, []).append(node_id)

    collected: list[UUID] = []
    pending = list(children_by_parent.get(root_id, []))
    while pending:
        current = pending.pop(0)
        collected.append(current)
        pending.extend(children_by_parent.get(current, []))
    return collected


def collect_outline_subtree_object_ids(db: Session, *, outline_id: UUID) -> Dict[str, List[UUID]]:
    outline_ids = _collect_outline_descendant_ids(db, root_id=outline_id)
    chapter_ids = _ids(
        db.query(Outline.id)
        .filter(Outline.id.in_(outline_ids), Outline.kind == "chapter")
        .all()
    ) if outline_ids else []
    manuscript_ids = _ids(
        db.query(Manuscript.id)
        .filter(Manuscript.chapter_id.in_(chapter_ids))
        .all()
    ) if chapter_ids else []

    return {
        "outline": outline_ids,
        "manuscript": manuscript_ids,
    }


def collect_act_subtree_object_ids(db: Session, *, act_id: UUID) -> Dict[str, List[UUID]]:
    return collect_outline_subtree_object_ids(db, outline_id=act_id)


def collect_chapter_subtree_object_ids(db: Session, *, chapter_id: UUID) -> Dict[str, List[UUID]]:
    manuscript_ids = _ids(db.query(Manuscript.id).filter(Manuscript.chapter_id == chapter_id).all())
    return {"manuscript": manuscript_ids}


def delete_object_versions_bulk(db: Session, *, ids_by_type: Mapping[str, Sequence[UUID]]) -> int:
    total = 0
    for object_type, object_ids in ids_by_type.items():
        if not object_ids:
            continue
        total += int(
            db.query(ObjectVersion)
            .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id.in_(list(object_ids)))
            .delete(synchronize_session=False)
            or 0
        )
    return int(total)


def delete_semantic_sources_for_project(db: Session, *, user_id: UUID, project_id: UUID) -> int:
    deleted = (
        db.query(SemanticSource)
        .filter(SemanticSource.user_id == user_id, SemanticSource.project_id == project_id)
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)


def delete_semantic_sources_bulk(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    ids_by_type: Mapping[str, Sequence[UUID]],
) -> int:
    total = 0
    for object_type, object_ids in ids_by_type.items():
        if not object_ids:
            continue
        total += int(
            db.query(SemanticSource)
            .filter(
                SemanticSource.user_id == user_id,
                SemanticSource.project_id == project_id,
                SemanticSource.object_type == object_type,
                SemanticSource.object_id.in_(list(object_ids)),
            )
            .delete(synchronize_session=False)
            or 0
        )
    return int(total)


def scrub_generation_reference_images(db: Session, *, project_id: UUID, deleted_asset_ids: Sequence[UUID]) -> int:
    """Remove deleted asset IDs from other assets' generation_reference_images metadata."""
    if not deleted_asset_ids:
        return 0

    delete_id_strings = {str(a_id) for a_id in deleted_asset_ids}
    assets_with_refs = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.generation_reference_images.isnot(None))
        .all()
    )

    scrubbed = 0
    for src in assets_with_refs:
        refs = getattr(src, "generation_reference_images", None)
        if not isinstance(refs, list):
            continue

        new_refs: List[Dict[str, Any]] = []
        changed = False
        for ref in refs:
            if isinstance(ref, dict) and str(ref.get("asset_id")) in delete_id_strings:
                scrubbed += 1
                changed = True
                continue
            if isinstance(ref, dict):
                new_refs.append(ref)
            else:
                new_refs.append(ref)

        if changed:
            src.generation_reference_images = new_refs  # type: ignore[assignment]
            src.updated_at = datetime.utcnow()

    return int(scrubbed)


def delete_assets_with_files(
    db: Session,
    *,
    assets: Sequence[Asset],
    scrub_references_in_project_id: Optional[UUID] = None,
) -> List[UUID]:
    """Delete Asset DB rows and their stored files. Returns deleted asset IDs."""
    deleted_ids: List[UUID] = [a.id for a in assets if isinstance(a.id, UUID)]

    if scrub_references_in_project_id and deleted_ids:
        scrub_generation_reference_images(db, project_id=scrub_references_in_project_id, deleted_asset_ids=deleted_ids)

    for asset in assets:
        storage_service.delete_asset_files(asset.file_path)
        db.delete(asset)

    return deleted_ids


def delete_project_assets_with_files(db: Session, *, project_id: UUID) -> List[UUID]:
    assets = db.query(Asset).filter(Asset.project_id == project_id).all()
    return delete_assets_with_files(db, assets=assets, scrub_references_in_project_id=project_id)


def delete_chat_attachments_with_files(
    db: Session,
    *,
    attachments: Sequence[RunMessageAttachmentModel],
) -> List[UUID]:
    deleted_ids: List[UUID] = [attachment.id for attachment in attachments if isinstance(attachment.id, UUID)]
    for attachment in attachments:
        storage_key = str(attachment.storage_key or "").strip()
        if storage_key:
            storage_service.delete_asset_files(storage_key)
        db.delete(attachment)
    return deleted_ids


def delete_project_chat_attachments_with_files(db: Session, *, project_id: UUID) -> List[UUID]:
    attachments = (
        db.query(RunMessageAttachmentModel)
        .filter(RunMessageAttachmentModel.project_id == project_id)
        .all()
    )
    return delete_chat_attachments_with_files(db, attachments=attachments)


def get_manuscript_indexed_asset_ids(db: Session, *, manuscript_id: UUID) -> Set[UUID]:
    rows = (
        db.query(ManuscriptImage.asset_id)
        .filter(ManuscriptImage.manuscript_id == manuscript_id, ManuscriptImage.asset_id.isnot(None))
        .distinct()
        .all()
    )
    return {cast_id for (cast_id,) in rows if isinstance(cast_id, UUID)}


def delete_removed_manuscript_assets(
    db: Session,
    *,
    project_id: UUID,
    manuscript_id: UUID,
    removed_asset_ids: Set[UUID],
) -> List[UUID]:
    """Delete manuscript-owned assets that disappeared from manuscript index."""
    if not removed_asset_ids:
        return []

    assets = (
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.manuscript_id == manuscript_id,
            Asset.id.in_(list(removed_asset_ids)),
        )
        .all()
    )

    return delete_assets_with_files(db, assets=assets, scrub_references_in_project_id=project_id)


def delete_story_entity_assets_with_files(
    db: Session,
    *,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> List[UUID]:
    assets = (
        db.query(Asset)
        .join(ObjectAssetLink, ObjectAssetLink.asset_id == Asset.id)
        .filter(ObjectAssetLink.object_type == object_type, ObjectAssetLink.object_id == object_id)
        .all()
    )
    return delete_assets_with_files(db, assets=assets, scrub_references_in_project_id=project_id)
