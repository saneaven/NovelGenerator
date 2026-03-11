from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import SessionLocal
from ..models.db_models import (
    Act,
    Asset,
    BasicInfo,
    Chapter,
    Character,
    Guidelines,
    LorebookEntry,
    Location,
    Manuscript,
    ManuscriptImage,
    Organization,
    Outline,
    Project,
    StoryObjectAsset,
)
from ..models.translation_models import ObjectVersion
from ..services.deletion_service import (
    collect_act_subtree_object_ids,
    collect_chapter_subtree_object_ids,
    collect_outline_subtree_object_ids,
    delete_assets_with_files,
    delete_object_versions_bulk,
    delete_rag_sources_bulk,
)
from ..services.manuscript_image_index_service import rebuild_manuscript_images_for_language
from ..services.rag_index_service import index_object, invalidate_object_index
from ..utils.object_type_aliases import externalize_object_type, normalize_object_type
from .basic_info_utils import normalize_basic_info_data
from .asset_change_events import queue_scene_assets_change
from .object_change_events import queue_object_change
from .credential_service import CredentialServiceError, credential_service
from .settings_service import settings_service
from .storage_usage_service import (
    apply_project_usage_delta,
    apply_project_usage_deltas,
    build_asset_rows_delta,
    build_manuscript_images_delta,
    build_object_version_delta,
    build_story_core_delta,
    build_story_core_rows_delta,
    build_usage_delta_for_measurement_rows,
    measure_object_version_row,
    snapshot_asset_row,
    snapshot_manuscript_image_row,
    snapshot_object_version_row,
    snapshot_rows,
    snapshot_story_core_row,
)


LOREBOOK_TYPE = normalize_object_type("lorebook")
_PENDING_RAG_OPS_KEY = "_pending_rag_ops"
_RAG_EXCLUDED_TYPES = {"basic_info", "guidelines"}
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PendingRagOp:
    user_id: UUID
    project_id: UUID
    object_type: str
    object_id: UUID


