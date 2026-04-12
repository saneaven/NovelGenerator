from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.db_models import StoryEntity, StoryEntityFolder
from ..models.translation_models import ObjectVersion, ObjectVersionLanguage
from ..utils.story_entities import STORY_ENTITY_FOLDER_TYPE
from .object_version_language_service import latest_parents_for_object_ids, payload_map_from_rows, provenance_map_for_versions


NodeKind = Literal["folder", "entity"]


@dataclass
class _SiblingNode:
    node_kind: NodeKind
    row: StoryEntityFolder | StoryEntity
    display_order: int

    @property
    def node_id(self) -> UUID:
        return self.row.id


def _sort_key(node: _SiblingNode) -> tuple[int, str]:
    kind_weight = 0 if node.node_kind == "folder" else 1
    return (int(node.display_order or 0), f"{kind_weight}:{node.node_id}")


def _load_parent_siblings(
    db: Session,
    *,
    project_id: UUID,
    parent_folder_id: UUID | None,
) -> list[_SiblingNode]:
    folders = (
        db.query(StoryEntityFolder)
        .filter(
            StoryEntityFolder.project_id == project_id,
            StoryEntityFolder.parent_id == parent_folder_id,
        )
        .all()
    )
    entities = (
        db.query(StoryEntity)
        .filter(
            StoryEntity.project_id == project_id,
            StoryEntity.folder_id == parent_folder_id,
        )
        .all()
    )
    nodes = [
        *[_SiblingNode(node_kind="folder", row=row, display_order=int(row.display_order or 0)) for row in folders],
        *[_SiblingNode(node_kind="entity", row=row, display_order=int(row.display_order or 0)) for row in entities],
    ]
    nodes.sort(key=_sort_key)
    return nodes


def _normalize_parent_siblings(
    db: Session,
    *,
    project_id: UUID,
    parent_folder_id: UUID | None,
) -> None:
    siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=parent_folder_id)
    for index, node in enumerate(siblings):
        if int(node.row.display_order or 0) != index:
            node.row.display_order = index
    db.flush()


def _insert_node(
    nodes: list[_SiblingNode],
    *,
    node: _SiblingNode,
    new_index: int | None,
) -> None:
    if new_index is None:
        nodes.append(node)
        return
    bounded_index = max(0, min(int(new_index), len(nodes)))
    nodes.insert(bounded_index, node)


def _persist_node_list(nodes: list[_SiblingNode]) -> None:
    for index, node in enumerate(nodes):
        node.row.display_order = index


def require_story_entity_folder(
    db: Session,
    *,
    project_id: UUID,
    folder_id: UUID,
) -> StoryEntityFolder:
    folder = (
        db.query(StoryEntityFolder)
        .filter(StoryEntityFolder.id == folder_id, StoryEntityFolder.project_id == project_id)
        .first()
    )
    if folder is None:
        raise HTTPException(status_code=404, detail="Story entity folder not found")
    return folder


def ensure_valid_parent_folder(
    db: Session,
    *,
    project_id: UUID,
    folder_id: UUID | None,
) -> StoryEntityFolder | None:
    if folder_id is None:
        return None
    return require_story_entity_folder(db, project_id=project_id, folder_id=folder_id)


def list_story_entity_folders(
    db: Session,
    *,
    project_id: UUID,
) -> list[StoryEntityFolder]:
    rows = (
        db.query(StoryEntityFolder)
        .filter(StoryEntityFolder.project_id == project_id)
        .order_by(StoryEntityFolder.parent_id.asc().nullsfirst(), StoryEntityFolder.display_order.asc())
        .all()
    )
    return rows


