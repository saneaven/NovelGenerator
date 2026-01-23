"""Prompt service for managing version-controlled prompts"""
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc
from typing import Optional, List
from datetime import datetime
import uuid

from ..models.db_models import PromptVersion, User
from ..schemas.prompts import (
    PromptContentResponse,
    PromptVersionResponse,
    VersionHistoryItem
)


class PromptService:
    """Service for managing prompt versions"""

    @staticmethod
    def get_active_prompt(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        prompt_category: str,
        prompt_name: str
    ) -> Optional[PromptContentResponse]:
        """
        Get the currently active prompt for a user within a preset.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID
            task_type: Task type (agent, translation, etc.)
            prompt_category: Prompt category (systemPrompt, prefill, etc.)
            prompt_name: Optional prompt name (workspace, novelEditor, etc.)

        Returns:
            PromptContentResponse or None if not found
        """
        # Get the latest version (highest version_number is always active)
        prompt = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == task_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name,
            )
        ).order_by(desc(PromptVersion.version_number)).first()

        if not prompt:
            return None

        return PromptContentResponse(
            content=prompt.content,
            version_number=prompt.version_number,
            created_at=prompt.created_at,
            is_system_default=prompt.is_default
        )

    @staticmethod
    def save_new_version(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        prompt_category: str,
        content: str,
        prompt_name: str,
        note: Optional[str] = None
    ) -> PromptVersionResponse:
        """
        Save a new version of a prompt and set it as active.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID
            task_type: Task type
            prompt_category: Prompt category
            content: Prompt content
            note: Optional version note
            prompt_name: Optional prompt name

        Returns:
            PromptVersionResponse with new version details
        """
        # Get the highest version number for this prompt
        max_version = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == task_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name
            )
        ).order_by(desc(PromptVersion.version_number)).first()

        new_version_number = (max_version.version_number + 1) if max_version else 1

        # Create new version (highest version_number is always active, no need for is_active flag)
        new_prompt = PromptVersion(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            task_type=task_type,
            prompt_category=prompt_category,
            prompt_name=prompt_name,
            content=content,
            version_number=new_version_number,
            is_default=False,
            note=note,
            created_at=datetime.utcnow()
        )

        db.add(new_prompt)
        db.commit()
        db.refresh(new_prompt)

        return PromptVersionResponse(
            id=str(new_prompt.id),
            version_number=new_prompt.version_number,
            content=new_prompt.content,
            is_system_default=new_prompt.is_default,
            created_at=new_prompt.created_at,
            note=new_prompt.note
        )

    @staticmethod
    def get_version_history(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        prompt_category: str,
        prompt_name: str
    ) -> List[VersionHistoryItem]:
        """
        Get version history for a prompt.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID
            task_type: Task type
            prompt_category: Prompt category
            prompt_name: Optional prompt name

        Returns:
            List of VersionHistoryItem ordered by version number (descending)
        """
        versions = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == task_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name
            )
        ).order_by(desc(PromptVersion.version_number)).all()

        return [
            VersionHistoryItem(
                version_number=v.version_number,
                created_at=v.created_at,
                note=v.note,
                is_system_default=v.is_default,
                preview=v.content[:200] + ('...' if len(v.content) > 200 else '')
            )
            for v in versions
        ]

    @staticmethod
    def restore_version(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        task_type: str,
        prompt_category: str,
        version_number: int,
        prompt_name: str
    ) -> Optional[PromptVersionResponse]:
        """
        Restore a specific version by creating a NEW version with the restored content.
        This follows the fork pattern - the restored content becomes the latest version.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID
            task_type: Task type
            prompt_category: Prompt category
            version_number: Version number to restore
            prompt_name: Optional prompt name

        Returns:
            PromptVersionResponse with new version details, or None if source version not found
        """
        # Find the version to restore
        version_to_restore = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == task_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name,
                PromptVersion.version_number == version_number
            )
        ).first()

        if not version_to_restore:
            return None

        # Create a new version with the restored content (fork pattern)
        return PromptService.save_new_version(
            db=db,
            user_id=user_id,
            preset_id=preset_id,
            task_type=task_type,
            prompt_category=prompt_category,
            content=version_to_restore.content,
            note=f"Restored from v{version_to_restore.version_number}",
            prompt_name=prompt_name
        )


# Export service instance
prompt_service = PromptService()
