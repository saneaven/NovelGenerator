from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.orm import Session, joinedload

from ..database import SessionLocal
from ..models.db_models import (
    Asset,
    BasicInfo,
    Guidelines,
    Manuscript,
    ManuscriptImage,
    Outline,
    Project,
    StoryEntity,
    StoryEntityFolder,
    StoryObjectAsset,
)
from ..models.translation_models import ObjectVersion
from ..services.deletion_service import (
    collect_act_subtree_object_ids,
    collect_chapter_subtree_object_ids,
    collect_outline_subtree_object_ids,
    delete_assets_with_files,
    delete_object_versions_bulk,
    delete_semantic_sources_bulk,
)
from ..services.manuscript_image_index_service import rebuild_manuscript_images_for_language
from ..services.semantic_index_service import index_object, invalidate_object_index
from ..utils.object_type_aliases import externalize_object_type, normalize_object_type
from ..utils.story_entities import STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE, require_story_entity_kind
from .basic_info_utils import normalize_basic_info_data
from .outline_service import (
    insert_outline_position,
    move_outline,
    normalize_outline_positions,
    require_outline_kind,
    resolve_outline_parent,
)
from .asset_change_events import queue_scene_assets_change
from .object_change_events import queue_object_change
from .story_entity_tree_service import (
    collect_descendant_folder_ids,
    collect_descendant_story_entity_ids,
    delete_story_entity_folder_rows,
    ensure_valid_parent_folder,
    move_story_entity,
    move_story_entity_folder,
    next_story_entity_sibling_order,
    normalize_story_entity_parent,
)
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

_PENDING_SEMANTIC_OPS_KEY = "_pending_semantic_ops"
_SEMANTIC_EXCLUDED_TYPES = {"basic_info", "guidelines", STORY_ENTITY_FOLDER_TYPE}
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PendingSemanticOp:
    user_id: UUID
    project_id: UUID
    object_type: str
    object_id: UUID