def _resolve_folder_lang_data(
    data: dict[str, Any],
    *,
    language: str | None,
    fallback_language: str | None = None,
) -> dict[str, str]:
    if language and isinstance(data.get(language), dict):
        lang_data = data[language]
        return {
            "name": str(lang_data.get("name") or ""),
            "description": str(lang_data.get("description") or ""),
        }
    if fallback_language and isinstance(data.get(fallback_language), dict):
        lang_data = data[fallback_language]
        return {
            "name": str(lang_data.get("name") or ""),
            "description": str(lang_data.get("description") or ""),
        }
    for value in data.values():
        if isinstance(value, dict):
            return {
                "name": str(value.get("name") or ""),
                "description": str(value.get("description") or ""),
            }
    return {"name": "", "description": ""}


def _latest_story_entity_folder_versions(
    db: Session,
    *,
    folder_ids: list[UUID],
) -> dict[UUID, tuple[ObjectVersion, list[ObjectVersionLanguage]]]:
    if not folder_ids:
        return {}
    parents = latest_parents_for_object_ids(
        db,
        object_type=STORY_ENTITY_FOLDER_TYPE,
        object_ids=folder_ids,
    )
    version_ids = [row.id for row in parents if isinstance(row.id, UUID)]
    rows = (
        db.query(ObjectVersionLanguage)
        .filter(ObjectVersionLanguage.version_id.in_(version_ids))
        .order_by(ObjectVersionLanguage.created_at.asc())
        .all()
        if version_ids
        else []
    )
    rows_by_version_id: dict[UUID, list[ObjectVersionLanguage]] = {}
    for row in rows:
        rows_by_version_id.setdefault(row.version_id, []).append(row)
    return {row.object_id: (row, rows_by_version_id.get(row.id, [])) for row in parents}


def build_story_entity_folder_content_map(
    db: Session,
    *,
    project_id: UUID,
    language: str | None = None,
    fallback_language: str | None = None,
) -> dict[UUID, dict[str, Any]]:
    folders = list_story_entity_folders(db, project_id=project_id)
    latest_by_id = _latest_story_entity_folder_versions(
        db,
        folder_ids=[folder.id for folder in folders if isinstance(folder.id, UUID)],
    )
    payload: dict[UUID, dict[str, Any]] = {}
    provenance_by_version_id = provenance_map_for_versions(
        db,
        [version.id for version, _rows in latest_by_id.values()],
    )
    for folder in folders:
        latest_entry = latest_by_id.get(folder.id)
        latest = latest_entry[0] if latest_entry is not None else None
        rows = latest_entry[1] if latest_entry is not None else []
        data = payload_map_from_rows(rows)
        lang_data = _resolve_folder_lang_data(
            data,
            language=language,
            fallback_language=fallback_language,
        )
        version_created_at = None
        if latest is not None:
            provenance = provenance_by_version_id.get(latest.id)
            version_created_at = provenance.created_at if provenance is not None else latest.created_at
        payload[folder.id] = {
            "name": lang_data["name"],
            "description": lang_data["description"],
            "data": data,
            "version": {
                "id": str(latest.id) if latest is not None else None,
                "number": int(latest.version_number) if latest is not None else 0,
                "created_at": version_created_at.isoformat() if version_created_at else None,
            },
        }
    return payload


