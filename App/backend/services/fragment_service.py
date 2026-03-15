"""Fragment service for managing reusable prompt fragments"""
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc
from typing import Optional, List, Dict
from datetime import datetime
from uuid import UUID
import uuid
from collections import defaultdict

from ..models.db_models import PromptFragment, PromptFolder
from ..schemas.fragments import (
    FragmentContentResponse,
    FragmentVersionResponse,
    FragmentVersionHistoryItem,
    FragmentListItem,
    FragmentWithContent,
    FolderTreeNode,
    FragmentTreeResponse,
)
from .folder_service import FolderService, update_template_references


def _folder_path_str(folder_id: Optional[UUID], path_cache: Dict[UUID, str]) -> Optional[str]:
    """Resolve folder_id to path string using a cache."""
    if folder_id is None:
        return None
    return path_cache.get(folder_id)


class FragmentConflictError(ValueError):
    """Raised when a fragment rename collides with an existing fragment."""


class FragmentService:
    """Service for managing prompt fragments"""

    @staticmethod
    def get_active_fragment(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
    ) -> Optional[FragmentContentResponse]:
        """Get the currently active (latest version) fragment."""
        fragment = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
                PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                PromptFragment.fragment_name == fragment_name,
            )
        ).order_by(desc(PromptFragment.version_number)).first()

        if not fragment:
            return None

        path_cache = FolderService.build_folder_path_cache(db, preset_id)
        return FragmentContentResponse(
            id=str(fragment.id),
            folder_id=str(fragment.folder_id) if fragment.folder_id else None,
            folder_path=_folder_path_str(fragment.folder_id, path_cache),
            fragment_name=fragment.fragment_name,
            content=fragment.content,
            description=fragment.description,
            version_number=fragment.version_number,
            created_at=fragment.created_at,
            updated_at=fragment.updated_at,
        )

    @staticmethod
    def _get_latest_fragments_query(db: Session, user_id: UUID, preset_id: UUID):
        """Helper to get query for latest version of each fragment.
        Uses IS NOT DISTINCT FROM for NULL-safe folder_id comparison."""
        from sqlalchemy import func, literal_column

        subq = db.query(
            PromptFragment.folder_id,
            PromptFragment.fragment_name,
            func.max(PromptFragment.version_number).label("max_version"),
        ).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
            )
        ).group_by(
            PromptFragment.folder_id,
            PromptFragment.fragment_name,
        ).subquery()

        return db.query(PromptFragment).join(
            subq,
            and_(
                PromptFragment.folder_id.is_not_distinct_from(subq.c.folder_id),
                PromptFragment.fragment_name == subq.c.fragment_name,
                PromptFragment.version_number == subq.c.max_version,
            ),
        ).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
            )
        )

    @staticmethod
    def get_all_fragments(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
    ) -> List[FragmentListItem]:
        """Get all fragments (latest version of each) for a user+preset."""
        fragments = FragmentService._get_latest_fragments_query(db, user_id, preset_id).order_by(
            PromptFragment.folder_id, PromptFragment.fragment_name
        ).all()

        path_cache = FolderService.build_folder_path_cache(db, preset_id)
        return [
            FragmentListItem(
                id=str(f.id),
                folder_id=str(f.folder_id) if f.folder_id else None,
                folder_path=_folder_path_str(f.folder_id, path_cache),
                fragment_name=f.fragment_name,
                description=f.description,
                version_number=f.version_number,
                updated_at=f.updated_at,
            )
            for f in fragments
        ]

    @staticmethod
    def get_all_fragments_with_content(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
    ) -> List[FragmentWithContent]:
        """Get all fragments with content for the template engine."""
        fragments = FragmentService._get_latest_fragments_query(db, user_id, preset_id).order_by(
            PromptFragment.folder_id, PromptFragment.fragment_name
        ).all()

        path_cache = FolderService.build_folder_path_cache(db, preset_id)
        return [
            FragmentWithContent(
                id=str(f.id),
                folder_id=str(f.folder_id) if f.folder_id else None,
                folder_path=_folder_path_str(f.folder_id, path_cache),
                fragment_name=f.fragment_name,
                content=f.content,
                description=f.description,
            )
            for f in fragments
        ]

    @staticmethod
    def get_folder_tree(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
    ) -> FragmentTreeResponse:
        """Build hierarchical tree from PromptFolder rows + fragments."""
        # Get all folders for this preset
        folders = db.query(PromptFolder).filter(
            and_(
                PromptFolder.user_id == user_id,
                PromptFolder.preset_id == preset_id,
            )
        ).order_by(PromptFolder.display_order, PromptFolder.name).all()

        # Get all latest fragments
        fragments = FragmentService.get_all_fragments(db, user_id, preset_id)

        # Group fragments by folder_id
        fragments_by_folder: Dict[Optional[str], List[FragmentListItem]] = defaultdict(list)
        root_fragments: List[FragmentListItem] = []
        for f in fragments:
            if f.folder_id is None:
                root_fragments.append(f)
            else:
                fragments_by_folder[f.folder_id].append(f)

        # Build path cache
        path_cache = FolderService.build_folder_path_cache(db, preset_id)

        # Build tree from parent-child relationships
        folder_nodes: Dict[str, FolderTreeNode] = {}
        children_map: Dict[Optional[str], list[PromptFolder]] = defaultdict(list)
        for folder in folders:
            parent_key = str(folder.parent_id) if folder.parent_id else None
            children_map[parent_key].append(folder)

        def build_node(folder: PromptFolder) -> FolderTreeNode:
            fid = str(folder.id)
            child_folders = children_map.get(fid, [])
            return FolderTreeNode(
                id=fid,
                name=folder.name,
                path=path_cache.get(folder.id, folder.name),
                parent_id=str(folder.parent_id) if folder.parent_id else None,
                fragments=fragments_by_folder.get(fid, []),
                children=[build_node(c) for c in child_folders],
            )

        root_folder_nodes = [build_node(f) for f in children_map.get(None, [])]

        return FragmentTreeResponse(
            root_fragments=root_fragments,
            folders=root_folder_nodes,
        )

    @staticmethod
    def save_new_version(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
        content: str,
        description: Optional[str] = None,
        note: Optional[str] = None,
    ) -> FragmentVersionResponse:
        """Save a new version of a fragment. Creates fragment if it doesn't exist."""
        filter_clause = and_(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
            PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
            PromptFragment.fragment_name == fragment_name,
        )

        max_version = db.query(PromptFragment).filter(filter_clause).order_by(
            desc(PromptFragment.version_number)
        ).first()

        new_version_number = (max_version.version_number + 1) if max_version else 1

        if description is None and max_version:
            description = max_version.description

        now = datetime.utcnow()
        new_fragment = PromptFragment(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            folder_id=folder_id,
            fragment_name=fragment_name,
            content=content,
            description=description,
            version_number=new_version_number,
            note=note,
            created_at=now,
            updated_at=now,
        )

        db.add(new_fragment)
        db.commit()
        db.refresh(new_fragment)

        path_cache = FolderService.build_folder_path_cache(db, preset_id)
        return FragmentVersionResponse(
            id=str(new_fragment.id),
            folder_id=str(new_fragment.folder_id) if new_fragment.folder_id else None,
            folder_path=_folder_path_str(new_fragment.folder_id, path_cache),
            fragment_name=new_fragment.fragment_name,
            content=new_fragment.content,
            description=new_fragment.description,
            version_number=new_fragment.version_number,
            created_at=new_fragment.created_at,
            updated_at=new_fragment.updated_at,
            note=new_fragment.note,
        )

    @staticmethod
    def update_fragment(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
        content: str,
        description: Optional[str] = None,
        new_fragment_name: Optional[str] = None,
    ) -> Optional[FragmentVersionResponse]:
        """Update fragment content/description and optionally rename the fragment."""
        source_filter = and_(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
            PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
            PromptFragment.fragment_name == fragment_name,
        )

        versions = db.query(PromptFragment).filter(source_filter).order_by(
            desc(PromptFragment.version_number)
        ).all()
        if not versions:
            return None

        latest = versions[0]
        target_name = (new_fragment_name or fragment_name).strip()
        if not target_name:
            raise ValueError("Fragment name cannot be empty.")

        if target_name != fragment_name:
            existing = db.query(PromptFragment).filter(
                and_(
                    PromptFragment.user_id == user_id,
                    PromptFragment.preset_id == preset_id,
                    PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                    PromptFragment.fragment_name == target_name,
                )
            ).first()
            if existing:
                raise FragmentConflictError(f"Fragment already exists: {target_name}")

            renamed_at = datetime.utcnow()
            for version in versions:
                version.fragment_name = target_name
                version.updated_at = renamed_at
            db.flush()

        resolved_description = latest.description if description is None else description
        content_changed = content != latest.content
        description_changed = resolved_description != latest.description

        if content_changed or description_changed:
            return FragmentService.save_new_version(
                db=db,
                user_id=user_id,
                preset_id=preset_id,
                folder_id=folder_id,
                fragment_name=target_name,
                content=content,
                description=resolved_description,
                note=None,
            )

        db.commit()

        path_cache = FolderService.build_folder_path_cache(db, preset_id)
        return FragmentVersionResponse(
            id=str(latest.id),
            folder_id=str(latest.folder_id) if latest.folder_id else None,
            folder_path=_folder_path_str(latest.folder_id, path_cache),
            fragment_name=latest.fragment_name,
            content=latest.content,
            description=latest.description,
            version_number=latest.version_number,
            created_at=latest.created_at,
            updated_at=latest.updated_at,
            note=latest.note,
        )

    @staticmethod
    def get_version_history(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
    ) -> List[FragmentVersionHistoryItem]:
        """Get version history for a fragment."""
        versions = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
                PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                PromptFragment.fragment_name == fragment_name,
            )
        ).order_by(desc(PromptFragment.version_number)).all()

        return [
            FragmentVersionHistoryItem(
                version_number=v.version_number,
                created_at=v.created_at,
                note=v.note,
                preview=v.content[:200] + ("..." if len(v.content) > 200 else ""),
            )
            for v in versions
        ]

    @staticmethod
    def restore_version(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
        version_number: int,
    ) -> Optional[FragmentVersionResponse]:
        """Restore a specific version by creating a NEW version with the restored content."""
        version_to_restore = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
                PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                PromptFragment.fragment_name == fragment_name,
                PromptFragment.version_number == version_number,
            )
        ).first()

        if not version_to_restore:
            return None

        return FragmentService.save_new_version(
            db=db,
            user_id=user_id,
            preset_id=preset_id,
            folder_id=folder_id,
            fragment_name=fragment_name,
            content=version_to_restore.content,
            description=version_to_restore.description,
            note=f"Restored from v{version_to_restore.version_number}",
        )

    @staticmethod
    def delete_fragment(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
    ) -> bool:
        """Delete all versions of a fragment."""
        deleted_count = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
                PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                PromptFragment.fragment_name == fragment_name,
            )
        ).delete()

        db.commit()
        return deleted_count > 0

    @staticmethod
    def move_fragment(
        db: Session,
        user_id: UUID,
        preset_id: UUID,
        folder_id: Optional[UUID],
        fragment_name: str,
        new_folder_id: Optional[UUID],
    ) -> bool:
        """Move fragment to a different folder. Updates template references."""
        # Check if target already exists
        target_filter = and_(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
            PromptFragment.folder_id == new_folder_id if new_folder_id else PromptFragment.folder_id.is_(None),
            PromptFragment.fragment_name == fragment_name,
        )
        existing = db.query(PromptFragment).filter(target_filter).first()
        if existing:
            return False

        # Compute old full path for template reference update
        path_cache = FolderService.build_folder_path_cache(db, preset_id)
        old_folder_path = _folder_path_str(folder_id, path_cache)
        old_full_path = f"{old_folder_path}/{fragment_name}" if old_folder_path else fragment_name

        # Update all versions to new folder
        source_filter = and_(
            PromptFragment.user_id == user_id,
            PromptFragment.preset_id == preset_id,
            PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
            PromptFragment.fragment_name == fragment_name,
        )
        updated_count = db.query(PromptFragment).filter(source_filter).update(
            {"folder_id": new_folder_id, "updated_at": datetime.utcnow()}
        )

        if updated_count == 0:
            return False

        # Compute new full path and update template references
        new_folder_path = _folder_path_str(new_folder_id, path_cache)
        new_full_path = f"{new_folder_path}/{fragment_name}" if new_folder_path else fragment_name
        update_template_references(db, user_id, preset_id, old_full_path, new_full_path)

        db.commit()
        return True


# Export service instance
fragment_service = FragmentService()
