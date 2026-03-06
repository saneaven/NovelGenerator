"""Service for managing prompt fragment folders"""
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import Optional, List, Dict
from datetime import datetime
from uuid import UUID
import uuid

from ..models.db_models import PromptFolder, PromptFragment, PromptScenarioVersion


class FolderService:
    """Service for prompt folder CRUD and path resolution"""

    @staticmethod
    def create_folder(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        name: str,
        parent_id: Optional[UUID] = None,
    ) -> PromptFolder:
        now = datetime.utcnow()
        folder = PromptFolder(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            name=name,
            parent_id=parent_id,
            display_order=0,
            created_at=now,
            updated_at=now,
        )
        db.add(folder)
        db.flush()
        return folder

    @staticmethod
    def get_or_create_folder_by_path(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        path_str: str,
    ) -> PromptFolder:
        """Create folder chain from path like 'common/editOperations', return leaf."""
        parts = path_str.split("/")
        parent_id: Optional[UUID] = None

        for part in parts:
            folder = db.query(PromptFolder).filter(
                and_(
                    PromptFolder.user_id == user_id,
                    PromptFolder.preset_id == preset_id,
                    PromptFolder.parent_id == parent_id if parent_id else PromptFolder.parent_id.is_(None),
                    PromptFolder.name == part,
                )
            ).first()

            if not folder:
                folder = FolderService.create_folder(db, user_id, preset_id, part, parent_id)

            parent_id = folder.id

        return folder

    @staticmethod
    def get_folder_path(db: Session, folder_id: UUID) -> str:
        """Walk up parent_id chain to build full path string."""
        parts: list[str] = []
        current_id: Optional[UUID] = folder_id

        while current_id is not None:
            folder = db.query(PromptFolder).get(current_id)
            if folder is None:
                break
            parts.append(folder.name)
            current_id = folder.parent_id

        return "/".join(reversed(parts))

    @staticmethod
    def build_folder_path_cache(db: Session, preset_id: UUID) -> Dict[UUID, str]:
        """Single query, in-memory {folder_id: 'path/string'} map."""
        folders = db.query(PromptFolder).filter(
            PromptFolder.preset_id == preset_id,
        ).all()

        folder_map = {f.id: f for f in folders}
        path_cache: Dict[UUID, str] = {}

        def resolve(fid: UUID) -> str:
            if fid in path_cache:
                return path_cache[fid]
            folder = folder_map[fid]
            if folder.parent_id and folder.parent_id in folder_map:
                path = f"{resolve(folder.parent_id)}/{folder.name}"
            else:
                path = folder.name
            path_cache[fid] = path
            return path

        for f in folders:
            resolve(f.id)

        return path_cache

    @staticmethod
    def rename_folder(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: UUID,
        new_name: str,
    ) -> Optional[PromptFolder]:
        folder = db.query(PromptFolder).filter(
            and_(
                PromptFolder.id == folder_id,
                PromptFolder.user_id == user_id,
                PromptFolder.preset_id == preset_id,
            )
        ).first()
        if not folder:
            return None

        old_path = FolderService.get_folder_path(db, folder_id)
        folder.name = new_name
        folder.updated_at = datetime.utcnow()
        db.flush()
        new_path = FolderService.get_folder_path(db, folder_id)

        update_template_references(db, user_id, preset_id, old_path, new_path)
        db.flush()
        return folder

    @staticmethod
    def move_folder(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: UUID,
        new_parent_id: Optional[UUID],
    ) -> Optional[PromptFolder]:
        folder = db.query(PromptFolder).filter(
            and_(
                PromptFolder.id == folder_id,
                PromptFolder.user_id == user_id,
                PromptFolder.preset_id == preset_id,
            )
        ).first()
        if not folder:
            return None

        # Prevent circular reference: new_parent must not be in folder's subtree
        if new_parent_id is not None:
            subtree_ids = FolderService._get_subtree_ids(db, folder_id)
            if new_parent_id in subtree_ids:
                return None

        old_path = FolderService.get_folder_path(db, folder_id)
        folder.parent_id = new_parent_id
        folder.updated_at = datetime.utcnow()
        db.flush()
        new_path = FolderService.get_folder_path(db, folder_id)

        update_template_references(db, user_id, preset_id, old_path, new_path)
        db.flush()
        return folder

    @staticmethod
    def delete_folder(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: UUID,
    ) -> bool:
        folder = db.query(PromptFolder).filter(
            and_(
                PromptFolder.id == folder_id,
                PromptFolder.user_id == user_id,
                PromptFolder.preset_id == preset_id,
            )
        ).first()
        if not folder:
            return False

        db.delete(folder)
        db.flush()
        return True

    @staticmethod
    def _get_subtree_ids(db: Session, folder_id: UUID) -> set[UUID]:
        """Get all folder IDs in subtree (including self)."""
        result = {folder_id}
        children = db.query(PromptFolder).filter(
            PromptFolder.parent_id == folder_id,
        ).all()
        for child in children:
            result.update(FolderService._get_subtree_ids(db, child.id))
        return result

    @staticmethod
    def copy_folder_tree(
        db: Session,
        user_id: UUID,
        source_preset_id: UUID,
        target_preset_id: UUID,
    ) -> Dict[UUID, UUID]:
        """Copy entire folder tree from source to target preset.
        Returns {old_folder_id: new_folder_id} mapping."""
        source_folders = db.query(PromptFolder).filter(
            and_(
                PromptFolder.user_id == user_id,
                PromptFolder.preset_id == source_preset_id,
            )
        ).all()

        id_map: Dict[UUID, UUID] = {}
        now = datetime.utcnow()

        # Sort so parents come before children (root folders first)
        # Build adjacency and process with BFS
        children_map: Dict[Optional[UUID], list[PromptFolder]] = {}
        for f in source_folders:
            children_map.setdefault(f.parent_id, []).append(f)

        queue: list[Optional[UUID]] = [None]
        while queue:
            parent_id = queue.pop(0)
            for folder in children_map.get(parent_id, []):
                new_id = uuid.uuid4()
                id_map[folder.id] = new_id
                new_parent = id_map.get(folder.parent_id) if folder.parent_id else None
                db.add(PromptFolder(
                    id=new_id,
                    user_id=user_id,
                    preset_id=target_preset_id,
                    name=folder.name,
                    parent_id=new_parent,
                    display_order=folder.display_order,
                    created_at=now,
                    updated_at=now,
                ))
                queue.append(folder.id)

        db.flush()
        return id_map


