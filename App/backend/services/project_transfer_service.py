"""Project export/import service (.nbproj).

This service is intentionally self-contained so routes stay thin.
"""

from __future__ import annotations

import json
import io
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from uuid import UUID, uuid4

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, joinedload

from ..models.db_models import (
    Act,
    Asset,
    BasicInfo,
    Chapter,
    Character,
    Guidelines,
    Location,
    LorebookEntry,
    Manuscript,
    ManuscriptImage,
    Organization,
    Outline,
    Project,
    StoryObjectAsset,
    User,
)
from ..models.translation_models import ObjectVersion
from ..schemas.project_transfer import ProjectExportOptions
from ..services.image_model_catalog_service import sanitize_generation_settings
from ..services.manuscript_image_index_service import rebuild_manuscript_images_for_language
from ..services.ownership import require_owned_project
from ..services.storage_service import storage_service
from ..services.storage_usage_service import (
    StorageQuotaExceededError,
    recalculate_project_usage_and_enforce_quota,
)
from ..utils.object_type_aliases import externalize_object_type, normalize_object_type


FORMAT_VERSION = "1.0"


def _dt_to_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    # DB stores naive UTC timestamps; serialize as ISO8601 with Z for portability.
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _iso_to_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    v = value.strip()
    try:
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        parsed = datetime.fromisoformat(v)
    except Exception:
        raise ValueError(f"Invalid datetime format: {value}")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)


def _sanitize_filename_component(value: str) -> str:
    cleaned = re.sub(r"[^\w\- ]+", "", value, flags=re.UNICODE).strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned or "project"


def _validate_uuid_list(raw_ids: Iterable[str]) -> List[UUID]:
    out: List[UUID] = []
    for raw in raw_ids:
        try:
            out.append(UUID(str(raw)))
        except Exception:
            raise ValueError(f"Invalid UUID: {raw}")
    return out


def _validate_zip_paths(zf: zipfile.ZipFile) -> None:
    for name in zf.namelist():
        # Block absolute paths, traversal, and drive prefixes.
        if not name or name.startswith("/") or name.startswith("\\") or ":" in name:
            raise ValueError("Invalid archive path")
        parts = Path(name).parts
        if any(p == ".." for p in parts):
            raise ValueError("Invalid archive path")


def _latest_versions_by_object_id(db: Session, object_type: str, object_ids: List[UUID]) -> Dict[UUID, ObjectVersion]:
    if not object_ids:
        return {}

    subq = (
        db.query(
            ObjectVersion.object_id.label("object_id"),
            func.max(ObjectVersion.version_number).label("max_version"),
        )
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id.in_(object_ids))
        .group_by(ObjectVersion.object_id)
        .subquery()
    )

    rows = (
        db.query(ObjectVersion)
        .join(
            subq,
            and_(
                ObjectVersion.object_id == subq.c.object_id,
                ObjectVersion.version_number == subq.c.max_version,
            ),
        )
        .filter(ObjectVersion.object_type == object_type)
        .all()
    )

    return {row.object_id: row for row in rows}


def _extract_reference_image_ids(asset: Asset) -> List[UUID]:
    refs = asset.generation_reference_images
    if not isinstance(refs, list):
        return []

    out: List[UUID] = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        raw = ref.get("asset_id")
        if not raw:
            continue
        try:
            out.append(UUID(str(raw)))
        except Exception:
            continue
    return out


def _rewrite_tip_tap_doc_images(
    doc: Any,
    export_asset_id_to_new_asset_id: Dict[str, str],
    new_file_url_by_new_asset_id: Dict[str, str],
) -> Any:
    if not isinstance(doc, dict):
        return doc

    def walk(node: Any) -> Any:
        if not isinstance(node, dict):
            return node

        node_type = node.get("type")
        if node_type == "image":
            attrs = node.get("attrs")
            if isinstance(attrs, dict):
                raw_asset_id = attrs.get("data-asset-id") or attrs.get("assetId")
                if raw_asset_id is not None:
                    new_asset_id = export_asset_id_to_new_asset_id.get(str(raw_asset_id))
                    if new_asset_id:
                        next_attrs = dict(attrs)
                        next_attrs["data-asset-id"] = new_asset_id
                        next_attrs.pop("assetId", None)
                        new_src = new_file_url_by_new_asset_id.get(new_asset_id)
                        if new_src:
                            next_attrs["src"] = new_src
                        return {**node, "attrs": next_attrs}
            return node

        content = node.get("content")
        if isinstance(content, list):
            return {**node, "content": [walk(child) for child in content]}
        return node

    return walk(doc)

