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
        function_type: str,
        prompt_category: str,
        prompt_name: Optional[str] = None
    ) -> Optional[PromptContentResponse]:
        """
        Get the currently active prompt for a user.

        Args:
            db: Database session
            user_id: User ID
            function_type: Function type (chat, translation, etc.)
            prompt_category: Prompt category (systemPrompt, prefill, etc.)
            prompt_name: Optional prompt name (workspace, novelEditor, etc.)

        Returns:
            PromptContentResponse or None if not found
        """
        prompt = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.function_type == function_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name,
                PromptVersion.is_active == True
            )
        ).first()

        if not prompt:
            return None

        return PromptContentResponse(
            content=prompt.content,
            version_number=prompt.version_number,
            created_at=prompt.created_at,
            is_default=prompt.is_default
        )

    @staticmethod
    def save_new_version(
        db: Session,
        user_id: uuid.UUID,
        function_type: str,
        prompt_category: str,
        content: str,
        note: Optional[str] = None,
        prompt_name: Optional[str] = None
    ) -> PromptVersionResponse:
        """
        Save a new version of a prompt and set it as active.

        Args:
            db: Database session
            user_id: User ID
            function_type: Function type
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
                PromptVersion.function_type == function_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name
            )
        ).order_by(desc(PromptVersion.version_number)).first()

        new_version_number = (max_version.version_number + 1) if max_version else 1

        # Deactivate all existing versions for this prompt
        db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.function_type == function_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name
            )
        ).update({'is_active': False})

        # Create new version
        new_prompt = PromptVersion(
            id=uuid.uuid4(),
            user_id=user_id,
            function_type=function_type,
            prompt_category=prompt_category,
            prompt_name=prompt_name,
            content=content,
            version_number=new_version_number,
            is_active=True,
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
            is_active=new_prompt.is_active,
            is_default=new_prompt.is_default,
            created_at=new_prompt.created_at,
            note=new_prompt.note
        )

    @staticmethod
    def get_version_history(
        db: Session,
        user_id: uuid.UUID,
        function_type: str,
        prompt_category: str,
        prompt_name: Optional[str] = None
    ) -> List[VersionHistoryItem]:
        """
        Get version history for a prompt.

        Args:
            db: Database session
            user_id: User ID
            function_type: Function type
            prompt_category: Prompt category
            prompt_name: Optional prompt name

        Returns:
            List of VersionHistoryItem ordered by version number (descending)
        """
        versions = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.function_type == function_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name
            )
        ).order_by(desc(PromptVersion.version_number)).all()

        return [
            VersionHistoryItem(
                version_number=v.version_number,
                created_at=v.created_at,
                note=v.note,
                is_active=v.is_active,
                is_default=v.is_default,
                preview=v.content[:200] + ('...' if len(v.content) > 200 else '')
            )
            for v in versions
        ]

    @staticmethod
    def restore_version(
        db: Session,
        user_id: uuid.UUID,
        function_type: str,
        prompt_category: str,
        version_number: int,
        prompt_name: Optional[str] = None
    ) -> bool:
        """
        Restore a specific version by setting it as active.

        Args:
            db: Database session
            user_id: User ID
            function_type: Function type
            prompt_category: Prompt category
            version_number: Version number to restore
            prompt_name: Optional prompt name

        Returns:
            True if version was found and restored, False otherwise
        """
        # Find the version to restore
        version_to_restore = db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.function_type == function_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name,
                PromptVersion.version_number == version_number
            )
        ).first()

        if not version_to_restore:
            return False

        # Deactivate all versions
        db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.function_type == function_type,
                PromptVersion.prompt_category == prompt_category,
                PromptVersion.prompt_name == prompt_name
            )
        ).update({'is_active': False})

        # Activate the target version
        version_to_restore.is_active = True

        db.commit()
        return True

    @staticmethod
    def initialize_default_prompts(
        db: Session,
        user_id: uuid.UUID,
        default_prompts: dict
    ) -> None:
        """
        Initialize default prompts for a new user.

        Args:
            db: Database session
            user_id: User ID
            default_prompts: Dictionary of default prompt contents
                Format: {function_type: {category: {name?: content}}}
        """
        for function_type, categories in default_prompts.items():
            for category, prompts in categories.items():
                if isinstance(prompts, dict):
                    # Multiple prompts (e.g., chat has workspace and novelEditor)
                    for name, content in prompts.items():
                        PromptService._create_default_prompt(
                            db, user_id, function_type, category, content, name
                        )
                else:
                    # Single prompt (e.g., translation has one systemPrompt)
                    PromptService._create_default_prompt(
                        db, user_id, function_type, category, prompts, None
                    )

        db.commit()

    @staticmethod
    def _create_default_prompt(
        db: Session,
        user_id: uuid.UUID,
        function_type: str,
        prompt_category: str,
        content: str,
        prompt_name: Optional[str] = None
    ) -> None:
        """Create a default prompt version (v1)"""
        default_prompt = PromptVersion(
            id=uuid.uuid4(),
            user_id=user_id,
            function_type=function_type,
            prompt_category=prompt_category,
            prompt_name=prompt_name,
            content=content,
            version_number=1,
            is_active=True,
            is_default=True,
            note="System default",
            created_at=datetime.utcnow()
        )
        db.add(default_prompt)


# Export service instance
prompt_service = PromptService()