def serialize_story_entity_folder(
    folder: StoryEntityFolder,
    *,
    content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    serialized: dict[str, Any] = {
        "id": str(folder.id),
        "project_id": str(folder.project_id),
        "parent_id": str(folder.parent_id) if folder.parent_id else None,
        "display_order": int(folder.display_order or 0),
        "created_at": folder.created_at.isoformat() if folder.created_at else None,
        "updated_at": folder.updated_at.isoformat() if folder.updated_at else None,
    }
    if content is not None:
        serialized["name"] = str(content.get("name") or "")
        serialized["description"] = str(content.get("description") or "")
        serialized["data"] = content.get("data") if isinstance(content.get("data"), dict) else {}
        serialized["version"] = content.get("version") if isinstance(content.get("version"), dict) else {
            "id": None,
            "number": 0,
            "created_at": None,
        }
    return serialized


def create_story_entity_folder(
    db: Session,
    *,
    project_id: UUID,
    parent_id: UUID | None,
) -> StoryEntityFolder:
    ensure_valid_parent_folder(db, project_id=project_id, folder_id=parent_id)
    siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=parent_id)
    folder = StoryEntityFolder(
        project_id=project_id,
        parent_id=parent_id,
        display_order=len(siblings),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(folder)
    db.flush()
    return folder


def next_story_entity_sibling_order(
    db: Session,
    *,
    project_id: UUID,
    parent_folder_id: UUID | None,
) -> int:
    return len(_load_parent_siblings(db, project_id=project_id, parent_folder_id=parent_folder_id))


def move_story_entity(
    db: Session,
    *,
    project_id: UUID,
    entity_id: UUID,
    new_parent_folder_id: UUID | None,
    new_index: int | None,
) -> StoryEntity:
    entity = (
        db.query(StoryEntity)
        .filter(StoryEntity.id == entity_id, StoryEntity.project_id == project_id)
        .first()
    )
    if entity is None:
        raise HTTPException(status_code=404, detail="Story entity not found")
    ensure_valid_parent_folder(db, project_id=project_id, folder_id=new_parent_folder_id)

    old_parent_folder_id = entity.folder_id
    if old_parent_folder_id == new_parent_folder_id:
        siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=old_parent_folder_id)
        siblings = [node for node in siblings if not (node.node_kind == "entity" and node.node_id == entity.id)]
        _insert_node(
            siblings,
            node=_SiblingNode(node_kind="entity", row=entity, display_order=int(entity.display_order or 0)),
            new_index=new_index,
        )
        _persist_node_list(siblings)
        entity.updated_at = datetime.utcnow()
        db.flush()
        return entity

    source_siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=old_parent_folder_id)
    source_siblings = [node for node in source_siblings if not (node.node_kind == "entity" and node.node_id == entity.id)]
    _persist_node_list(source_siblings)

    entity.folder_id = new_parent_folder_id
    entity.updated_at = datetime.utcnow()
    target_siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=new_parent_folder_id)
    target_siblings = [node for node in target_siblings if not (node.node_kind == "entity" and node.node_id == entity.id)]
    _insert_node(
        target_siblings,
        node=_SiblingNode(node_kind="entity", row=entity, display_order=int(entity.display_order or 0)),
        new_index=new_index,
    )
    _persist_node_list(target_siblings)
    db.flush()
    return entity


def _collect_folder_ancestor_ids(
    db: Session,
    *,
    project_id: UUID,
    folder_id: UUID | None,
) -> set[UUID]:
    ancestors: set[UUID] = set()
    current_id = folder_id
    while current_id is not None:
        if current_id in ancestors:
            break
        ancestors.add(current_id)
        current = require_story_entity_folder(db, project_id=project_id, folder_id=current_id)
        current_id = current.parent_id
    return ancestors


def move_story_entity_folder(
    db: Session,
    *,
    project_id: UUID,
    folder_id: UUID,
    new_parent_folder_id: UUID | None,
    new_index: int | None,
) -> StoryEntityFolder:
    folder = require_story_entity_folder(db, project_id=project_id, folder_id=folder_id)
    ensure_valid_parent_folder(db, project_id=project_id, folder_id=new_parent_folder_id)

    if new_parent_folder_id == folder.id:
        raise HTTPException(status_code=400, detail="Folder cannot be its own parent")
    if new_parent_folder_id is not None:
        ancestor_ids = _collect_folder_ancestor_ids(db, project_id=project_id, folder_id=new_parent_folder_id)
        if folder.id in ancestor_ids:
            raise HTTPException(status_code=400, detail="Folder move would create a cycle")

    old_parent_id = folder.parent_id
    if old_parent_id == new_parent_folder_id:
        siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=old_parent_id)
        siblings = [node for node in siblings if not (node.node_kind == "folder" and node.node_id == folder.id)]
        _insert_node(
            siblings,
            node=_SiblingNode(node_kind="folder", row=folder, display_order=int(folder.display_order or 0)),
            new_index=new_index,
        )
        _persist_node_list(siblings)
        folder.updated_at = datetime.utcnow()
        db.flush()
        return folder

    source_siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=old_parent_id)
    source_siblings = [node for node in source_siblings if not (node.node_kind == "folder" and node.node_id == folder.id)]
    _persist_node_list(source_siblings)

    folder.parent_id = new_parent_folder_id
    folder.updated_at = datetime.utcnow()
    target_siblings = _load_parent_siblings(db, project_id=project_id, parent_folder_id=new_parent_folder_id)
    target_siblings = [node for node in target_siblings if not (node.node_kind == "folder" and node.node_id == folder.id)]
    _insert_node(
        target_siblings,
        node=_SiblingNode(node_kind="folder", row=folder, display_order=int(folder.display_order or 0)),
        new_index=new_index,
    )
    _persist_node_list(target_siblings)
    db.flush()
    return folder