class ProjectTransferService:
    @staticmethod
    def build_export_preview(
        db: Session,
        user_id: UUID,
        project_id: UUID,
        options: ProjectExportOptions,
    ) -> Dict[str, Any]:
        require_owned_project(db, user_id=user_id, project_id=project_id)

        assets: List[Asset] = (
            db.query(Asset)
            .filter(Asset.project_id == project_id)
            .order_by(Asset.created_at.desc())
            .all()
        )
        assets_by_id: Dict[UUID, Asset] = {a.id: a for a in assets}

        used_ids: Set[UUID] = set()
        reasons: Dict[UUID, Set[str]] = {}

        def add_reason(asset_id: UUID, reason: str) -> None:
            reasons.setdefault(asset_id, set()).add(reason)

        # 1) Used in manuscripts (TipTap image nodes indexed into manuscript_images)
        used_in_manuscripts_rows = (
            db.query(ManuscriptImage.asset_id)
            .join(Asset, Asset.id == ManuscriptImage.asset_id)
            .filter(Asset.project_id == project_id, ManuscriptImage.asset_id.isnot(None))
            .distinct()
            .all()
        )
        for (asset_id,) in used_in_manuscripts_rows:
            if not asset_id:
                continue
            used_ids.add(asset_id)
            add_reason(asset_id, "manuscript_image")

        # 2) Story object images (main-only by default, configurable)
        story_links_query = (
            db.query(StoryObjectAsset.asset_id, StoryObjectAsset.is_main)
            .join(Asset, Asset.id == StoryObjectAsset.asset_id)
            .filter(Asset.project_id == project_id)
        )
        if not options.include_non_main_story_object_images:
            story_links_query = story_links_query.filter(StoryObjectAsset.is_main == True)

        for asset_id, is_main in story_links_query.all():
            if not asset_id:
                continue
            used_ids.add(asset_id)
            add_reason(asset_id, "story_object_main" if is_main else "story_object_linked")

        # 3) Generation reference images (optional, recursive)
        if options.treat_generation_reference_images_as_used and used_ids:
            queue: List[UUID] = list(used_ids)
            visited: Set[UUID] = set(queue)
            while queue:
                current = queue.pop()
                src_asset = assets_by_id.get(current)
                if not src_asset:
                    continue
                for target in _extract_reference_image_ids(src_asset):
                    if target not in assets_by_id or target in visited:
                        continue
                    visited.add(target)
                    used_ids.add(target)
                    add_reason(target, "generation_reference_image")
                    queue.append(target)

        # Determine selection + default selection for UI.
        if not options.include_images:
            selected_ids: Set[UUID] = set()
            default_selected: List[str] = []
        elif options.image_scope == "used_only":
            selected_ids = set(used_ids)
            default_selected = [str(a_id) for a_id in selected_ids]
        elif options.image_scope == "all":
            selected_ids = set(assets_by_id.keys())
            default_selected = [str(a_id) for a_id in selected_ids]
        else:  # manual
            selected_ids = set()
            default_selected = [str(a_id) for a_id in used_ids]

        def to_preview_item(asset: Asset) -> Dict[str, Any]:
            return {
                "asset_id": str(asset.id),
                "name": str(asset.name),
                "asset_type": asset.asset_type,
                "file_size": asset.file_size,
                "file_url": storage_service.build_public_asset_path(str(asset.file_path)),
                "used": asset.id in used_ids,
                "reasons": sorted(reasons.get(asset.id, set())),
            }

        if not options.include_images:
            preview_assets: List[Dict[str, Any]] = []
        elif options.image_scope == "used_only":
            preview_assets = [to_preview_item(assets_by_id[a_id]) for a_id in selected_ids if a_id in assets_by_id]
        else:
            preview_assets = [to_preview_item(a) for a in assets]

        images_selected_bytes = 0
        if options.include_images and selected_ids:
            for a_id in selected_ids:
                a = assets_by_id.get(a_id)
                if a and isinstance(a.file_size, int):
                    images_selected_bytes += int(a.file_size)

        objects_count = ProjectTransferService._count_project_objects(db=db, project_id=project_id)

        return {
            "summary": {
                "objects": objects_count,
                "assets_total": len(assets),
                "assets_selected": len(selected_ids) if options.include_images else 0,
                "images_selected_bytes": images_selected_bytes if options.include_images else 0,
            },
            "assets": preview_assets,
            "default_selected_asset_ids": default_selected,
        }

    @staticmethod
    def _count_project_objects(db: Session, project_id: UUID) -> int:
        counts = 0
        counts += db.query(BasicInfo).filter(BasicInfo.project_id == project_id).count()
        counts += db.query(Guidelines).filter(Guidelines.project_id == project_id).count()
        counts += db.query(Character).filter(Character.project_id == project_id).count()
        counts += db.query(Organization).filter(Organization.project_id == project_id).count()
        counts += db.query(Location).filter(Location.project_id == project_id).count()
        counts += db.query(LorebookEntry).filter(LorebookEntry.project_id == project_id).count()
        counts += db.query(Outline).filter(Outline.project_id == project_id).count()
        counts += (
            db.query(Act)
            .join(Outline, Act.outline_id == Outline.id)
            .filter(Outline.project_id == project_id)
            .count()
        )
        counts += (
            db.query(Chapter)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .filter(Outline.project_id == project_id)
            .count()
        )
        counts += (
            db.query(Manuscript)
            .join(Chapter, Manuscript.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .filter(Outline.project_id == project_id)
            .count()
        )
        return int(counts)

    @staticmethod
    def export_project_to_nbproj(
        db: Session,
        user_id: UUID,
        project_id: UUID,
        options: ProjectExportOptions,
        manual_asset_ids: Optional[List[str]] = None,
    ) -> Tuple[str, str]:
        project = require_owned_project(db, user_id=user_id, project_id=project_id)

        preview = ProjectTransferService.build_export_preview(
            db=db, user_id=user_id, project_id=project_id, options=options
        )

        selected_asset_ids: List[UUID]
        if not options.include_images:
            selected_asset_ids = []
        elif options.image_scope in {"used_only", "all"}:
            selected_asset_ids = _validate_uuid_list(preview["default_selected_asset_ids"])
        else:
            if not manual_asset_ids:
                raise ValueError("asset_ids is required when image_scope is 'manual'")
            selected_asset_ids = _validate_uuid_list(manual_asset_ids)

            # Optional: expand with reference images
            if options.treat_generation_reference_images_as_used and selected_asset_ids:
                assets = db.query(Asset).filter(Asset.project_id == project_id).all()
                assets_by_id = {a.id: a for a in assets}
                queue: List[UUID] = list(selected_asset_ids)
                visited: Set[UUID] = set(queue)
                while queue:
                    current = queue.pop()
                    src = assets_by_id.get(current)
                    if not src:
                        continue
                    for target in _extract_reference_image_ids(src):
                        if target not in assets_by_id or target in visited:
                            continue
                        visited.add(target)
                        selected_asset_ids.append(target)
                        queue.append(target)

        selected_set: Set[UUID] = set(selected_asset_ids)

        selected_assets: List[Asset] = []
        if options.include_images and selected_set:
            selected_assets = (
                db.query(Asset)
                .filter(Asset.project_id == project_id, Asset.id.in_(list(selected_set)))
                .order_by(Asset.created_at.desc())
                .all()
            )

        links: List[StoryObjectAsset] = []
        if options.include_images and selected_set:
            links = (
                db.query(StoryObjectAsset)
                .join(Asset, Asset.id == StoryObjectAsset.asset_id)
                .filter(Asset.project_id == project_id, StoryObjectAsset.asset_id.in_(list(selected_set)))
                .order_by(StoryObjectAsset.created_at.asc())
                .all()
            )

        objects_payload = ProjectTransferService._build_objects_payload(db=db, project_id=project_id)

        assets_payload: Optional[Dict[str, Any]] = None
        if options.include_images:
            assets_payload = {"assets": [ProjectTransferService._asset_to_export_dict(a) for a in selected_assets]}

        links_payload = {
            "links": [
                {
                    "object_type": externalize_object_type(str(link.object_type)),
                    "object_id": str(link.object_id),
                    "asset_id": str(link.asset_id),
                    "is_main": bool(link.is_main),
                    "display_order": int(link.display_order),
                    "created_at": _dt_to_iso(link.created_at),
                }
                for link in links
                if link.asset_id in selected_set
            ]
        }

        exported_at = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        counts = {
            "objects": int(preview["summary"]["objects"]),
            "assets": len(selected_assets) if options.include_images else 0,
            "images_total_bytes": int(preview["summary"]["images_selected_bytes"]) if options.include_images else 0,
        }

        manifest = {
            "format_version": FORMAT_VERSION,
            "exported_at": exported_at,
            "app": {"name": "Novel Buds", "version": "2.0.0"},
            "project": {"name": project.name, "description": project.description},
            "options": options.model_dump(),
            "counts": counts,
        }

        project_payload = {
            "name": project.name,
            "description": project.description,
            "created_at": _dt_to_iso(project.created_at),
            "updated_at": _dt_to_iso(project.updated_at),
        }

        filename = f"{_sanitize_filename_component(project.name)}_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.nbproj"

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".nbproj")
        tmp_path = tmp.name
        tmp.close()

        with zipfile.ZipFile(tmp_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", _json_dumps(manifest))
            zf.writestr("data/project.json", _json_dumps(project_payload))
            zf.writestr("data/objects.json", _json_dumps(objects_payload))
            zf.writestr("data/links_story_object_assets.json", _json_dumps(links_payload))

            if options.include_images and assets_payload is not None:
                zf.writestr("data/assets.json", _json_dumps(assets_payload))
                for asset in selected_assets:
                    ext = Path(str(asset.file_path)).suffix or ".png"
                    arc_path = f"images/originals/{asset.id}{ext}"
                    zf.writestr(arc_path, storage_service.read_asset_file(str(asset.file_path)))

        return tmp_path, filename

    @staticmethod
    def _asset_to_export_dict(asset: Asset) -> Dict[str, Any]:
        ext = Path(str(asset.file_path)).suffix or ".png"
        return {
            "id": str(asset.id),
            "name": str(asset.name),
            "asset_type": asset.asset_type,
            "manuscript_id": str(asset.manuscript_id) if asset.manuscript_id is not None else None,
            "created_at": _dt_to_iso(asset.created_at),
            "updated_at": _dt_to_iso(asset.updated_at),
            "mime_type": asset.mime_type,
            "original_ext": ext,
            "generation": {
                "prompt": asset.generation_prompt,
                "positive_prompt": asset.generation_positive_prompt,
                "negative_prompt": asset.generation_negative_prompt,
                "provider": asset.generation_provider,
                "model": asset.generation_model,
                "settings": asset.generation_settings,
                "reference_images": asset.generation_reference_images,
                "reference_objects": asset.generation_reference_objects,
            },
        }

    @staticmethod
    def _build_objects_payload(db: Session, project_id: UUID) -> Dict[str, Any]:
        outlines: List[Outline] = (
            db.query(Outline)
            .options(joinedload(Outline.acts).joinedload(Act.chapters).joinedload(Chapter.manuscript))
            .filter(Outline.project_id == project_id)
            .order_by(Outline.order.asc())
            .all()
        )

        basic_infos = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).all()
        guidelines = db.query(Guidelines).filter(Guidelines.project_id == project_id).all()
        characters = db.query(Character).filter(Character.project_id == project_id).order_by(Character.order.asc()).all()
        organizations = (
            db.query(Organization).filter(Organization.project_id == project_id).order_by(Organization.order.asc()).all()
        )
        locations = db.query(Location).filter(Location.project_id == project_id).order_by(Location.order.asc()).all()
        lorebook_entries = (
            db.query(LorebookEntry)
            .filter(LorebookEntry.project_id == project_id)
            .order_by(LorebookEntry.order.asc())
            .all()
        )

        objects: List[Tuple[str, Any]] = []
        objects.extend([("basic_info", o) for o in basic_infos])
        objects.extend([("guidelines", o) for o in guidelines])
        objects.extend([("character", o) for o in characters])
        objects.extend([("organization", o) for o in organizations])
        objects.extend([("location", o) for o in locations])
        objects.extend([("lorebook", o) for o in lorebook_entries])

        for outline in outlines:
            objects.append(("outline", outline))
            for act in outline.acts:
                objects.append(("act", act))
                for chapter in act.chapters:
                    objects.append(("chapter", chapter))
                    if chapter.manuscript is not None:
                        objects.append(("manuscript", chapter.manuscript))

        ids_by_type: Dict[str, List[UUID]] = {}
        for obj_type, obj in objects:
            ids_by_type.setdefault(obj_type, []).append(obj.id)

        latest_versions: Dict[Tuple[str, UUID], ObjectVersion] = {}
        for obj_type, ids in ids_by_type.items():
            canonical = normalize_object_type(obj_type)
            by_id = _latest_versions_by_object_id(db, canonical, ids)
            for o_id, v in by_id.items():
                latest_versions[(obj_type, o_id)] = v

        payload_objects: List[Dict[str, Any]] = []
        for obj_type, obj in objects:
            v = latest_versions.get((obj_type, obj.id))
            data = v.data if v is not None else {}
            version_info = None
            if v is not None:
                version_info = {
                    "number": int(v.version_number),
                    "created_at": _dt_to_iso(v.created_at),
                }

            meta: Dict[str, Any] = {
                "created_at": _dt_to_iso(getattr(obj, "created_at", None)),
                "updated_at": _dt_to_iso(getattr(obj, "updated_at", None)),
            }

            if obj_type in {"basic_info", "guidelines", "character", "organization", "location", "lorebook", "outline"}:
                meta["project_id"] = str(getattr(obj, "project_id"))

            if obj_type == "act":
                meta["outline_id"] = str(getattr(obj, "outline_id"))
                meta["order"] = int(getattr(obj, "order"))
            if obj_type == "chapter":
                meta["act_id"] = str(getattr(obj, "act_id"))
                meta["order"] = int(getattr(obj, "order"))
            if obj_type == "manuscript":
                meta["chapter_id"] = str(getattr(obj, "chapter_id"))

            if obj_type in {"character", "organization", "location", "lorebook"}:
                meta["order"] = int(getattr(obj, "order") or 0)
                meta["image_prompt"] = getattr(obj, "image_prompt", None)
                meta["image_prompt_positive"] = getattr(obj, "image_prompt_positive", None)
                meta["image_prompt_negative"] = getattr(obj, "image_prompt_negative", None)

            if obj_type == "basic_info":
                meta["image_prompt"] = getattr(obj, "image_prompt", None)
                meta["image_prompt_positive"] = getattr(obj, "image_prompt_positive", None)
                meta["image_prompt_negative"] = getattr(obj, "image_prompt_negative", None)

            if obj_type == "outline":
                meta["order"] = int(getattr(obj, "order") or 0)

            payload_objects.append(
                {
                    "type": obj_type,
                    "id": str(obj.id),
                    "metadata": meta,
                    "version": version_info,
                    "data": data,
                }
            )

        return {"objects": payload_objects}

    @staticmethod
    def import_nbproj(
        db: Session,
        user_id: UUID,
        nbproj_bytes: bytes,
    ) -> UUID:
        """
        Import a .nbproj archive for the given user.

        Creates a NEW project and preserves created_at/updated_at timestamps.
        Saves imported images on import.
        """
        created_files: List[str] = []

        user = db.query(User).filter(User.id == user_id).with_for_update().first()
        if not user:
            raise ValueError("User not found")

        try:
            with zipfile.ZipFile(io.BytesIO(nbproj_bytes), "r") as zf:
                _validate_zip_paths(zf)

                manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
                if manifest.get("format_version") != FORMAT_VERSION:
                    raise ValueError(f"Unsupported format version: {manifest.get('format_version')}")

                options_raw = manifest.get("options") or {}
                options = ProjectExportOptions(**options_raw)

                project_data = json.loads(zf.read("data/project.json").decode("utf-8"))
                objects_data = json.loads(zf.read("data/objects.json").decode("utf-8"))
                links_data = json.loads(zf.read("data/links_story_object_assets.json").decode("utf-8"))

                assets_data: Optional[dict] = None
                if options.include_images:
                    assets_data = json.loads(zf.read("data/assets.json").decode("utf-8"))

                new_project_id = ProjectTransferService._import_archive_into_db(
                    db=db,
                    user_id=user_id,
                    options=options,
                    zf=zf,
                    project_data=project_data,
                    objects_data=objects_data,
                    links_data=links_data,
                    assets_data=assets_data,
                    created_files=created_files,
                )
                recalculate_project_usage_and_enforce_quota(
                    db,
                    project_id=new_project_id,
                    user_id=user_id,
                )

            db.commit()
            return new_project_id
        except Exception:
            db.rollback()
            for file_path in created_files:
                storage_service.delete_asset_files(file_path)
            raise

    @staticmethod
    def _import_archive_into_db(
        db: Session,
        user_id: UUID,
        options: ProjectExportOptions,
        zf: zipfile.ZipFile,
        project_data: dict,
        objects_data: dict,
        links_data: dict,
        assets_data: Optional[dict],
        created_files: List[str],
    ) -> UUID:
        now = datetime.utcnow()

        object_items = objects_data.get("objects") if isinstance(objects_data, dict) else None
        if not isinstance(object_items, list):
            raise ValueError("Invalid objects.json format")

        new_project_id = uuid4()
        project = Project(
            id=new_project_id,
            user_id=user_id,
            name=str(project_data.get("name") or "Imported Project"),
            description=project_data.get("description"),
            created_at=_iso_to_dt(project_data.get("created_at")) or now,
            updated_at=_iso_to_dt(project_data.get("updated_at")) or now,
        )
        db.add(project)

        # Pre-generate object ID mapping
        object_id_map: Dict[Tuple[str, str], UUID] = {}
        for item in object_items:
            if not isinstance(item, dict):
                continue
            obj_type = str(item.get("type") or "")
            export_id = str(item.get("id") or "")
            if not obj_type or not export_id:
                continue
            object_id_map[(obj_type, export_id)] = uuid4()

        def items_of_type(t: str) -> List[dict]:
            return [i for i in object_items if isinstance(i, dict) and i.get("type") == t]

        ProjectTransferService._import_core_objects(
            db=db,
            project_id=new_project_id,
            object_id_map=object_id_map,
            objects_by_type={
                "basic_info": items_of_type("basic_info"),
                "guidelines": items_of_type("guidelines"),
                "character": items_of_type("character"),
                "organization": items_of_type("organization"),
                "location": items_of_type("location"),
                "lorebook": items_of_type("lorebook"),
                "outline": items_of_type("outline"),
                "act": items_of_type("act"),
                "chapter": items_of_type("chapter"),
                "manuscript": items_of_type("manuscript"),
            },
        )

        # Assets and files
        export_asset_to_new_asset: Dict[str, UUID] = {}
        new_file_url_by_new_asset_id: Dict[str, str] = {}

        asset_items: List[dict] = []
        if options.include_images:
            if not assets_data or not isinstance(assets_data, dict):
                raise ValueError("Missing assets.json for include_images=true")
            raw_assets = assets_data.get("assets")
            if not isinstance(raw_assets, list):
                raise ValueError("Invalid assets.json format")
            asset_items = [a for a in raw_assets if isinstance(a, dict)]

            for a in asset_items:
                export_id = str(a.get("id") or "")
                if export_id:
                    export_asset_to_new_asset[export_id] = uuid4()

            for a in asset_items:
                export_id = str(a.get("id") or "")
                new_asset_id = export_asset_to_new_asset.get(export_id)
                if not export_id or not new_asset_id:
                    continue

                ext = str(a.get("original_ext") or ".png")
                if not ext.startswith("."):
                    ext = "." + ext

                arc_path = f"images/originals/{export_id}{ext}"
                try:
                    image_bytes = zf.read(arc_path)
                except KeyError:
                    raise ValueError(f"Missing image file in archive: {arc_path}")

                file_path, mime_type, width, height, file_size = storage_service.save_uploaded_file(
                    file_content=image_bytes,
                    original_filename=f"{export_id}{ext}",
                    project_id=new_project_id,
                )
                created_files.append(file_path)

                export_manuscript_id = a.get("manuscript_id")
                new_manuscript_id: Optional[UUID] = None
                if export_manuscript_id:
                    new_manuscript_id = object_id_map.get(("manuscript", str(export_manuscript_id)))

                created_at = _iso_to_dt(a.get("created_at")) or now
                updated_at = _iso_to_dt(a.get("updated_at")) or now

                gen = a.get("generation") if isinstance(a.get("generation"), dict) else {}

                # Rewrite reference image IDs -> new asset IDs (drop missing)
                ref_images = gen.get("reference_images")
                if isinstance(ref_images, list):
                    new_refs = []
                    for ref in ref_images:
                        if not isinstance(ref, dict):
                            continue
                        ref_asset_id = ref.get("asset_id")
                        if ref_asset_id is None:
                            continue
                        mapped = export_asset_to_new_asset.get(str(ref_asset_id))
                        if not mapped:
                            continue
                        new_refs.append({**ref, "asset_id": str(mapped)})
                    ref_images = new_refs
                else:
                    ref_images = None

                # Rewrite reference object IDs -> new object IDs (drop missing)
                ref_objects = gen.get("reference_objects")
                if isinstance(ref_objects, list):
                    new_ref_objects = []
                    for ref in ref_objects:
                        if not isinstance(ref, dict):
                            continue
                        ref_type = ref.get("type")
                        ref_id = ref.get("id")
                        if not ref_type or not ref_id:
                            continue
                        mapped_obj = object_id_map.get((str(ref_type), str(ref_id)))
                        if not mapped_obj:
                            continue
                        new_ref_objects.append({**ref, "id": str(mapped_obj)})
                    ref_objects = new_ref_objects
                else:
                    ref_objects = None

                db.add(
                    Asset(
                        id=new_asset_id,
                        project_id=new_project_id,
                        manuscript_id=new_manuscript_id,
                        name=str(a.get("name") or "Imported Image"),
                        file_path=file_path,
                        mime_type=mime_type,
                        asset_type=a.get("asset_type"),
                        generation_prompt=gen.get("prompt"),
                        generation_positive_prompt=gen.get("positive_prompt"),
                        generation_negative_prompt=gen.get("negative_prompt"),
                        generation_provider=gen.get("provider"),
                        generation_model=gen.get("model"),
                        generation_settings=sanitize_generation_settings(
                            str(gen.get("provider") or ""),
                            gen.get("settings"),
                        ),
                        generation_reference_images=ref_images,
                        generation_reference_objects=ref_objects,
                        width=width,
                        height=height,
                        file_size=file_size,
                        created_at=created_at,
                        updated_at=updated_at,
                    )
                )

                new_file_url_by_new_asset_id[str(new_asset_id)] = storage_service.build_public_asset_path(file_path)

        # Links (filter to mapped assets/objects)
        links_items = links_data.get("links") if isinstance(links_data, dict) else []
        if isinstance(links_items, list):
            for link in links_items:
                if not isinstance(link, dict):
                    continue
                export_asset_id = str(link.get("asset_id") or "")
                export_object_type = str(link.get("object_type") or "")
                export_object_id = str(link.get("object_id") or "")
                if not export_asset_id or not export_object_type or not export_object_id:
                    continue
                new_asset_id = export_asset_to_new_asset.get(export_asset_id)
                new_object_id = object_id_map.get((export_object_type, export_object_id))
                if not new_asset_id or not new_object_id:
                    continue
                db.add(
                    StoryObjectAsset(
                        id=uuid4(),
                        object_type=normalize_object_type(export_object_type),
                        object_id=new_object_id,
                        asset_id=new_asset_id,
                        is_main=bool(link.get("is_main")),
                        display_order=int(link.get("display_order") or 0),
                        created_at=_iso_to_dt(link.get("created_at")) or now,
                    )
                )

        # ObjectVersions (latest snapshot only; version_number resets to 1)
        for item in object_items:
            if not isinstance(item, dict):
                continue
            obj_type = str(item.get("type") or "")
            export_id = str(item.get("id") or "")
            if not obj_type or not export_id:
                continue
            new_obj_id = object_id_map.get((obj_type, export_id))
            if not new_obj_id:
                continue

            data = item.get("data") if isinstance(item.get("data"), dict) else {}
            if obj_type == "manuscript" and isinstance(data, dict) and export_asset_to_new_asset:
                export_to_new_str = {k: str(v) for k, v in export_asset_to_new_asset.items()}
                for lang, lang_data in list(data.items()):
                    if not isinstance(lang_data, dict):
                        continue
                    doc = lang_data.get("doc")
                    rewritten = _rewrite_tip_tap_doc_images(
                        doc=doc,
                        export_asset_id_to_new_asset_id=export_to_new_str,
                        new_file_url_by_new_asset_id=new_file_url_by_new_asset_id,
                    )
                    data[lang] = {**lang_data, "doc": rewritten}

            version_info = item.get("version") if isinstance(item.get("version"), dict) else {}
            v_created_at = _iso_to_dt(version_info.get("created_at")) or now

            db.add(
                ObjectVersion(
                    id=uuid4(),
                    object_type=normalize_object_type(obj_type),
                    object_id=new_obj_id,
                    version_number=1,
                    data=data,
                    user_request="Project Import",
                    created_by=user_id,
                    created_at=v_created_at,
                )
            )

        db.flush()

        # Rebuild manuscript_images index from imported docs
        manuscripts = (
            db.query(Manuscript)
            .join(Chapter, Manuscript.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .filter(Outline.project_id == new_project_id)
            .all()
        )

        for manuscript in manuscripts:
            latest_version = (
                db.query(ObjectVersion)
                .filter(ObjectVersion.object_type == "manuscript", ObjectVersion.object_id == manuscript.id)
                .order_by(ObjectVersion.version_number.desc())
                .first()
            )
            version_data = latest_version.data if latest_version else {}
            if not isinstance(version_data, dict):
                continue
            for lang, lang_data in version_data.items():
                if not isinstance(lang_data, dict):
                    continue
                doc = lang_data.get("doc")
                if doc is None:
                    continue
                rebuild_manuscript_images_for_language(
                    db=db,
                    project_id=new_project_id,
                    manuscript_id=manuscript.id,
                    language=str(lang),
                    doc=doc,
                )

        return new_project_id

    @staticmethod
    def _import_core_objects(
        db: Session,
        project_id: UUID,
        object_id_map: Dict[Tuple[str, str], UUID],
        objects_by_type: Dict[str, List[dict]],
    ) -> None:
        now = datetime.utcnow()

        def meta_dt(meta: dict, key: str) -> datetime:
            return _iso_to_dt(meta.get(key)) or now

        # basic_info
        for item in objects_by_type.get("basic_info", []):
            export_id = str(item.get("id") or "")
            new_id = object_id_map.get(("basic_info", export_id))
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            if not export_id or not new_id:
                continue
            db.add(
                BasicInfo(
                    id=new_id,
                    project_id=project_id,
                    image_prompt=meta.get("image_prompt"),
                    image_prompt_positive=meta.get("image_prompt_positive"),
                    image_prompt_negative=meta.get("image_prompt_negative"),
                    created_at=meta_dt(meta, "created_at"),
                    updated_at=meta_dt(meta, "updated_at"),
                )
            )

        # guidelines
        for item in objects_by_type.get("guidelines", []):
            export_id = str(item.get("id") or "")
            new_id = object_id_map.get(("guidelines", export_id))
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            if not export_id or not new_id:
                continue
            db.add(
                Guidelines(
                    id=new_id,
                    project_id=project_id,
                    created_at=meta_dt(meta, "created_at"),
                    updated_at=meta_dt(meta, "updated_at"),
                )
            )

        # story objects
        def add_story_objects(model_cls: Any, obj_type: str) -> None:
            for item in objects_by_type.get(obj_type, []):
                export_id = str(item.get("id") or "")
                new_id = object_id_map.get((obj_type, export_id))
                meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                if not export_id or not new_id:
                    continue
                db.add(
                    model_cls(
                        id=new_id,
                        project_id=project_id,
                        order=int(meta.get("order") or 0),
                        image_prompt=meta.get("image_prompt"),
                        image_prompt_positive=meta.get("image_prompt_positive"),
                        image_prompt_negative=meta.get("image_prompt_negative"),
                        created_at=meta_dt(meta, "created_at"),
                        updated_at=meta_dt(meta, "updated_at"),
                    )
                )

        add_story_objects(Character, "character")
        add_story_objects(Organization, "organization")
        add_story_objects(Location, "location")
        add_story_objects(LorebookEntry, "lorebook")

        # outlines
        for item in objects_by_type.get("outline", []):
            export_id = str(item.get("id") or "")
            new_id = object_id_map.get(("outline", export_id))
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            if not export_id or not new_id:
                continue
            db.add(
                Outline(
                    id=new_id,
                    project_id=project_id,
                    order=int(meta.get("order") or 0),
                    created_at=meta_dt(meta, "created_at"),
                    updated_at=meta_dt(meta, "updated_at"),
                )
            )

        # acts
        for item in objects_by_type.get("act", []):
            export_id = str(item.get("id") or "")
            new_id = object_id_map.get(("act", export_id))
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            export_outline_id = meta.get("outline_id")
            new_outline_id = object_id_map.get(("outline", str(export_outline_id))) if export_outline_id else None
            if not export_id or not new_id or not new_outline_id:
                continue
            db.add(
                Act(
                    id=new_id,
                    project_id=project_id,
                    outline_id=new_outline_id,
                    order=int(meta.get("order") or 0),
                    created_at=meta_dt(meta, "created_at"),
                    updated_at=meta_dt(meta, "updated_at"),
                )
            )

        # chapters
        for item in objects_by_type.get("chapter", []):
            export_id = str(item.get("id") or "")
            new_id = object_id_map.get(("chapter", export_id))
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            export_act_id = meta.get("act_id")
            new_act_id = object_id_map.get(("act", str(export_act_id))) if export_act_id else None
            if not export_id or not new_id or not new_act_id:
                continue
            db.add(
                Chapter(
                    id=new_id,
                    project_id=project_id,
                    act_id=new_act_id,
                    order=int(meta.get("order") or 0),
                    created_at=meta_dt(meta, "created_at"),
                    updated_at=meta_dt(meta, "updated_at"),
                )
            )

        # manuscripts
        for item in objects_by_type.get("manuscript", []):
            export_id = str(item.get("id") or "")
            new_id = object_id_map.get(("manuscript", export_id))
            meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            export_chapter_id = meta.get("chapter_id")
            new_chapter_id = object_id_map.get(("chapter", str(export_chapter_id))) if export_chapter_id else None
            if not export_id or not new_id or not new_chapter_id:
                continue
            db.add(
                Manuscript(
                    id=new_id,
                    chapter_id=new_chapter_id,
                    created_at=meta_dt(meta, "created_at"),
                    updated_at=meta_dt(meta, "updated_at"),
                )
            )