def _queue_rag_index(
    db: Session,
    *,
    user_id: UUID | None,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> None:
    if user_id is None:
        return
    if object_type in _RAG_EXCLUDED_TYPES:
        return
    pending = db.info.setdefault(_PENDING_RAG_OPS_KEY, [])
    op = _PendingRagOp(
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )
    if op not in pending:
        pending.append(op)


def _invalidate_rag_index(
    db: Session,
    *,
    user_id: UUID | None,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> None:
    if user_id is None:
        return
    if object_type in _RAG_EXCLUDED_TYPES:
        return
    invalidate_object_index(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )


_RAG_SEMAPHORE = asyncio.Semaphore(3)


async def _process_pending_rag_op(op: _PendingRagOp) -> None:
    async with _RAG_SEMAPHORE:
        await _process_pending_rag_op_inner(op)


async def _process_pending_rag_op_inner(op: _PendingRagOp) -> None:
    db = SessionLocal()
    try:
        if not settings_service.is_vector_storage_enabled(db, op.user_id):
            return

        embedding_cfg = settings_service.get_embedding_config(db, op.user_id, "ragSearch")
        if not embedding_cfg.provider or not embedding_cfg.model:
            return

        try:
            provider_config = credential_service.get_provider_config(db, op.user_id, embedding_cfg.provider)
        except CredentialServiceError:
            return

        await index_object(
            db,
            user_id=op.user_id,
            project_id=op.project_id,
            object_type=op.object_type,
            object_id=op.object_id,
            provider_config=provider_config,
            force=False,
        )
    except Exception:
        logger.exception(
            "RAG indexing hook failed for %s/%s",
            op.object_type,
            op.object_id,
        )
    finally:
        db.close()


@event.listens_for(Session, "after_commit")
def _dispatch_pending_rag_ops(session: Session) -> None:
    pending = session.info.pop(_PENDING_RAG_OPS_KEY, None)
    if not pending:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Skipping queued RAG indexing hooks: no running event loop")
        return

    unique_ops = list(dict.fromkeys(pending))
    for op in unique_ops:
        loop.create_task(_process_pending_rag_op(op))


@event.listens_for(Session, "after_rollback")
def _clear_pending_rag_ops(session: Session) -> None:
    session.info.pop(_PENDING_RAG_OPS_KEY, None)


def _model_for_object_type(object_type: str):
    t = normalize_object_type(object_type)
    mapping = {
        "basic_info": BasicInfo,
        "guidelines": Guidelines,
        "character": Character,
        "organization": Organization,
        "location": Location,
        LOREBOOK_TYPE: LorebookEntry,
        "outline": Outline,
        "act": Act,
        "chapter": Chapter,
        "manuscript": Manuscript,
    }
    model = mapping.get(t)
    if model is None:
        raise ValueError(f"Unknown object type: {object_type}")
    return model


def _latest_version(db: Session, object_type: str, object_id: UUID) -> ObjectVersion | None:
    return (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )


def _versions_desc(db: Session, object_type: str, object_id: UUID) -> list[ObjectVersion]:
    return (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .all()
    )


def _get_metadata(db: Session, obj: Any, object_type: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "id": str(obj.id),
        "created_at": obj.created_at.isoformat() if obj.created_at else None,
        "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
    }

    if object_type == "basic_info":
        metadata["project_id"] = str(obj.project_id)
        metadata["cover_image_id"] = None
        main_link = (
            db.query(StoryObjectAsset)
            .filter(
                StoryObjectAsset.object_type == "basic_info",
                StoryObjectAsset.object_id == obj.id,
                StoryObjectAsset.is_main == True,
            )
            .first()
        )
        if main_link:
            metadata["cover_image_id"] = str(main_link.asset_id)
        metadata["image_prompt"] = getattr(obj, "image_prompt", None)
        metadata["image_prompt_positive"] = getattr(obj, "image_prompt_positive", None)
        metadata["image_prompt_negative"] = getattr(obj, "image_prompt_negative", None)
    elif object_type == "guidelines":
        metadata["project_id"] = str(obj.project_id)
    elif object_type in {"character", "organization", "location", LOREBOOK_TYPE}:
        metadata["project_id"] = str(obj.project_id)
        metadata["order"] = int(getattr(obj, "order", 0) or 0)
        metadata["image_prompt"] = getattr(obj, "image_prompt", None)
        metadata["image_prompt_positive"] = getattr(obj, "image_prompt_positive", None)
        metadata["image_prompt_negative"] = getattr(obj, "image_prompt_negative", None)
    elif object_type == "outline":
        metadata["project_id"] = str(obj.project_id)
        metadata["order"] = int(getattr(obj, "order", 0) or 0)
    elif object_type == "act":
        outline = getattr(obj, "outline", None)
        if not outline:
            outline = db.query(Outline).filter(Outline.id == obj.outline_id).first()
        if outline is None:
            raise ValueError("Act is missing outline")
        metadata["project_id"] = str(outline.project_id)
        metadata["outline_id"] = str(obj.outline_id)
        metadata["order"] = int(obj.order)
    elif object_type == "chapter":
        act = getattr(obj, "act", None)
        if act is None:
            act = db.query(Act).filter(Act.id == obj.act_id).first()
        if act is None:
            raise ValueError("Chapter act missing")
        outline = getattr(act, "outline", None)
        if outline is None:
            outline = db.query(Outline).filter(Outline.id == act.outline_id).first()
        if outline is None:
            raise ValueError("Chapter outline missing")
        manuscript = getattr(obj, "manuscript", None)
        if manuscript is None:
            manuscript = db.query(Manuscript).filter(Manuscript.chapter_id == obj.id).first()
        if manuscript is None:
            raise ValueError("Chapter manuscript missing")
        metadata["project_id"] = str(outline.project_id)
        metadata["act_id"] = str(obj.act_id)
        metadata["manuscript_id"] = str(manuscript.id)
        metadata["order"] = int(obj.order)
    elif object_type == "manuscript":
        chapter = getattr(obj, "chapter", None)
        if chapter is None:
            chapter = db.query(Chapter).filter(Chapter.id == obj.chapter_id).first()
        if chapter is None:
            raise ValueError("Manuscript chapter missing")
        act = getattr(chapter, "act", None)
        if act is None:
            act = db.query(Act).filter(Act.id == chapter.act_id).first()
        if act is None:
            raise ValueError("Manuscript act missing")
        outline = getattr(act, "outline", None)
        if outline is None:
            outline = db.query(Outline).filter(Outline.id == act.outline_id).first()
        if outline is None:
            raise ValueError("Manuscript outline missing")
        metadata["project_id"] = str(outline.project_id)
        metadata["chapter_id"] = str(obj.chapter_id)

    return metadata


def _serialize_object(db: Session, object_type: str, obj: Any, language: str | None = None) -> dict[str, Any]:
    latest = _latest_version(db, object_type, obj.id)
    if latest is None:
        data: dict[str, Any] = {}
        version = {"id": None, "number": 0, "created_at": None}
    else:
        version_data = latest.data if isinstance(latest.data, dict) else {}
        if language:
            if language in version_data and isinstance(version_data[language], dict):
                data = {language: version_data[language]}
            else:
                data = {}
        else:
            data = version_data
        version = {
            "id": str(latest.id),
            "number": latest.version_number,
            "created_at": latest.created_at.isoformat() if latest.created_at else None,
        }

    if object_type == "basic_info":
        data = {
            lang: normalize_basic_info_data(lang_data)
            for lang, lang_data in data.items()
            if isinstance(lang_data, dict)
        }

    return {
        "id": str(obj.id),
        "type": externalize_object_type(object_type),
        "metadata": _get_metadata(db, obj, object_type),
        "data": data,
        "version": version,
    }


def _load_owned_object(db: Session, project_id: UUID, object_type: str, object_id: UUID) -> Any | None:
    if object_type in {"basic_info", "guidelines", "character", "organization", "location", LOREBOOK_TYPE, "outline"}:
        model = _model_for_object_type(object_type)
        return db.query(model).filter(model.id == object_id, model.project_id == project_id).first()
    if object_type == "act":
        return (
            db.query(Act)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Act.id == object_id, Outline.project_id == project_id)
            .options(joinedload(Act.outline))
            .first()
        )
    if object_type == "chapter":
        return (
            db.query(Chapter)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Chapter.id == object_id, Outline.project_id == project_id)
            .options(joinedload(Chapter.manuscript), joinedload(Chapter.act).joinedload(Act.outline))
            .first()
        )
    if object_type == "manuscript":
        return (
            db.query(Manuscript)
            .join(Chapter, Chapter.id == Manuscript.chapter_id)
            .join(Act, Act.id == Chapter.act_id)
            .join(Outline, Outline.id == Act.outline_id)
            .filter(Manuscript.id == object_id, Outline.project_id == project_id)
            .options(joinedload(Manuscript.chapter).joinedload(Chapter.act).joinedload(Act.outline))
            .first()
        )
    return None