def build_story_entity_folder_path_map(
    db: Session,
    *,
    project_id: UUID,
    language: str | None = None,
    fallback_language: str | None = None,
) -> dict[UUID, list[str]]:
    folders = list_story_entity_folders(db, project_id=project_id)
    folder_map = {folder.id: folder for folder in folders}
    content_map = build_story_entity_folder_content_map(
        db,
        project_id=project_id,
        language=language,
        fallback_language=fallback_language,
    )
    path_map: dict[UUID, list[str]] = {}

    def _resolve_path(folder: StoryEntityFolder) -> list[str]:
        label = str(content_map.get(folder.id, {}).get("name") or "")
        if folder.id in path_map:
            return path_map[folder.id]
        if folder.parent_id is None:
            path_map[folder.id] = [label]
            return path_map[folder.id]
        parent = folder_map.get(folder.parent_id)
        if parent is None:
            path_map[folder.id] = [label]
            return path_map[folder.id]
        path_map[folder.id] = [*_resolve_path(parent), label]
        return path_map[folder.id]

    for folder in folders:
        _resolve_path(folder)
    return path_map


def collect_descendant_folder_ids(
    db: Session,
    *,
    project_id: UUID,
    folder_id: UUID,
) -> list[UUID]:
    folders = list_story_entity_folders(db, project_id=project_id)
    by_parent: dict[UUID | None, list[StoryEntityFolder]] = {}
    for folder in folders:
        by_parent.setdefault(folder.parent_id, []).append(folder)

    ordered: list[UUID] = []

    def _walk(current_id: UUID) -> None:
        ordered.append(current_id)
        for child in sorted(by_parent.get(current_id, []), key=lambda row: int(row.display_order or 0)):
            _walk(child.id)

    _walk(folder_id)
    return ordered


def collect_descendant_story_entity_ids(
    db: Session,
    *,
    project_id: UUID,
    folder_ids: list[UUID],
) -> list[UUID]:
    if not folder_ids:
        return []
    rows = (
        db.query(StoryEntity.id)
        .filter(StoryEntity.project_id == project_id, StoryEntity.folder_id.in_(folder_ids))
        .all()
    )
    return [row[0] for row in rows if isinstance(row[0], UUID)]


def delete_story_entity_folder_rows(
    db: Session,
    *,
    project_id: UUID,
    folder_ids: list[UUID],
) -> None:
    if not folder_ids:
        return
    for folder_id in reversed(folder_ids):
        (
            db.query(StoryEntityFolder)
            .filter(StoryEntityFolder.project_id == project_id, StoryEntityFolder.id == folder_id)
            .delete(synchronize_session=False)
        )
    db.flush()


def normalize_story_entity_parent(
    db: Session,
    *,
    project_id: UUID,
    parent_folder_id: UUID | None,
) -> None:
    _normalize_parent_siblings(db, project_id=project_id, parent_folder_id=parent_folder_id)