def update_template_references(
    db: Session,
    user_id: UUID,
    preset_id: UUID,
    old_path: str,
    new_path: str,
) -> int:
    """Update all template references when a folder/fragment path changes.

    Replaces '"fragment:old_path"' with '"fragment:new_path"' in all
    ScenarioDocument templates and PromptFragment content for the given user+preset.
    Returns total number of rows updated.
    """
    if old_path == new_path:
        return 0

    replacement_from = f'"fragment:{old_path}"'
    replacement_to = f'"fragment:{new_path}"'
    updated = 0

    def _replace_in_scenario(scenario: dict) -> tuple[dict, bool]:
        changed = False
        next_scenario = dict(scenario) if isinstance(scenario, dict) else {}

        system_template = next_scenario.get("system_template")
        if isinstance(system_template, str) and replacement_from in system_template:
            next_scenario["system_template"] = system_template.replace(replacement_from, replacement_to)
            changed = True

        blocks = next_scenario.get("blocks")
        if isinstance(blocks, list):
            next_blocks = []
            for blk in blocks:
                if not isinstance(blk, dict):
                    next_blocks.append(blk)
                    continue
                next_blk = dict(blk)

                sp = next_blk.get("staticPrompt")
                if isinstance(sp, dict):
                    next_sp = dict(sp)
                    tpl = next_sp.get("template")
                    if isinstance(tpl, str) and replacement_from in tpl:
                        next_sp["template"] = tpl.replace(replacement_from, replacement_to)
                        next_blk["staticPrompt"] = next_sp
                        changed = True

                rm = next_blk.get("rangeMapping")
                if isinstance(rm, dict):
                    next_rm = dict(rm)
                    ut = next_rm.get("user_template")
                    at = next_rm.get("assistant_template")
                    if isinstance(ut, str) and replacement_from in ut:
                        next_rm["user_template"] = ut.replace(replacement_from, replacement_to)
                        next_blk["rangeMapping"] = next_rm
                        changed = True
                    if isinstance(at, str) and replacement_from in at:
                        next_rm["assistant_template"] = at.replace(replacement_from, replacement_to)
                        next_blk["rangeMapping"] = next_rm
                        changed = True

                next_blocks.append(next_blk)
            next_scenario["blocks"] = next_blocks

        return next_scenario, changed

    # Update in scenario templates
    scenario_versions = db.query(PromptScenarioVersion).filter(
        and_(
            PromptScenarioVersion.user_id == user_id,
            PromptScenarioVersion.preset_id == preset_id,
        )
    ).all()
    for row in scenario_versions:
        scenario = row.scenario if isinstance(row.scenario, dict) else {}
        next_scenario, changed = _replace_in_scenario(scenario)
        if not changed:
            continue
        row.scenario = next_scenario
        updated += 1

    # Update in fragment content (fragments can include other fragments)
    fragments = db.query(PromptFragment).filter(
        and_(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
            PromptFragment.content.contains(replacement_from),
        )
    ).all()
    for f in fragments:
        f.content = f.content.replace(replacement_from, replacement_to)
        updated += 1

    return updated


folder_service = FolderService()