def _create_or_update_version(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    language: str,
    new_data: dict[str, Any],
    user_request: str,
    created_by: UUID | None,
    create_new: bool,
) -> ObjectVersion:
    if object_type == "basic_info":
        new_data = normalize_basic_info_data(new_data)

    latest = _latest_version(db, object_type, object_id)
    if latest is None:
        version = ObjectVersion(
            id=uuid4(),
            object_type=object_type,
            object_id=object_id,
            version_number=1,
            data={language: new_data},
            user_request=user_request,
            created_by=created_by,
            created_at=datetime.utcnow(),
        )
        db.add(version)
        db.flush()
        return version

    if create_new:
        version = ObjectVersion(
            id=uuid4(),
            object_type=object_type,
            object_id=object_id,
            version_number=latest.version_number + 1,
            data={language: new_data},
            user_request=user_request,
            created_by=created_by,
            created_at=datetime.utcnow(),
        )
        db.add(version)
        db.flush()
        return version

    merged = dict(latest.data or {})
    merged[language] = new_data
    latest.data = merged
    latest.user_request = user_request
    latest.created_by = created_by
    latest.created_at = datetime.utcnow()
    db.flush()
    return latest


def _handle_metadata_update(db: Session, object_type: str, object_id: UUID, obj: Any, metadata: dict[str, Any]) -> None:
    if object_type == "chapter":
        requested_act_id = metadata.get("act_id")
        requested_order = metadata.get("order")

        target_act_id: UUID | None = None
        if requested_act_id is not None:
            try:
                target_act_id = UUID(str(requested_act_id))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid act_id format")

        if requested_order is not None and (not isinstance(requested_order, int) or requested_order < 1):
            raise HTTPException(status_code=400, detail="Invalid order value: must be positive integer")

        current_act_id = obj.act_id
        current_order = obj.order

        if target_act_id is not None and target_act_id != current_act_id:
            old_siblings = (
                db.query(Chapter)
                .filter(Chapter.act_id == current_act_id, Chapter.id != object_id)
                .order_by(Chapter.order)
                .all()
            )
            for i, ch in enumerate(old_siblings, start=1):
                ch.order = i

            target_siblings = (
                db.query(Chapter)
                .filter(Chapter.act_id == target_act_id, Chapter.id != object_id)
                .order_by(Chapter.order)
                .all()
            )
            for i, ch in enumerate(target_siblings, start=1):
                ch.order = i

            max_order = len(target_siblings) + 1
            new_order = requested_order if requested_order is not None else max_order
            new_order = min(new_order, max_order)
            new_order = max(new_order, 1)

            for ch in target_siblings:
                if ch.order >= new_order:
                    ch.order += 1

            obj.act_id = target_act_id
            obj.order = new_order
            db.flush()

        elif requested_order is not None and requested_order != current_order:
            siblings = (
                db.query(Chapter)
                .filter(Chapter.act_id == current_act_id, Chapter.id != object_id)
                .order_by(Chapter.order)
                .all()
            )
            for i, ch in enumerate(siblings, start=1):
                ch.order = i

            max_order = len(siblings) + 1
            new_order = min(max(requested_order, 1), max_order)
            for ch in siblings:
                if ch.order >= new_order:
                    ch.order += 1

            obj.order = new_order
            db.flush()

    elif object_type == "act" and "order" in metadata:
        new_order = metadata.get("order")
        if not isinstance(new_order, int) or new_order < 1:
            raise HTTPException(status_code=400, detail="Invalid order value: must be positive integer")

        current_order = obj.order
        outline_id = obj.outline_id
        if new_order != current_order:
            siblings = (
                db.query(Act)
                .filter(Act.outline_id == outline_id, Act.id != object_id)
                .order_by(Act.order)
                .all()
            )

            max_order = len(siblings) + 1
            new_order = min(max(new_order, 1), max_order)

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


