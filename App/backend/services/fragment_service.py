"""Fragment service for managing reusable prompt fragments"""
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc, or_
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid
from collections import defaultdict

from ..models.db_models import PromptFragment
from ..schemas.fragments import (
    FragmentContentResponse,
    FragmentVersionResponse,
    FragmentVersionHistoryItem,
    FragmentListItem,
    FragmentWithContent,
    FolderTreeNode,
    FragmentTreeResponse
)


class FragmentService:
    """Service for managing prompt fragments"""

    @staticmethod
    def get_active_fragment(
        db: Session,
        user_id: uuid.UUID,
        folder_path: Optional[str],
        fragment_name: str
    ) -> Optional[FragmentContentResponse]:
        """
        Get the currently active fragment for a user.

        Args:
            db: Database session
            user_id: User ID
            folder_path: Folder path (None for root)
            fragment_name: Fragment name

        Returns:
            FragmentContentResponse or None if not found
        """
        # Get the latest version (highest version_number is always active)
        fragment = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == folder_path,
                PromptFragment.fragment_name == fragment_name,
            )
        ).order_by(desc(PromptFragment.version_number)).first()

        if not fragment:
            return None

        return FragmentContentResponse(
            id=str(fragment.id),
            folder_path=fragment.folder_path,
            fragment_name=fragment.fragment_name,
            content=fragment.content,
            description=fragment.description,
            version_number=fragment.version_number,
            is_system_default=fragment.is_system_default,
            created_at=fragment.created_at,
            updated_at=fragment.updated_at
        )

    @staticmethod
    def _get_latest_fragments_query(db: Session, user_id: uuid.UUID):
        """
        Helper to get query for latest version of each fragment.
        Uses subquery to find MAX(version_number) for each (folder_path, fragment_name).
        """
        from sqlalchemy import func
        from sqlalchemy.sql.functions import coalesce

        # Subquery to get max version for each fragment
        subq = db.query(
            PromptFragment.folder_path,
            PromptFragment.fragment_name,
            func.max(PromptFragment.version_number).label('max_version')
        ).filter(
            PromptFragment.user_id == user_id
        ).group_by(
            PromptFragment.folder_path,
            PromptFragment.fragment_name
        ).subquery()

        # Join with subquery to get only latest versions
        # Use coalesce to handle NULL folder_path
        return db.query(PromptFragment).join(
            subq,
            and_(
                coalesce(PromptFragment.folder_path, '') == coalesce(subq.c.folder_path, ''),
                PromptFragment.fragment_name == subq.c.fragment_name,
                PromptFragment.version_number == subq.c.max_version
            )
        ).filter(PromptFragment.user_id == user_id)

    @staticmethod
    def get_all_fragments(
        db: Session,
        user_id: uuid.UUID
    ) -> List[FragmentListItem]:
        """
        Get all fragments for a user (latest version of each).

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of FragmentListItem
        """
        fragments = FragmentService._get_latest_fragments_query(db, user_id).order_by(
            PromptFragment.folder_path, PromptFragment.fragment_name
        ).all()

        return [
            FragmentListItem(
                id=str(f.id),
                folder_path=f.folder_path,
                fragment_name=f.fragment_name,
                description=f.description,
                is_system_default=f.is_system_default,
                version_number=f.version_number,
                updated_at=f.updated_at
            )
            for f in fragments
        ]

    @staticmethod
    def get_all_fragments_with_content(
        db: Session,
        user_id: uuid.UUID
    ) -> List[FragmentWithContent]:
        """
        Get all fragments with content for the template engine (latest version of each).

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of FragmentWithContent with full content
        """
        fragments = FragmentService._get_latest_fragments_query(db, user_id).order_by(
            PromptFragment.folder_path, PromptFragment.fragment_name
        ).all()

        return [
            FragmentWithContent(
                id=str(f.id),
                folder_path=f.folder_path,
                fragment_name=f.fragment_name,
                content=f.content,
                description=f.description,
                is_system_default=f.is_system_default
            )
            for f in fragments
        ]

    @staticmethod
    def get_folder_tree(
        db: Session,
        user_id: uuid.UUID
    ) -> FragmentTreeResponse:
        """
        Get folder tree structure with all fragments organized hierarchically.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            FragmentTreeResponse with root fragments and folder tree
        """
        fragments = FragmentService.get_all_fragments(db, user_id)

        # Separate root fragments from folder-organized ones
        root_fragments = []
        folders_dict: Dict[str, List[FragmentListItem]] = defaultdict(list)

        for fragment in fragments:
            if fragment.folder_path is None:
                root_fragments.append(fragment)
            else:
                folders_dict[fragment.folder_path].append(fragment)

        # Build folder tree from flat paths
        folder_tree = FragmentService._build_folder_tree(folders_dict)

        return FragmentTreeResponse(
            root_fragments=root_fragments,
            folders=folder_tree
        )

    @staticmethod
    def _build_folder_tree(folders_dict: Dict[str, List[FragmentListItem]]) -> List[FolderTreeNode]:
        """Build hierarchical folder tree from flat path dictionary"""
        # Get all unique folder paths
        all_paths = set(folders_dict.keys())

        # Add parent paths that might be implicit
        for path in list(all_paths):
            parts = path.split('/')
            for i in range(1, len(parts)):
                parent = '/'.join(parts[:i])
                all_paths.add(parent)

        # Build tree structure
        root_folders: List[FolderTreeNode] = []
        nodes_by_path: Dict[str, FolderTreeNode] = {}

        # Sort paths to process parents before children
        sorted_paths = sorted(all_paths)

        for path in sorted_paths:
            parts = path.split('/')
            name = parts[-1]

            node = FolderTreeNode(
                name=name,
                path=path,
                fragments=folders_dict.get(path, []),
                children=[]
            )
            nodes_by_path[path] = node

            if len(parts) == 1:
                # Root level folder
                root_folders.append(node)
            else:
                # Child folder - find parent
                parent_path = '/'.join(parts[:-1])
                if parent_path in nodes_by_path:
                    nodes_by_path[parent_path].children.append(node)

        return root_folders

    @staticmethod
    def save_new_version(
        db: Session,
        user_id: uuid.UUID,
        folder_path: Optional[str],
        fragment_name: str,
        content: str,
        description: Optional[str] = None,
        note: Optional[str] = None
    ) -> FragmentVersionResponse:
        """
        Save a new version of a fragment and set it as active.
        Creates fragment if it doesn't exist.

        Args:
            db: Database session
            user_id: User ID
            folder_path: Folder path (None for root)
            fragment_name: Fragment name
            content: Fragment content
            description: Optional description
            note: Optional version note

        Returns:
            FragmentVersionResponse with new version details
        """
        # Get the highest version number for this fragment
        max_version = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == folder_path,
                PromptFragment.fragment_name == fragment_name
            )
        ).order_by(desc(PromptFragment.version_number)).first()

        new_version_number = (max_version.version_number + 1) if max_version else 1

        # Get existing description if not provided
        if description is None and max_version:
            description = max_version.description

        # Create new version (highest version_number is always active, no need for is_active flag)
        now = datetime.utcnow()
        new_fragment = PromptFragment(
            id=uuid.uuid4(),
            user_id=user_id,
            folder_path=folder_path,
            fragment_name=fragment_name,
            content=content,
            description=description,
            is_system_default=False,
            version_number=new_version_number,
            note=note,
            created_at=now,
            updated_at=now
        )

        db.add(new_fragment)
        db.commit()
        db.refresh(new_fragment)

        return FragmentVersionResponse(
            id=str(new_fragment.id),
            folder_path=new_fragment.folder_path,
            fragment_name=new_fragment.fragment_name,
            content=new_fragment.content,
            description=new_fragment.description,
            version_number=new_fragment.version_number,
            is_system_default=new_fragment.is_system_default,
            created_at=new_fragment.created_at,
            updated_at=new_fragment.updated_at,
            note=new_fragment.note
        )

    @staticmethod
    def get_version_history(
        db: Session,
        user_id: uuid.UUID,
        folder_path: Optional[str],
        fragment_name: str
    ) -> List[FragmentVersionHistoryItem]:
        """
        Get version history for a fragment.

        Args:
            db: Database session
            user_id: User ID
            folder_path: Folder path (None for root)
            fragment_name: Fragment name

        Returns:
            List of FragmentVersionHistoryItem ordered by version number (descending)
        """
        versions = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == folder_path,
                PromptFragment.fragment_name == fragment_name
            )
        ).order_by(desc(PromptFragment.version_number)).all()

        return [
            FragmentVersionHistoryItem(
                version_number=v.version_number,
                created_at=v.created_at,
                note=v.note,
                is_system_default=v.is_system_default,
                preview=v.content[:200] + ('...' if len(v.content) > 200 else '')
            )
            for v in versions
        ]

    @staticmethod
    def restore_version(
        db: Session,
        user_id: uuid.UUID,
        folder_path: Optional[str],
        fragment_name: str,
        version_number: int
    ) -> Optional[FragmentVersionResponse]:
        """
        Restore a specific version by creating a NEW version with the restored content.
        This follows the fork pattern - the restored content becomes the latest version.

        Args:
            db: Database session
            user_id: User ID
            folder_path: Folder path (None for root)
            fragment_name: Fragment name
            version_number: Version number to restore

        Returns:
            FragmentVersionResponse with new version details, or None if source version not found
        """
        # Find the version to restore
        version_to_restore = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == folder_path,
                PromptFragment.fragment_name == fragment_name,
                PromptFragment.version_number == version_number
            )
        ).first()

        if not version_to_restore:
            return None

        # Create a new version with the restored content (fork pattern)
        return FragmentService.save_new_version(
            db=db,
            user_id=user_id,
            folder_path=folder_path,
            fragment_name=fragment_name,
            content=version_to_restore.content,
            description=version_to_restore.description,
            note=f"Restored from v{version_to_restore.version_number}"
        )

    @staticmethod
    def delete_fragment(
        db: Session,
        user_id: uuid.UUID,
        folder_path: Optional[str],
        fragment_name: str
    ) -> bool:
        """
        Delete all versions of a fragment.

        Args:
            db: Database session
            user_id: User ID
            folder_path: Folder path (None for root)
            fragment_name: Fragment name

        Returns:
            True if fragment existed and was deleted, False otherwise
        """
        deleted_count = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == folder_path,
                PromptFragment.fragment_name == fragment_name
            )
        ).delete()

        db.commit()
        return deleted_count > 0

    @staticmethod
    def move_fragment(
        db: Session,
        user_id: uuid.UUID,
        folder_path: Optional[str],
        fragment_name: str,
        new_folder_path: Optional[str]
    ) -> bool:
        """
        Move fragment to a different folder.

        Args:
            db: Database session
            user_id: User ID
            folder_path: Current folder path
            fragment_name: Fragment name
            new_folder_path: New folder path

        Returns:
            True if fragment was moved, False if not found or conflict
        """
        # Check if target already exists (any version)
        existing = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == new_folder_path,
                PromptFragment.fragment_name == fragment_name,
            )
        ).first()

        if existing:
            return False  # Target already exists

        # Update all versions to new path
        updated_count = db.query(PromptFragment).filter(
            and_(
                PromptFragment.user_id == user_id,
                PromptFragment.folder_path == folder_path,
                PromptFragment.fragment_name == fragment_name
            )
        ).update({'folder_path': new_folder_path, 'updated_at': datetime.utcnow()})

        db.commit()
        return updated_count > 0

    @staticmethod
    def initialize_default_fragments(
        db: Session,
        user_id: uuid.UUID,
        default_fragments: Dict[str, str]
    ) -> None:
        """
        Initialize default fragments for a new user.

        Args:
            db: Database session
            user_id: User ID
            default_fragments: Dictionary of path -> content
                Format: {'common/customThinkingInstruction': content, ...}
        """
        now = datetime.utcnow()

        for path, content in default_fragments.items():
            # Parse path into folder_path and fragment_name
            if '/' in path:
                parts = path.rsplit('/', 1)
                folder_path = parts[0]
                fragment_name = parts[1]
            else:
                folder_path = None
                fragment_name = path

            fragment = PromptFragment(
                id=uuid.uuid4(),
                user_id=user_id,
                folder_path=folder_path,
                fragment_name=fragment_name,
                content=content,
                description=None,
                is_system_default=True,
                version_number=1,
                note="System default",
                created_at=now,
                updated_at=now
            )
            db.add(fragment)

        db.commit()


# Export service instance
fragment_service = FragmentService()