def _queue_semantic_index(
    db: Session,
    *,
    user_id: UUID | None,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> None:
    if user_id is None:
        return
    if object_type in _SEMANTIC_EXCLUDED_TYPES:
        return
    pending = db.info.setdefault(_PENDING_SEMANTIC_OPS_KEY, [])
    op = _PendingSemanticOp(
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )
    if op not in pending:
        pending.append(op)


def _invalidate_semantic_index(
    db: Session,
    *,
    user_id: UUID | None,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> None:
    if user_id is None:
        return
    if object_type in _SEMANTIC_EXCLUDED_TYPES:
        return
    invalidate_object_index(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )


_SEMANTIC_SEMAPHORE = asyncio.Semaphore(3)


async def _process_pending_semantic_op(op: _PendingSemanticOp) -> None:
    async with _SEMANTIC_SEMAPHORE:
        await _process_pending_semantic_op_inner(op)


async def _process_pending_semantic_op_inner(op: _PendingSemanticOp) -> None:
    db = SessionLocal()
    try:
        if not settings_service.is_vector_storage_enabled(db, op.user_id):
            return

        embedding_cfg = settings_service.get_search_embedding_config(db, op.user_id)
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
            "Semantic indexing hook failed for %s/%s",
            op.object_type,
            op.object_id,
        )
    finally:
        db.close()


@event.listens_for(Session, "after_commit")
def _dispatch_pending_semantic_ops(session: Session) -> None:
    pending = session.info.pop(_PENDING_SEMANTIC_OPS_KEY, None)
    if not pending:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Skipping queued semantic indexing hooks: no running event loop")
        return

    unique_ops = list(dict.fromkeys(pending))
    for op in unique_ops:
        loop.create_task(_process_pending_semantic_op(op))


@event.listens_for(Session, "after_rollback")
def _clear_pending_semantic_ops(session: Session) -> None:
    session.info.pop(_PENDING_SEMANTIC_OPS_KEY, None)


def _resolve_project_user_id(db: Session, *, project_id: UUID) -> UUID:
    owner_id = db.query(Project.user_id).filter(Project.id == project_id).scalar()
    if not isinstance(owner_id, UUID):
        raise ValueError("Project not found")
    return owner_id


def _model_for_object_type(object_type: str):
    t = normalize_object_type(object_type)
    mapping = {
        "basic_info": BasicInfo,
        "guidelines": Guidelines,
        STORY_ENTITY_FOLDER_TYPE: StoryEntityFolder,
        STORY_ENTITY_TYPE: StoryEntity,
        "outline": Outline,
        "manuscript": Manuscript,
    }
    model = mapping.get(t)
    if model is None:
        raise ValueError(f"Unknown object type: {object_type}")
    return model


def _canonical_object_type(object_type: str) -> str:
    return normalize_object_type(object_type)


def _latest_version(db: Session, object_type: str, object_id: UUID) -> ObjectVersion | None:
    object_type = _canonical_object_type(object_type)
    return (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )


def _versions_desc(db: Session, object_type: str, object_id: UUID) -> list[ObjectVersion]:
    object_type = _canonical_object_type(object_type)
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
    elif object_type == STORY_ENTITY_FOLDER_TYPE:
        metadata["project_id"] = str(obj.project_id)
        metadata["parent_id"] = str(obj.parent_id) if getattr(obj, "parent_id", None) else None
        metadata["display_order"] = int(getattr(obj, "display_order", 0) or 0)
    elif object_type == STORY_ENTITY_TYPE:
        metadata["project_id"] = str(obj.project_id)
        metadata["folder_id"] = str(obj.folder_id) if getattr(obj, "folder_id", None) else None
        metadata["display_order"] = int(getattr(obj, "display_order", 0) or 0)
        metadata["image_prompt"] = getattr(obj, "image_prompt", None)
        metadata["image_prompt_positive"] = getattr(obj, "image_prompt_positive", None)
        metadata["image_prompt_negative"] = getattr(obj, "image_prompt_negative", None)
    elif object_type == "outline":
        metadata["project_id"] = str(obj.project_id)
        metadata["kind"] = str(getattr(obj, "kind", ""))
        metadata["parent_id"] = str(obj.parent_id) if getattr(obj, "parent_id", None) else None
        metadata["position"] = int(getattr(obj, "position", 0) or 0)
        manuscript = getattr(obj, "manuscript", None)
        if manuscript is None and getattr(obj, "kind", None) == "chapter":
            manuscript = db.query(Manuscript).filter(Manuscript.chapter_id == obj.id).first()
        if manuscript is not None:
            metadata["manuscript_id"] = str(manuscript.id)
    elif object_type == "manuscript":
        chapter = getattr(obj, "chapter", None)
        if chapter is None:
            chapter = db.query(Outline).filter(Outline.id == obj.chapter_id, Outline.kind == "chapter").first()
        if chapter is None:
            raise ValueError("Manuscript chapter missing")
        metadata["project_id"] = str(chapter.project_id)
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

    serialized = {
        "id": str(obj.id),
        "type": externalize_object_type(object_type),
        "metadata": _get_metadata(db, obj, object_type),
        "data": data,
        "version": version,
    }
    if object_type in {"outline", STORY_ENTITY_TYPE}:
        serialized["kind"] = str(getattr(obj, "kind", ""))
    return serialized


def _load_owned_object(db: Session, project_id: UUID, object_type: str, object_id: UUID) -> Any | None:
    if object_type in {"basic_info", "guidelines", STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE}:
        model = _model_for_object_type(object_type)
        return db.query(model).filter(model.id == object_id, model.project_id == project_id).first()
    if object_type == "outline":
        return (
            db.query(Outline)
            .filter(Outline.id == object_id, Outline.project_id == project_id)
            .options(joinedload(Outline.parent), joinedload(Outline.children), joinedload(Outline.manuscript))
            .first()
        )
    if object_type == "manuscript":
        return (
            db.query(Manuscript)
            .join(Outline, Outline.id == Manuscript.chapter_id)
            .filter(Manuscript.id == object_id, Outline.project_id == project_id, Outline.kind == "chapter")
            .options(joinedload(Manuscript.chapter).joinedload(Outline.parent).joinedload(Outline.parent))
            .first()
        )
    return None


def _parse_optional_uuid(value: Any, field_name: str) -> UUID | None:
    if value in (None, "", "null"):
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format") from exc


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
    object_type = _canonical_object_type(object_type)
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
    if object_type == STORY_ENTITY_FOLDER_TYPE:
        requested_parent_id = obj.parent_id
        if "parent_id" in metadata:
            requested_parent_id = _parse_optional_uuid(metadata.get("parent_id"), "parent_id")
        requested_order = metadata.get("display_order")
        if requested_order is not None and (not isinstance(requested_order, int) or requested_order < 0):
            raise HTTPException(status_code=400, detail="Invalid display_order value")

        if requested_parent_id != obj.parent_id or requested_order is not None:
            move_story_entity_folder(
                db,
                project_id=obj.project_id,
                folder_id=object_id,
                new_parent_folder_id=requested_parent_id,
                new_index=requested_order,
            )
        return

    if object_type == STORY_ENTITY_TYPE:
        requested_folder_id = obj.folder_id
        if "folder_id" in metadata:
            requested_folder_id = _parse_optional_uuid(metadata.get("folder_id"), "folder_id")
        requested_index = metadata.get("display_order")
        if requested_index is not None and (not isinstance(requested_index, int) or requested_index < 0):
            raise HTTPException(status_code=400, detail="Invalid display_order value")

        if requested_folder_id != obj.folder_id or requested_index is not None:
            move_story_entity(
                db,
                project_id=obj.project_id,
                entity_id=object_id,
                new_parent_folder_id=requested_folder_id,
                new_index=requested_index,
            )
        return

    if object_type == "outline":
        if "kind" in metadata and str(metadata.get("kind") or "") != str(obj.kind or ""):
            raise HTTPException(status_code=400, detail="Outline kind is immutable")

        requested_parent_id = obj.parent_id
        if "parent_id" in metadata:
            requested_parent_id = _parse_optional_uuid(metadata.get("parent_id"), "parent_id")
        requested_position = metadata.get("position")
        if requested_position is not None and (not isinstance(requested_position, int) or requested_position < 0):
            raise HTTPException(status_code=400, detail="Invalid position value")

        if requested_parent_id != obj.parent_id or requested_position is not None:
            move_outline(
                db,
                outline=obj,
                project_id=obj.project_id,
                new_parent_id=requested_parent_id,
                new_position=requested_position if isinstance(requested_position, int) else None,
            )


class ObjectService:
    def create_object(
        self,
        db: Session,
        project_id: UUID,
        object_type: str,
        data: dict[str, Any],
        language: str,
        kind: str | None = None,
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
        event_user_id = created_by or project.user_id

        if t in {"basic_info", "guidelines"}:
            raise ValueError(f"{t} is auto-created with project and cannot be created manually")

        if t == "manuscript":
            doc = data.get("doc")
            if not isinstance(doc, dict):
                raise ValueError("Manuscript creation requires data.doc (TipTap JSON)")
            if "content" in data:
                raise ValueError("Manuscript creation does not accept data.content")
        elif t == STORY_ENTITY_FOLDER_TYPE:
            if not str(data.get("name") or "").strip():
                raise ValueError("Story entity folder creation requires data.name")

        object_id = uuid4()
        manuscript_id: UUID | None = None
        md = metadata or {}
        storage_type = _canonical_object_type(t)

        if t == STORY_ENTITY_FOLDER_TYPE:
            parent_id = _parse_optional_uuid(md.get("parent_id"), "parent_id")
            ensure_valid_parent_folder(db, project_id=project_id, folder_id=parent_id)
            core_obj = StoryEntityFolder(
                id=object_id,
                project_id=project_id,
                parent_id=parent_id,
                display_order=next_story_entity_sibling_order(
                    db,
                    project_id=project_id,
                    parent_folder_id=parent_id,
                ),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        elif t == STORY_ENTITY_TYPE:
            folder_id = _parse_optional_uuid(md.get("folder_id"), "folder_id")
            ensure_valid_parent_folder(db, project_id=project_id, folder_id=folder_id)
            entity_kind = require_story_entity_kind(kind or md.get("kind"))
            core_obj = StoryEntity(
                id=object_id,
                project_id=project_id,
                kind=entity_kind,
                folder_id=folder_id,
                display_order=next_story_entity_sibling_order(
                    db,
                    project_id=project_id,
                    parent_folder_id=folder_id,
                ),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        elif t == "outline":
            outline_kind = require_outline_kind(kind or md.get("kind"))
            requested_parent_id = _parse_optional_uuid(
                md.get("parent_id"),
                "parent_id",
            )
            resolve_outline_parent(
                db,
                project_id=project_id,
                child_kind=outline_kind,
                parent_id=requested_parent_id,
            )

            core_obj = Outline(
                id=object_id,
                project_id=project_id,
                kind=outline_kind,
                parent_id=requested_parent_id,
                position=0,
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

            chapter = db.query(Outline).filter(
                Outline.id == chapter_uuid,
                Outline.project_id == project_id,
                Outline.kind == "chapter",
            ).first()
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
        if storage_type == STORY_ENTITY_FOLDER_TYPE:
            requested_order = md.get("display_order")
            if requested_order is not None and (not isinstance(requested_order, int) or requested_order < 0):
                raise ValueError("Folder display_order must be a non-negative integer")
            if isinstance(requested_order, int):
                move_story_entity_folder(
                    db,
                    project_id=project_id,
                    folder_id=core_obj.id,
                    new_parent_folder_id=core_obj.parent_id,
                    new_index=requested_order,
                )
        elif storage_type == "outline":
            requested_position = md.get("position")
            if requested_position is not None and (not isinstance(requested_position, int) or requested_position < 0):
                raise ValueError("Outline position must be a non-negative integer")
            insert_outline_position(
                db,
                outline=core_obj,
                project_id=project_id,
                parent_id=core_obj.parent_id,
                requested_position=requested_position if isinstance(requested_position, int) else None,
            )

        version = ObjectVersion(
            id=uuid4(),
            object_type=storage_type,
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
                object_type=storage_type,
                before=None,
                after=snapshot_object_version_row(version),
            )
        ]

        # Chapter creation side effect: auto-create manuscript + v1
        if storage_type == "outline" and getattr(core_obj, "kind", None) == "chapter":
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
                db.query(Outline)
                .filter(Outline.id == object_id)
                .options(joinedload(Outline.manuscript), joinedload(Outline.parent).joinedload(Outline.parent))
                .first()
            )

            _queue_semantic_index(
                db,
                user_id=created_by,
                project_id=project_id,
                object_type="manuscript",
                object_id=manuscript_id,
            )

        _queue_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        queue_object_change(
            db,
            user_id=event_user_id,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
            action="created",
        )
        if manuscript_id is not None:
            queue_object_change(
                db,
                user_id=event_user_id,
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
        return _serialize_object(db, storage_type, core_obj, language)

    def update_object(
        self,
        db: Session,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        data: dict[str, Any],
        language: str,
        kind: str | None = None,
        metadata: dict[str, Any] | None = None,
        user_request: str = "User Edit",
        create_new_version: bool = True,
        created_by: UUID | None = None,
    ) -> dict[str, Any]:
        t = normalize_object_type(object_type)
        storage_type = _canonical_object_type(t)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")
        event_user_id = created_by or _resolve_project_user_id(db, project_id=project_id)

        if t == "manuscript":
            doc = data.get("doc")
            if not isinstance(doc, dict):
                raise ValueError("Manuscript updates require data.doc (TipTap JSON)")
            if "content" in data:
                raise ValueError("Manuscript updates do not accept data.content")

        obj.updated_at = datetime.utcnow()
        if t == STORY_ENTITY_TYPE and kind is not None:
            obj.kind = require_story_entity_kind(kind)
        elif storage_type == "outline" and kind is not None and str(kind) != str(obj.kind):
            raise ValueError("Outline kind is immutable")

        if metadata:
            _handle_metadata_update(db, storage_type, object_id, obj, metadata)

        if storage_type != "manuscript" and not data:
            current_serialized = _serialize_object(db, storage_type, obj)
            current_data = current_serialized.get("data") if isinstance(current_serialized, dict) else {}
            if isinstance(current_data, dict):
                if isinstance(current_data.get(language), dict):
                    data = dict(current_data[language])
                else:
                    for value in current_data.values():
                        if isinstance(value, dict):
                            data = dict(value)
                            break

        version_before = None if create_new_version else snapshot_object_version_row(_latest_version(db, storage_type, object_id))
        manuscript_images_before = None
        manuscript_images_after = None
        if t == "manuscript":
            manuscript_images_before = snapshot_rows(
                db.query(ManuscriptImage).filter(ManuscriptImage.manuscript_id == object_id).all(),
                snapshot_manuscript_image_row,
            )

        version = _create_or_update_version(
            db,
            object_type=storage_type,
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
                resolved_project_id = getattr(chapter, "project_id", None) if chapter else None
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
                    user_id=event_user_id,
                    project_id=project_id,
                    manuscript_id=None,
                    action="updated",
                )
                queue_scene_assets_change(
                    db,
                    user_id=event_user_id,
                    project_id=project_id,
                    manuscript_id=object_id,
                    action="updated",
                )

        _invalidate_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        _queue_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        queue_object_change(
            db,
            user_id=event_user_id,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
            action="updated",
        )

        if created_by is not None:
            deltas = [
                build_object_version_delta(
                    object_type=storage_type,
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
        return _serialize_object(db, storage_type, obj)

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
        storage_type = _canonical_object_type(t)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")
        event_user_id = created_by or _resolve_project_user_id(db, project_id=project_id)

        latest = _latest_version(db, storage_type, object_id)
        if latest is None:
            raise ValueError("No version found for object")
        latest_data = latest.data if isinstance(latest.data, dict) else {}
        if language in latest_data:
            raise ValueError(f"Translation for {language} already exists in latest version")

        version_before = snapshot_object_version_row(latest)
        version = _create_or_update_version(
            db,
            object_type=storage_type,
            object_id=object_id,
            language=language,
            new_data=data,
            user_request=user_request,
            created_by=created_by,
            create_new=False,
        )
        obj.updated_at = datetime.utcnow()
        db.flush()

        _invalidate_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        _queue_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        queue_object_change(
            db,
            user_id=event_user_id,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
            action="updated",
        )
        if created_by is not None:
            apply_project_usage_delta(
                db,
                user_id=created_by,
                project_id=project_id,
                delta=build_object_version_delta(
                    object_type=storage_type,
                    before=version_before,
                    after=snapshot_object_version_row(version),
                ),
                enforce_quota=True,
            )

        refreshed_latest = _latest_version(db, storage_type, object_id)
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

        versions = _versions_desc(db, _canonical_object_type(t), object_id)
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
        storage_type = _canonical_object_type(t)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")
        event_user_id = created_by or _resolve_project_user_id(db, project_id=project_id)

        version_to_restore = (
            db.query(ObjectVersion)
            .filter(
                ObjectVersion.id == version_id,
                ObjectVersion.object_type == storage_type,
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

        latest = _latest_version(db, storage_type, object_id)
        next_version_number = (latest.version_number + 1) if latest else 1

        new_version = ObjectVersion(
            id=uuid4(),
            object_type=storage_type,
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

        _invalidate_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        _queue_semantic_index(
            db,
            user_id=created_by,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
        )
        queue_object_change(
            db,
            user_id=event_user_id,
            project_id=project_id,
            object_type=storage_type,
            object_id=object_id,
            action="updated",
        )
        if created_by is not None:
            apply_project_usage_delta(
                db,
                user_id=created_by,
                project_id=project_id,
                delta=build_object_version_delta(
                    object_type=storage_type,
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
        storage_type = _canonical_object_type(t)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            raise ValueError(f"{t} not found")

        resolved_project_id: UUID | None = project_id

        if storage_type == STORY_ENTITY_FOLDER_TYPE:
            folder_ids = collect_descendant_folder_ids(
                db,
                project_id=project_id,
                folder_id=object_id,
            )
            entity_ids = collect_descendant_story_entity_ids(
                db,
                project_id=project_id,
                folder_ids=folder_ids,
            )
            ids_by_type: dict[str, list[UUID]] = {
                STORY_ENTITY_FOLDER_TYPE: list(folder_ids),
                STORY_ENTITY_TYPE: list(entity_ids),
            }

            story_core_before = snapshot_rows(
                db.query(StoryEntity).filter(StoryEntity.id.in_(entity_ids)).all(),
                snapshot_story_core_row,
            ) if entity_ids else []
            story_version_before = []
            for deleted_type, deleted_ids in ids_by_type.items():
                if not deleted_ids:
                    continue
                story_version_before.extend(
                    snapshot_rows(
                        db.query(ObjectVersion)
                        .filter(
                            ObjectVersion.object_type == deleted_type,
                            ObjectVersion.object_id.in_(list(deleted_ids)),
                        )
                        .all(),
                        snapshot_object_version_row,
                    )
                )

            owned_assets: list[Asset] = []
            if entity_ids:
                owned_assets = (
                    db.query(Asset)
                    .join(StoryObjectAsset, StoryObjectAsset.asset_id == Asset.id)
                    .filter(
                        StoryObjectAsset.object_type == STORY_ENTITY_TYPE,
                        StoryObjectAsset.object_id.in_(entity_ids),
                    )
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
                delete_assets_with_files(
                    db,
                    assets=owned_assets,
                    scrub_references_in_project_id=resolved_project_id,
                )

            delete_semantic_sources_bulk(
                db,
                user_id=user_id,
                project_id=resolved_project_id,
                ids_by_type=ids_by_type,
            )
            delete_object_versions_bulk(db, ids_by_type=ids_by_type)

            for deleted_type, deleted_ids in ids_by_type.items():
                for deleted_id in set(deleted_ids):
                    queue_object_change(
                        db,
                        user_id=user_id,
                        project_id=resolved_project_id,
                        object_type=deleted_type,
                        object_id=deleted_id,
                        action="deleted",
                    )

            if entity_ids:
                (
                    db.query(StoryEntity)
                    .filter(StoryEntity.project_id == project_id, StoryEntity.id.in_(entity_ids))
                    .delete(synchronize_session=False)
                )

            delete_story_entity_folder_rows(
                db,
                project_id=project_id,
                folder_ids=folder_ids,
            )
            normalize_story_entity_parent(
                db,
                project_id=project_id,
                parent_folder_id=getattr(obj, "parent_id", None),
            )

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
                    build_asset_rows_delta(deleted_asset_before, []),
                    build_asset_rows_delta(remaining_ref_assets_before, remaining_ref_assets_after),
                ],
                enforce_quota=False,
            )
            return

        ids_by_type: dict[str, list[UUID]] = {storage_type: [object_id]}

        if storage_type == "outline":
            subtree = collect_outline_subtree_object_ids(db, outline_id=object_id)
            for k, v in subtree.items():
                ids_by_type.setdefault(k, []).extend(v)

        story_core_before: list[object] = []
        for model_class, key in (
            (BasicInfo, "basic_info"),
            (StoryEntity, STORY_ENTITY_TYPE),
            (Outline, "outline"),
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
        if storage_type in {"basic_info", STORY_ENTITY_TYPE}:
            owned_assets = (
                db.query(Asset)
                .join(StoryObjectAsset, StoryObjectAsset.asset_id == Asset.id)
                .filter(StoryObjectAsset.object_type == storage_type, StoryObjectAsset.object_id == object_id)
                .all()
            )
        elif storage_type == "manuscript":
            owned_assets = (
                db.query(Asset)
                .filter(Asset.project_id == resolved_project_id, Asset.manuscript_id == object_id)
                .all()
            )
        elif storage_type == "outline" and manuscript_ids:
            owned_assets = (
                db.query(Asset)
                .filter(Asset.project_id == resolved_project_id, Asset.manuscript_id.in_(list(manuscript_ids)))
                .all()
            )

        old_story_entity_parent_id = obj.folder_id if storage_type == STORY_ENTITY_TYPE else None
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

        delete_semantic_sources_bulk(db, user_id=user_id, project_id=resolved_project_id, ids_by_type=ids_by_type)
        delete_object_versions_bulk(db, ids_by_type=ids_by_type)

        for deleted_type, deleted_ids in ids_by_type.items():
            for deleted_id in set(deleted_ids):
                queue_object_change(
                    db,
                    user_id=user_id,
                    project_id=resolved_project_id,
                    object_type=deleted_type,
                    object_id=deleted_id,
                    action="deleted",
                )

        db.delete(obj)
        db.flush()
        if storage_type == STORY_ENTITY_TYPE:
            normalize_story_entity_parent(
                db,
                project_id=project_id,
                parent_folder_id=old_story_entity_parent_id,
            )
        elif storage_type == "outline":
            normalize_outline_positions(db, project_id=project_id, parent_id=getattr(obj, "parent_id", None))
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

    def get_object(self, db: Session, object_type: str, object_id: UUID, *, project_id: UUID, language: str | None = None) -> dict[str, Any] | None:
        t = normalize_object_type(object_type)
        obj = _load_owned_object(db, project_id, t, object_id)
        if obj is None:
            return None
        return _serialize_object(db, _canonical_object_type(t), obj, language)

    def list_objects(
        self,
        db: Session,
        project_id: UUID,
        object_type: str,
        *,
        language: str | None = None,
        kinds: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        t = normalize_object_type(object_type)
        storage_type = _canonical_object_type(t)
        model_class = _model_for_object_type(t)

        query = db.query(model_class)
        if storage_type in {"basic_info", "guidelines", STORY_ENTITY_FOLDER_TYPE, STORY_ENTITY_TYPE}:
            query = query.filter(model_class.project_id == project_id)
            if storage_type == STORY_ENTITY_FOLDER_TYPE:
                query = query.order_by(StoryEntityFolder.parent_id.asc().nullsfirst(), StoryEntityFolder.display_order.asc())
            elif storage_type == STORY_ENTITY_TYPE:
                if kinds:
                    query = query.filter(StoryEntity.kind.in_([require_story_entity_kind(kind) for kind in kinds]))
                query = query.order_by(StoryEntity.display_order.asc())
        elif storage_type == "outline":
            query = (
                db.query(Outline)
                .filter(Outline.project_id == project_id)
                .options(joinedload(Outline.manuscript), joinedload(Outline.parent))
                .order_by(Outline.position.asc(), Outline.created_at.asc(), Outline.id.asc())
            )
            if kinds:
                query = query.filter(Outline.kind.in_([require_outline_kind(kind) for kind in kinds]))
        elif storage_type == "manuscript":
            query = (
                db.query(Manuscript)
                .join(Outline, Outline.id == Manuscript.chapter_id)
                .filter(Outline.project_id == project_id, Outline.kind == "chapter")
                .options(joinedload(Manuscript.chapter).joinedload(Outline.parent).joinedload(Outline.parent))
            )

        rows = query.all()
        return [_serialize_object(db, storage_type, row, language) for row in rows]

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
        allowed = {"basic_info", STORY_ENTITY_TYPE}
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
            user_id=user_id or _resolve_project_user_id(db, project_id=project_id),
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
        user_id: UUID | None = None,
    ) -> int:
        t = normalize_object_type(object_type)
        storage_type = _canonical_object_type(t)
        if storage_type != "outline":
            raise ValueError(f"Reordering not supported for {t}")
        event_user_id = user_id or _resolve_project_user_id(db, project_id=project_id)
        if not object_ids:
            return 0

        rows = (
            db.query(Outline)
            .filter(Outline.id.in_(object_ids), Outline.project_id == project_id)
            .all()
        )
        if len(rows) != len(object_ids):
            raise ValueError("One or more outline objects not found in project")
        parent_ids = {row.parent_id for row in rows}
        if len(parent_ids) != 1:
            raise ValueError("All reordered outline objects must share the same parent")

        changed_ids: list[UUID] = []
        for index, object_id in enumerate(object_ids):
            obj = next((row for row in rows if row.id == object_id), None)
            if obj is None:
                raise ValueError(f"Object {object_id} not found in project")
            obj.position = index
            obj.updated_at = datetime.utcnow()
            changed_ids.append(object_id)

        db.flush()
        for changed_id in changed_ids:
            queue_object_change(
                db,
                user_id=event_user_id,
                project_id=project_id,
                object_type="outline",
                object_id=changed_id,
                action="updated",
            )
        return len(object_ids)


object_service = ObjectService()