class ObjectService:
    def create_object(
        self,
        db: Session,
        project_id: UUID,
        object_type: str,
        data: dict[str, Any],
        language: str,
        metadata: dict[str, Any] | None = None,
        user_request: str = "Initial Creation",
        create_new_version: bool = True,
        created_by: UUID | None = None,
    ) -> dict[str, Any]:
        _ = create_new_version
        t = normalize_object_type(object_type)
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise ValueError("Project not found")

        if t in {"basic_info", "guidelines"}:
            raise ValueError(f"{t} is auto-created with project and cannot be created manually")

        if t == "manuscript":
            doc = data.get("doc")
            if not isinstance(doc, dict):
                raise ValueError("Manuscript creation requires data.doc (TipTap JSON)")
            if "content" in data:
                raise ValueError("Manuscript creation does not accept data.content")

        model_class = _model_for_object_type(t)
        object_id = uuid4()
        manuscript_id: UUID | None = None
        md = metadata or {}

        if t in {"character", "organization", "location", LOREBOOK_TYPE}:
            max_order = db.query(func.max(model_class.order)).filter(model_class.project_id == project_id).scalar() or 0
            core_obj = model_class(id=object_id, project_id=project_id, order=max_order + 1, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        elif t == "outline":
            max_order = db.query(func.max(Outline.order)).filter(Outline.project_id == project_id).scalar()
            if max_order is None:
                max_order = -1
            core_obj = Outline(id=object_id, project_id=project_id, order=max_order + 1, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        elif t == "act":
            outline_id_value = md.get("outline_id")
            if not outline_id_value:
                raise ValueError("outline_id is required for act creation")
            try:
                outline_uuid = UUID(str(outline_id_value))
            except (TypeError, ValueError):
                raise ValueError("Invalid outline_id format")

            outline = db.query(Outline).filter(Outline.id == outline_uuid, Outline.project_id == project_id).first()
            if outline is None:
                raise ValueError("Outline not found for project")

            requested_order = md.get("order")
            if isinstance(requested_order, int):
                order_value = requested_order
            else:
                order_value = db.query(Act).filter(Act.outline_id == outline_uuid).count()

            core_obj = Act(
                id=object_id,
                project_id=project_id,
                outline_id=outline_uuid,
                order=order_value,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        elif t == "chapter":
            act_id_value = md.get("act_id")
            if not act_id_value:
                raise ValueError("Chapter creation requires act_id")
            try:
                act_uuid = UUID(str(act_id_value))
            except (TypeError, ValueError):
                raise ValueError("Invalid act_id format")

            act = (
                db.query(Act)
                .join(Outline, Outline.id == Act.outline_id)
                .filter(Act.id == act_uuid, Outline.project_id == project_id)
                .first()
            )
            if act is None:
                raise ValueError("Act not found for project")

            requested_order = md.get("order")
            if isinstance(requested_order, int):
                chapter_order = requested_order
            else:
                chapter_count = db.query(Chapter).filter(Chapter.act_id == act_uuid).count()
                chapter_order = chapter_count + 1

            core_obj = Chapter(
                id=object_id,
                project_id=project_id,
                act_id=act_uuid,
                order=chapter_order,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        elif t == "manuscript":
            chapter_id_value = md.get("chapter_id")
            if not chapter_id_value:
                raise ValueError("Manuscript creation requires chapter_id")
            try:
                chapter_uuid = UUID(str(chapter_id_value))
            except (TypeError, ValueError):
                raise ValueError("Invalid chapter_id format")

            chapter = (
                db.query(Chapter)
                .join(Act, Act.id == Chapter.act_id)
                .join(Outline, Outline.id == Act.outline_id)
                .filter(Chapter.id == chapter_uuid, Outline.project_id == project_id)
                .first()
            )
            if chapter is None:
                raise ValueError("Chapter not found for project")

            existing = db.query(Manuscript).filter(Manuscript.chapter_id == chapter_uuid).first()
            if existing is not None:
                raise ValueError("Manuscript already exists for this chapter")

            core_obj = Manuscript(id=object_id, chapter_id=chapter_uuid, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        else:
            raise ValueError(f"Creation not supported for {t}")

        db.add(core_obj)
        db.flush()

        version = ObjectVersion(
            id=uuid4(),
            object_type=t,
            object_id=object_id,
            version_number=1,
            data={language: data},
            user_request=user_request,
            created_by=created_by,
            created_at=datetime.utcnow(),
        )
        db.add(version)
        db.flush()
        deltas = [
            build_object_version_delta(
                object_type=t,
                before=None,
                after=snapshot_object_version_row(version),
            )
        ]

        # Chapter creation side effect: auto-create manuscript + v1
        if t == "chapter":
            manuscript_id = uuid4()
            manuscript_obj = Manuscript(id=manuscript_id, chapter_id=object_id, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
            db.add(manuscript_obj)
            db.flush()

            manuscript_version = ObjectVersion(
                id=uuid4(),
                object_type="manuscript",
                object_id=manuscript_id,
                version_number=1,
                data={language: {"doc": {"type": "doc", "content": [{"type": "paragraph"}]}, "wordCount": 0}},
                user_request=user_request,
                created_by=created_by,
                created_at=datetime.utcnow(),
            )
            db.add(manuscript_version)
            db.flush()
            deltas.append(
                build_object_version_delta(
                    object_type="manuscript",
                    before=None,
                    after=snapshot_object_version_row(manuscript_version),
                )
            )

            # refresh chapter relation for metadata manuscript_id
            core_obj = (
                db.query(Chapter)
                .filter(Chapter.id == object_id)
                .options(joinedload(Chapter.manuscript), joinedload(Chapter.act).joinedload(Act.outline))
                .first()
            )

            _queue_rag_index(
                db,
                user_id=created_by,
                project_id=project_id,
                object_type="manuscript",
                object_id=manuscript_id,
            )

        _queue_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        queue_object_change(
            db,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
            action="created",
        )
        if manuscript_id is not None:
            queue_object_change(
                db,
                project_id=project_id,
                object_type="manuscript",
                object_id=manuscript_id,
                action="created",
            )

        if created_by is not None:
            apply_project_usage_deltas(
                db,
                user_id=created_by,
                project_id=project_id,
                deltas=deltas,
                enforce_quota=True,
            )
        return _serialize_object(db, t, core_obj, language)

    def update_object(
        self,
        db: Session,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        data: dict[str, Any],
        language: str,
        metadata: dict[str, Any] | None = None,
        user_request: str = "User Edit",
        create_new_version: bool = True,
        created_by: UUID | None = None,
    ) -> dict[str, Any]:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")

        if t == "manuscript":
            doc = data.get("doc")
            if not isinstance(doc, dict):
                raise ValueError("Manuscript updates require data.doc (TipTap JSON)")
            if "content" in data:
                raise ValueError("Manuscript updates do not accept data.content")

        obj.updated_at = datetime.utcnow()

        if metadata:
            _handle_metadata_update(db, t, object_id, obj, metadata)

        version_before = None if create_new_version else snapshot_object_version_row(_latest_version(db, t, object_id))
        manuscript_images_before = None
        manuscript_images_after = None
        if t == "manuscript":
            manuscript_images_before = snapshot_rows(
                db.query(ManuscriptImage).filter(ManuscriptImage.manuscript_id == object_id).all(),
                snapshot_manuscript_image_row,
            )

        version = _create_or_update_version(
            db,
            object_type=t,
            object_id=object_id,
            language=language,
            new_data=data,
            user_request=user_request,
            created_by=created_by,
            create_new=create_new_version,
        )

        # manuscript side effects: rebuild image index (metadata only, no file deletion)
        if t == "manuscript":
            doc = data.get("doc")
            if isinstance(doc, dict):
                chapter = getattr(obj, "chapter", None)
                act = getattr(chapter, "act", None) if chapter else None
                outline = getattr(act, "outline", None) if act else None
                resolved_project_id = getattr(outline, "project_id", None) if outline else None
                if resolved_project_id:
                    rebuild_manuscript_images_for_language(
                        db=db,
                        project_id=resolved_project_id,
                        manuscript_id=object_id,
                        language=language,
                        doc=doc,
                    )

        # reload with required relationships
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found after update")

        if t == "manuscript":
            manuscript_images_after = snapshot_rows(
                db.query(ManuscriptImage).filter(ManuscriptImage.manuscript_id == object_id).all(),
                snapshot_manuscript_image_row,
            )
            if manuscript_images_before != manuscript_images_after:
                queue_scene_assets_change(
                    db,
                    project_id=project_id,
                    manuscript_id=None,
                    action="updated",
                )
                queue_scene_assets_change(
                    db,
                    project_id=project_id,
                    manuscript_id=object_id,
                    action="updated",
                )

        _invalidate_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        _queue_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        queue_object_change(
            db,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
            action="updated",
        )

        if created_by is not None:
            deltas = [
                build_object_version_delta(
                    object_type=t,
                    before=version_before if not create_new_version else None,
                    after=snapshot_object_version_row(version),
                )
            ]
            if t == "manuscript":
                deltas.append(build_manuscript_images_delta(manuscript_images_before, manuscript_images_after))

            apply_project_usage_deltas(
                db,
                user_id=created_by,
                project_id=project_id,
                deltas=deltas,
                enforce_quota=True,
            )
        return _serialize_object(db, t, obj)

    def add_translation(
        self,
        db: Session,
        *,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        language: str,
        data: dict[str, Any],
        user_request: str = "Translation",
        created_by: UUID | None = None,
    ) -> dict[str, Any]:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")

        latest = _latest_version(db, t, object_id)
        if latest is None:
            raise ValueError("No version found for object")
        latest_data = latest.data if isinstance(latest.data, dict) else {}
        if language in latest_data:
            raise ValueError(f"Translation for {language} already exists in latest version")

        version_before = snapshot_object_version_row(latest)
        version = _create_or_update_version(
            db,
            object_type=t,
            object_id=object_id,
            language=language,
            new_data=data,
            user_request=user_request,
            created_by=created_by,
            create_new=False,
        )
        obj.updated_at = datetime.utcnow()
        db.flush()

        _invalidate_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        _queue_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        queue_object_change(
            db,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
            action="updated",
        )
        if created_by is not None:
            apply_project_usage_delta(
                db,
                user_id=created_by,
                project_id=project_id,
                delta=build_object_version_delta(
                    object_type=t,
                    before=version_before,
                    after=snapshot_object_version_row(version),
                ),
                enforce_quota=True,
            )

        refreshed_latest = _latest_version(db, t, object_id)
        if refreshed_latest is None:
            raise ValueError("No version found after translation update")
        return {
            "message": f"Translation added for {language}",
            "version_id": str(refreshed_latest.id),
            "version_number": int(refreshed_latest.version_number),
        }

    def list_versions(
        self,
        db: Session,
        *,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
    ) -> list[dict[str, Any]]:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")

        versions = _versions_desc(db, t, object_id)
        return [
            {
                "id": str(v.id),
                "number": int(v.version_number),
                "data": v.data if isinstance(v.data, dict) else {},
                "user_request": v.user_request,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ]

    def restore_version(
        self,
        db: Session,
        *,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        version_id: UUID,
        created_by: UUID | None = None,
    ) -> dict[str, Any]:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")

        version_to_restore = (
            db.query(ObjectVersion)
            .filter(
                ObjectVersion.id == version_id,
                ObjectVersion.object_type == t,
                ObjectVersion.object_id == object_id,
            )
            .first()
        )
        if version_to_restore is None:
            raise ValueError("Version not found")

        if t == "manuscript":
            restored_data = version_to_restore.data if isinstance(version_to_restore.data, dict) else {}
            if not restored_data:
                raise ValueError("Invalid manuscript version data")
            for lang_data in restored_data.values():
                if not isinstance(lang_data, dict) or not isinstance(lang_data.get("doc"), dict):
                    raise ValueError("Cannot restore manuscript version (missing doc)")

        latest = _latest_version(db, t, object_id)
        next_version_number = (latest.version_number + 1) if latest else 1

        new_version = ObjectVersion(
            id=uuid4(),
            object_type=t,
            object_id=object_id,
            version_number=next_version_number,
            data=version_to_restore.data if isinstance(version_to_restore.data, dict) else {},
            user_request=f"Restored from v{version_to_restore.version_number}",
            created_by=created_by,
            created_at=datetime.utcnow(),
        )
        db.add(new_version)
        obj.updated_at = datetime.utcnow()
        db.flush()

        _invalidate_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        _queue_rag_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
        )
        queue_object_change(
            db,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
            action="updated",
        )
        if created_by is not None:
            apply_project_usage_delta(
                db,
                user_id=created_by,
                project_id=project_id,
                delta=build_object_version_delta(
                    object_type=t,
                    before=None,
                    after=snapshot_object_version_row(new_version),
                ),
                enforce_quota=True,
            )

        return {
            "message": f"Restored v{version_to_restore.version_number} as new v{next_version_number}",
            "version_id": str(new_version.id),
            "version_number": int(next_version_number),
        }

    def delete_object(self, db: Session, project_id: UUID, object_type: str, object_id: UUID, *, user_id: UUID) -> None:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")

        resolved_project_id: UUID | None = project_id

        ids_by_type: dict[str, list[UUID]] = {t: [object_id]}

        if t == "outline":
            subtree = collect_outline_subtree_object_ids(db, outline_id=object_id)
            for k, v in subtree.items():
                ids_by_type.setdefault(k, []).extend(v)
        elif t == "act":
            subtree = collect_act_subtree_object_ids(db, act_id=object_id)
            for k, v in subtree.items():
                ids_by_type.setdefault(k, []).extend(v)
        elif t == "chapter":
            subtree = collect_chapter_subtree_object_ids(db, chapter_id=object_id)
            for k, v in subtree.items():
                ids_by_type.setdefault(k, []).extend(v)

        story_core_before: list[object] = []
        for model_class, key in (
            (BasicInfo, "basic_info"),
            (Character, "character"),
            (Organization, "organization"),
            (Location, "location"),
            (LorebookEntry, LOREBOOK_TYPE),
        ):
            object_ids = ids_by_type.get(key) or []
            if not object_ids:
                continue
            story_core_before.extend(
                snapshot_rows(
                    db.query(model_class).filter(model_class.id.in_(list(object_ids))).all(),
                    snapshot_story_core_row,
                )
            )

        story_version_before = []
        manuscript_version_before = []
        for deleted_type, deleted_ids in ids_by_type.items():
            if not deleted_ids:
                continue
            rows = snapshot_rows(
                db.query(ObjectVersion)
                .filter(ObjectVersion.object_type == deleted_type, ObjectVersion.object_id.in_(list(deleted_ids)))
                .all(),
                snapshot_object_version_row,
            )
            if deleted_type == "manuscript":
                manuscript_version_before.extend(rows)
            else:
                story_version_before.extend(rows)

        manuscript_image_before = []
        manuscript_ids = ids_by_type.get("manuscript") or []
        if manuscript_ids:
            manuscript_image_before = snapshot_rows(
                db.query(ManuscriptImage).filter(ManuscriptImage.manuscript_id.in_(list(manuscript_ids))).all(),
                snapshot_manuscript_image_row,
            )

        owned_assets: list[Asset] = []
        if t in {"basic_info", "character", "organization", "location", LOREBOOK_TYPE}:
            owned_assets = (
                db.query(Asset)
                .join(StoryObjectAsset, StoryObjectAsset.asset_id == Asset.id)
                .filter(StoryObjectAsset.object_type == t, StoryObjectAsset.object_id == object_id)
                .all()
            )
        elif t == "manuscript":
            owned_assets = (
                db.query(Asset)
                .filter(Asset.project_id == resolved_project_id, Asset.manuscript_id == object_id)
                .all()
            )
        elif t in {"outline", "act", "chapter"} and manuscript_ids:
            owned_assets = (
                db.query(Asset)
                .filter(Asset.project_id == resolved_project_id, Asset.manuscript_id.in_(list(manuscript_ids)))
                .all()
            )

        deleted_asset_ids = [asset.id for asset in owned_assets if isinstance(asset.id, UUID)]
        deleted_asset_before = snapshot_rows(owned_assets, snapshot_asset_row)
        remaining_ref_assets_before = snapshot_rows(
            db.query(Asset)
            .filter(
                Asset.project_id == resolved_project_id,
                Asset.generation_reference_images.isnot(None),
                ~Asset.id.in_(deleted_asset_ids) if deleted_asset_ids else True,
            )
            .all(),
            snapshot_asset_row,
        )

        if owned_assets:
            delete_assets_with_files(db, assets=owned_assets, scrub_references_in_project_id=resolved_project_id)

        delete_rag_sources_bulk(db, user_id=user_id, project_id=resolved_project_id, ids_by_type=ids_by_type)
        delete_object_versions_bulk(db, ids_by_type=ids_by_type)

        for deleted_type, deleted_ids in ids_by_type.items():
            for deleted_id in set(deleted_ids):
                queue_object_change(
                    db,
                    project_id=resolved_project_id,
                    object_type=deleted_type,
                    object_id=deleted_id,
                    action="deleted",
                )

        db.delete(obj)
        remaining_ref_assets_after = snapshot_rows(
            db.query(Asset)
            .filter(
                Asset.project_id == resolved_project_id,
                Asset.generation_reference_images.isnot(None),
                ~Asset.id.in_(deleted_asset_ids) if deleted_asset_ids else True,
            )
            .all(),
            snapshot_asset_row,
        )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=resolved_project_id,
            deltas=[
                build_story_core_rows_delta(story_core_before, []),
                build_usage_delta_for_measurement_rows(
                    category="story",
                    before_rows=story_version_before,
                    after_rows=[],
                    measure_fn=lambda row: measure_object_version_row(row),
                ),
                build_usage_delta_for_measurement_rows(
                    category="manuscript",
                    before_rows=manuscript_version_before,
                    after_rows=[],
                    measure_fn=lambda row: measure_object_version_row(row),
                ),
                build_manuscript_images_delta(manuscript_image_before, []),
                build_asset_rows_delta(deleted_asset_before, []),
                build_asset_rows_delta(remaining_ref_assets_before, remaining_ref_assets_after),
            ],
            enforce_quota=False,
        )
        db.flush()

    def get_object(self, db: Session, object_type: str, object_id: UUID, *, project_id: UUID, language: str | None = None) -> dict[str, Any] | None:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            return None
        return _serialize_object(db, t, obj, language)

    def list_objects(self, db: Session, project_id: UUID, object_type: str, *, language: str | None = None) -> list[dict[str, Any]]:
        t = normalize_object_type(object_type)
        model_class = _model_for_object_type(t)

        query = db.query(model_class)
        if t in {"basic_info", "guidelines", "character", "organization", "location", LOREBOOK_TYPE, "outline"}:
            query = query.filter(model_class.project_id == project_id)
        elif t == "act":
            outline_ids = [o.id for o in db.query(Outline.id).filter(Outline.project_id == project_id).all()]
            query = query.filter(Act.outline_id.in_(outline_ids)) if outline_ids else query.filter(Act.id == None)
        elif t == "chapter":
            outline_ids = [o.id for o in db.query(Outline.id).filter(Outline.project_id == project_id).all()]
            act_ids = [a.id for a in db.query(Act.id).filter(Act.outline_id.in_(outline_ids)).all()] if outline_ids else []
            query = query.filter(Chapter.act_id.in_(act_ids)) if act_ids else query.filter(Chapter.id == None)
        elif t == "manuscript":
            outline_ids = [o.id for o in db.query(Outline.id).filter(Outline.project_id == project_id).all()]
            act_ids = [a.id for a in db.query(Act.id).filter(Act.outline_id.in_(outline_ids)).all()] if outline_ids else []
            chapter_ids = [c.id for c in db.query(Chapter.id).filter(Chapter.act_id.in_(act_ids)).all()] if act_ids else []
            query = query.filter(Manuscript.chapter_id.in_(chapter_ids)) if chapter_ids else query.filter(Manuscript.id == None)

        if t == "chapter":
            query = query.options(joinedload(Chapter.manuscript), joinedload(Chapter.act).joinedload(Act.outline))
        elif t == "manuscript":
            query = query.options(joinedload(Manuscript.chapter).joinedload(Chapter.act).joinedload(Act.outline))

        rows = query.all()
        return [_serialize_object(db, t, row, language) for row in rows]

    def update_image_prompt(
        self,
        db: Session,
        *,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        user_id: UUID | None = None,
        image_prompt: str | None = None,
        image_prompt_positive: str | None = None,
        image_prompt_negative: str | None = None,
    ) -> dict[str, Any]:
        t = normalize_object_type(object_type)
        allowed = {"basic_info", "character", "organization", "location", LOREBOOK_TYPE}
        if t not in allowed:
            raise ValueError(f"Image prompts not supported for {t}")

        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")
        before = snapshot_story_core_row(obj)

        if image_prompt is not None:
            obj.image_prompt = image_prompt or None
        if image_prompt_positive is not None:
            obj.image_prompt_positive = image_prompt_positive or None
        if image_prompt_negative is not None:
            obj.image_prompt_negative = image_prompt_negative or None

        obj.updated_at = datetime.utcnow()
        db.flush()
        queue_object_change(
            db,
            project_id=project_id,
            object_type=t,
            object_id=object_id,
            action="updated",
        )
        if user_id is not None:
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=project_id,
                delta=build_story_core_delta(before, snapshot_story_core_row(obj)),
                enforce_quota=True,
            )

        return {
            "success": True,
            "image_prompt": obj.image_prompt,
            "image_prompt_positive": obj.image_prompt_positive,
            "image_prompt_negative": obj.image_prompt_negative,
        }

    def reorder_objects(
        self,
        db: Session,
        *,
        project_id: UUID,
        object_type: str,
        object_ids: list[UUID],
    ) -> int:
        t = normalize_object_type(object_type)
        allowed = {"character", "organization", "location", LOREBOOK_TYPE, "outline", "act", "chapter"}
        if t not in allowed:
            raise ValueError(f"Reordering not supported for {t}")

        model_class = _model_for_object_type(t)
        changed_ids: list[UUID] = []
        for index, object_id in enumerate(object_ids, start=1):
            obj = (
                db.query(model_class)
                .filter(model_class.id == object_id, model_class.project_id == project_id)
                .first()
            )
            if obj is None:
                raise ValueError(f"Object {object_id} not found in project")
            obj.order = index
            obj.updated_at = datetime.utcnow()
            changed_ids.append(object_id)

        db.flush()
        for changed_id in changed_ids:
            queue_object_change(
                db,
                project_id=project_id,
                object_type=t,
                object_id=changed_id,
                action="updated",
            )
        return len(object_ids)


object_service = ObjectService()
