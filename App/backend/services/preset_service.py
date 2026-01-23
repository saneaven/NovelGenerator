"""Preset service for managing prompt presets"""
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from typing import Optional, List
from datetime import datetime
import uuid

from ..models.db_models import PromptPreset, PromptVersion, PromptFragment, PromptVariable, UserSettings
from ..schemas.presets import (
    PresetListItem,
    PresetResponse,
    PresetDetailResponse,
    ActivePresetResponse
)
from ..prompts import get_default_prompts, get_default_fragments


DEFAULT_PROMPT_NAME = "__default__"

EXPECTED_PROMPT_NAMES_BY_TASK: dict[str, list[str]] = {
    "agent": ["storyObject", "novelEditor", "outlineManager"],
    "editAssistant": ["manuscript", "storyObject"],
    "imagePrompt": ["object", "scene", "coverImage"],
}


class PresetService:
    """Service for managing prompt presets"""

    @staticmethod
    def get_all_presets(
        db: Session,
        user_id: uuid.UUID
    ) -> List[PresetListItem]:
        """
        Get all presets for a user.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of PresetListItem
        """
        # Get active preset ID
        settings = db.query(UserSettings).filter(
            UserSettings.user_id == user_id
        ).first()
        active_preset_id = settings.active_preset_id if settings else None

        # Get all presets
        presets = db.query(PromptPreset).filter(
            PromptPreset.user_id == user_id
        ).order_by(PromptPreset.created_at).all()

        return [
            PresetListItem(
                id=str(preset.id),
                name=preset.name,
                description=preset.description,
                is_active=(preset.id == active_preset_id),
                created_at=preset.created_at,
                updated_at=preset.updated_at
            )
            for preset in presets
        ]

    @staticmethod
    def get_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID
    ) -> Optional[PresetResponse]:
        """
        Get a single preset with counts.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID

        Returns:
            PresetResponse or None if not found
        """
        preset = db.query(PromptPreset).filter(
            and_(
                PromptPreset.id == preset_id,
                PromptPreset.user_id == user_id
            )
        ).first()

        if not preset:
            return None

        # Get counts using subqueries to count latest versions only
        prompt_count = PresetService._count_unique_prompts(db, preset_id)
        fragment_count = PresetService._count_unique_fragments(db, preset_id)
        variable_count = db.query(PromptVariable).filter(
            PromptVariable.preset_id == preset_id
        ).count()

        return PresetResponse(
            id=str(preset.id),
            name=preset.name,
            description=preset.description,
            prompt_count=prompt_count,
            fragment_count=fragment_count,
            variable_count=variable_count,
            created_at=preset.created_at,
            updated_at=preset.updated_at
        )

    @staticmethod
    def _count_unique_prompts(db: Session, preset_id: uuid.UUID) -> int:
        """Count unique prompts (by task_type, category, name combination)"""
        # Use distinct on the identifying columns
        return db.query(
            PromptVersion.task_type,
            PromptVersion.prompt_category,
            PromptVersion.prompt_name
        ).filter(
            PromptVersion.preset_id == preset_id
        ).distinct().count()

    @staticmethod
    def _count_unique_fragments(db: Session, preset_id: uuid.UUID) -> int:
        """Count unique fragments (by folder_path, fragment_name combination)"""
        return db.query(
            PromptFragment.folder_path,
            PromptFragment.fragment_name
        ).filter(
            PromptFragment.preset_id == preset_id
        ).distinct().count()

    @staticmethod
    def create_preset(
        db: Session,
        user_id: uuid.UUID,
        name: str,
        description: Optional[str] = None,
        initialize_with_defaults: bool = True
    ) -> PresetResponse:
        """
        Create a new preset.

        Args:
            db: Database session
            user_id: User ID
            name: Preset name
            description: Optional description
            initialize_with_defaults: Whether to populate with default prompts/fragments

        Returns:
            PresetResponse with new preset details
        """
        now = datetime.utcnow()
        preset = PromptPreset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            description=description,
            created_at=now,
            updated_at=now
        )
        db.add(preset)
        db.flush()  # Get the preset ID

        prompt_count = 0
        fragment_count = 0

        if initialize_with_defaults:
            # Initialize default prompts
            default_prompts = get_default_prompts()
            prompt_count = PresetService._initialize_prompts_for_preset(
                db, user_id, preset.id, default_prompts
            )

            # Initialize default fragments
            default_fragments = get_default_fragments()
            fragment_count = PresetService._initialize_fragments_for_preset(
                db, user_id, preset.id, default_fragments
            )

        db.commit()
        db.refresh(preset)

        return PresetResponse(
            id=str(preset.id),
            name=preset.name,
            description=preset.description,
            prompt_count=prompt_count,
            fragment_count=fragment_count,
            variable_count=0,
            created_at=preset.created_at,
            updated_at=preset.updated_at
        )

    @staticmethod
    def _initialize_prompts_for_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        default_prompts: dict
    ) -> int:
        """Initialize default prompts for a preset. Returns count of prompts created."""
        now = datetime.utcnow()
        count = 0

        for task_type, categories in default_prompts.items():
            for category, prompts in categories.items():
                if isinstance(prompts, dict):
                    for name, content in prompts.items():
                        prompt = PromptVersion(
                            id=uuid.uuid4(),
                            user_id=user_id,
                            preset_id=preset_id,
                            task_type=task_type,
                            prompt_category=category,
                            prompt_name=name,
                            content=content,
                            version_number=1,
                            is_default=True,
                            note="System default",
                            created_at=now
                        )
                        db.add(prompt)
                        count += 1
                else:
                    prompt = PromptVersion(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        preset_id=preset_id,
                        task_type=task_type,
                        prompt_category=category,
                        prompt_name=DEFAULT_PROMPT_NAME,
                        content=prompts,
                        version_number=1,
                        is_default=True,
                        note="System default",
                        created_at=now
                    )
                    db.add(prompt)
                    count += 1

        return count

    @staticmethod
    def _initialize_fragments_for_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        default_fragments: dict
    ) -> int:
        """Initialize default fragments for a preset. Returns count of fragments created."""
        now = datetime.utcnow()
        count = 0

        for path, content in default_fragments.items():
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
                preset_id=preset_id,
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
            count += 1

        return count

    @staticmethod
    def duplicate_preset(
        db: Session,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        new_name: str,
        new_description: Optional[str] = None
    ) -> Optional[PresetResponse]:
        """
        Duplicate an existing preset with all its data.

        Args:
            db: Database session
            user_id: User ID
            source_preset_id: Source preset ID to duplicate
            new_name: Name for the new preset
            new_description: Optional description for the new preset

        Returns:
            PresetResponse with new preset details, or None if source not found
        """
        # Verify source preset exists and belongs to user
        source_preset = db.query(PromptPreset).filter(
            and_(
                PromptPreset.id == source_preset_id,
                PromptPreset.user_id == user_id
            )
        ).first()

        if not source_preset:
            return None

        now = datetime.utcnow()

        # Create new preset
        new_preset = PromptPreset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=new_name,
            description=new_description or source_preset.description,
            created_at=now,
            updated_at=now
        )
        db.add(new_preset)
        db.flush()

        # Copy prompts (latest version of each unique prompt)
        prompt_count = PresetService._copy_prompts(db, user_id, source_preset_id, new_preset.id)

        # Copy fragments (latest version of each unique fragment)
        fragment_count = PresetService._copy_fragments(db, user_id, source_preset_id, new_preset.id)

        # Copy variables
        variable_count = PresetService._copy_variables(db, user_id, source_preset_id, new_preset.id)

        db.commit()
        db.refresh(new_preset)

        return PresetResponse(
            id=str(new_preset.id),
            name=new_preset.name,
            description=new_preset.description,
            prompt_count=prompt_count,
            fragment_count=fragment_count,
            variable_count=variable_count,
            created_at=new_preset.created_at,
            updated_at=new_preset.updated_at
        )

    @staticmethod
    def _copy_prompts(
        db: Session,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        target_preset_id: uuid.UUID
    ) -> int:
        """Copy latest version of each prompt to target preset."""
        # Get all unique prompt identifiers
        unique_prompts = db.query(
            PromptVersion.task_type,
            PromptVersion.prompt_category,
            PromptVersion.prompt_name
        ).filter(
            PromptVersion.preset_id == source_preset_id
        ).distinct().all()

        count = 0
        now = datetime.utcnow()

        for task_type, prompt_category, prompt_name in unique_prompts:
            # Get latest version
            latest = db.query(PromptVersion).filter(
                and_(
                    PromptVersion.preset_id == source_preset_id,
                    PromptVersion.task_type == task_type,
                    PromptVersion.prompt_category == prompt_category,
                    PromptVersion.prompt_name == prompt_name
                )
            ).order_by(PromptVersion.version_number.desc()).first()

            if latest:
                new_prompt = PromptVersion(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=target_preset_id,
                    task_type=latest.task_type,
                    prompt_category=latest.prompt_category,
                    prompt_name=latest.prompt_name,
                    content=latest.content,
                    version_number=1,
                    is_default=False,
                    note=f"Copied from preset",
                    created_at=now
                )
                db.add(new_prompt)
                count += 1

        return count

    @staticmethod
    def _copy_fragments(
        db: Session,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        target_preset_id: uuid.UUID
    ) -> int:
        """Copy latest version of each fragment to target preset."""
        unique_fragments = db.query(
            PromptFragment.folder_path,
            PromptFragment.fragment_name
        ).filter(
            PromptFragment.preset_id == source_preset_id
        ).distinct().all()

        count = 0
        now = datetime.utcnow()

        for folder_path, fragment_name in unique_fragments:
            latest = db.query(PromptFragment).filter(
                and_(
                    PromptFragment.preset_id == source_preset_id,
                    PromptFragment.folder_path == folder_path,
                    PromptFragment.fragment_name == fragment_name
                )
            ).order_by(PromptFragment.version_number.desc()).first()

            if latest:
                new_fragment = PromptFragment(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=target_preset_id,
                    folder_path=latest.folder_path,
                    fragment_name=latest.fragment_name,
                    content=latest.content,
                    description=latest.description,
                    is_system_default=False,
                    version_number=1,
                    note=f"Copied from preset",
                    created_at=now,
                    updated_at=now
                )
                db.add(new_fragment)
                count += 1

        return count

    @staticmethod
    def _copy_variables(
        db: Session,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        target_preset_id: uuid.UUID
    ) -> int:
        """Copy all variables to target preset."""
        variables = db.query(PromptVariable).filter(
            PromptVariable.preset_id == source_preset_id
        ).all()

        count = 0
        now = datetime.utcnow()

        for var in variables:
            new_var = PromptVariable(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=target_preset_id,
                name=var.name,
                var_type=var.var_type,
                value=var.value,
                select_options=var.select_options,
                number_options=var.number_options,
                description=var.description,
                display_order=var.display_order,
                created_at=now,
                updated_at=now
            )
            db.add(new_var)
            count += 1

        return count

    @staticmethod
    def update_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        name: Optional[str] = None,
        description: Optional[str] = None
    ) -> Optional[PresetResponse]:
        """
        Update preset metadata.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID
            name: New name (optional)
            description: New description (optional)

        Returns:
            PresetResponse with updated preset details, or None if not found
        """
        preset = db.query(PromptPreset).filter(
            and_(
                PromptPreset.id == preset_id,
                PromptPreset.user_id == user_id
            )
        ).first()

        if not preset:
            return None

        if name is not None:
            preset.name = name
        if description is not None:
            preset.description = description

        preset.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(preset)

        return PresetService.get_preset(db, user_id, preset_id)

    @staticmethod
    def delete_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID
    ) -> bool:
        """
        Delete a preset and all its data.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID

        Returns:
            True if deleted, False if not found
        """
        # Check if this is the only preset
        preset_count = db.query(PromptPreset).filter(
            PromptPreset.user_id == user_id
        ).count()

        if preset_count <= 1:
            # Cannot delete the last preset
            return False

        # Check if this is the active preset
        settings = db.query(UserSettings).filter(
            UserSettings.user_id == user_id
        ).first()

        preset = db.query(PromptPreset).filter(
            and_(
                PromptPreset.id == preset_id,
                PromptPreset.user_id == user_id
            )
        ).first()

        if not preset:
            return False

        # If deleting active preset, switch to another one
        if settings and settings.active_preset_id == preset_id:
            other_preset = db.query(PromptPreset).filter(
                and_(
                    PromptPreset.user_id == user_id,
                    PromptPreset.id != preset_id
                )
            ).first()
            if other_preset:
                settings.active_preset_id = other_preset.id

        # Delete preset (cascade will delete prompts, fragments, variables)
        db.delete(preset)
        db.commit()
        return True

    @staticmethod
    def get_active_preset(
        db: Session,
        user_id: uuid.UUID
    ) -> Optional[ActivePresetResponse]:
        """
        Get the active preset for a user.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            ActivePresetResponse or None if no active preset
        """
        settings = db.query(UserSettings).filter(
            UserSettings.user_id == user_id
        ).first()

        if not settings or not settings.active_preset_id:
            return None

        preset = db.query(PromptPreset).filter(
            PromptPreset.id == settings.active_preset_id
        ).first()

        if not preset:
            return None

        return ActivePresetResponse(
            id=str(preset.id),
            name=preset.name,
            description=preset.description
        )

    @staticmethod
    def get_active_preset_id(
        db: Session,
        user_id: uuid.UUID
    ) -> Optional[uuid.UUID]:
        """
        Get the active preset ID for a user.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            Active preset UUID or None
        """
        settings = db.query(UserSettings).filter(
            UserSettings.user_id == user_id
        ).first()

        return settings.active_preset_id if settings else None

    @staticmethod
    def set_active_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID
    ) -> bool:
        """
        Set the active preset for a user.

        Args:
            db: Database session
            user_id: User ID
            preset_id: Preset ID to set as active

        Returns:
            True if successful, False if preset not found
        """
        # Verify preset exists and belongs to user
        preset = db.query(PromptPreset).filter(
            and_(
                PromptPreset.id == preset_id,
                PromptPreset.user_id == user_id
            )
        ).first()

        if not preset:
            return False

        # Update user settings
        settings = db.query(UserSettings).filter(
            UserSettings.user_id == user_id
        ).first()

        if settings:
            settings.active_preset_id = preset_id
            settings.updated_at = datetime.utcnow()
            db.commit()
            return True

        return False

    @staticmethod
    def initialize_default_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_name: str = "Default"
    ) -> PromptPreset:
        """
        Initialize a default preset for a new user with default prompts and fragments.

        Args:
            db: Database session
            user_id: User ID
            preset_name: Name for the default preset

        Returns:
            The created PromptPreset
        """
        now = datetime.utcnow()

        # Create the preset
        preset = PromptPreset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=preset_name,
            description="Default prompt preset",
            created_at=now,
            updated_at=now
        )
        db.add(preset)
        db.flush()

        # Initialize default prompts
        default_prompts = get_default_prompts()
        PresetService._initialize_prompts_for_preset(db, user_id, preset.id, default_prompts)

        # Initialize default fragments
        default_fragments = get_default_fragments()
        PresetService._initialize_fragments_for_preset(db, user_id, preset.id, default_fragments)

        return preset

    @staticmethod
    def export_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID
    ) -> Optional[dict]:
        """
        Export a preset with all prompts, fragments, and variables.
        Returns structured dict matching PresetExportData schema.
        """
        # 1. Verify preset exists and belongs to user
        preset = db.query(PromptPreset).filter(
            and_(PromptPreset.id == preset_id, PromptPreset.user_id == user_id)
        ).first()
        if not preset:
            return None

        # 2. Get unique prompts (latest version of each)
        prompts_dict = {}
        unique_prompts = db.query(
            PromptVersion.task_type,
            PromptVersion.prompt_category,
            PromptVersion.prompt_name
        ).filter(PromptVersion.preset_id == preset_id).distinct().all()

        for func_type, category, name in unique_prompts:
            prompt_name = name or DEFAULT_PROMPT_NAME
            latest = db.query(PromptVersion).filter(
                and_(
                    PromptVersion.preset_id == preset_id,
                    PromptVersion.task_type == func_type,
                    PromptVersion.prompt_category == category,
                    PromptVersion.prompt_name == name
                )
            ).order_by(PromptVersion.version_number.desc()).first()

            if latest:
                prompts_dict.setdefault(func_type, {}).setdefault(category, {})[prompt_name] = {
                    "content": latest.content
                }

        # 3. Get unique fragments (latest version of each)
        fragments_dict = {}
        unique_fragments = db.query(
            PromptFragment.folder_path,
            PromptFragment.fragment_name
        ).filter(PromptFragment.preset_id == preset_id).distinct().all()

        for folder_path, fragment_name in unique_fragments:
            latest = db.query(PromptFragment).filter(
                and_(
                    PromptFragment.preset_id == preset_id,
                    PromptFragment.folder_path == folder_path,
                    PromptFragment.fragment_name == fragment_name
                )
            ).order_by(PromptFragment.version_number.desc()).first()

            if latest:
                folder_key = folder_path or "_root"
                if folder_key not in fragments_dict:
                    fragments_dict[folder_key] = {}
                fragments_dict[folder_key][fragment_name] = {
                    "content": latest.content,
                    "description": latest.description
                }

        # 4. Get all variables
        variables = db.query(PromptVariable).filter(
            PromptVariable.preset_id == preset_id
        ).order_by(PromptVariable.display_order).all()

        variables_list = [
            {
                "name": v.name,
                "var_type": v.var_type,
                "value": v.value.get("value") if v.value is not None else None,
                "select_options": v.select_options,
                "number_options": v.number_options,
                "description": v.description,
                "display_order": v.display_order
            }
            for v in variables
        ]

        # 5. Build export structure
        return {
            "format_version": "1.0",
            "preset": {
                "name": preset.name,
                "description": preset.description
            },
            "prompts": prompts_dict,
            "fragments": fragments_dict,
            "variables": variables_list,
            "exported_at": datetime.utcnow().isoformat() + "Z"
        }

    @staticmethod
    def import_preset(
        db: Session,
        user_id: uuid.UUID,
        name: str,
        description: Optional[str],
        data: dict
    ) -> "PresetResponse":
        """
        Import a preset from export data.
        Creates new preset with all prompts, fragments, and variables.
        """
        # 1. Validate format version
        if data.get("format_version") != "1.0":
            raise ValueError(f"Unsupported format version: {data.get('format_version')}")

        now = datetime.utcnow()

        # 2. Create preset
        preset = PromptPreset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            description=description,
            created_at=now,
            updated_at=now
        )
        db.add(preset)
        db.flush()

        prompt_count = 0
        fragment_count = 0
        variable_count = 0

        # 3. Create prompts from nested structure
        prompts_data = data.get("prompts", {})
        for func_type, categories in prompts_data.items():
            for category, content_or_names in categories.items():
                if isinstance(content_or_names, dict) and "content" in content_or_names:
                    # Category-level prompt
                    content = content_or_names["content"]

                    # Preserve legacy category-level prompt under a reserved name
                    prompt = PromptVersion(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        preset_id=preset.id,
                        task_type=func_type,
                        prompt_category=category,
                        prompt_name=DEFAULT_PROMPT_NAME,
                        content=content,
                        version_number=1,
                        is_default=False,
                        note="Imported",
                        created_at=now
                    )
                    db.add(prompt)
                    prompt_count += 1

                    # Backfill expected named prompts for known function types to keep the app usable
                    for expected_name in EXPECTED_PROMPT_NAMES_BY_TASK.get(func_type, []):
                        prompt = PromptVersion(
                            id=uuid.uuid4(),
                            user_id=user_id,
                            preset_id=preset.id,
                            task_type=func_type,
                            prompt_category=category,
                            prompt_name=expected_name,
                            content=content,
                            version_number=1,
                            is_default=False,
                            note=f"Imported (migrated from {DEFAULT_PROMPT_NAME})",
                            created_at=now
                        )
                        db.add(prompt)
                        prompt_count += 1
                else:
                    # Named prompts (workspace, novelEditor, etc.)
                    for prompt_name, prompt_data in content_or_names.items():
                        prompt = PromptVersion(
                            id=uuid.uuid4(),
                            user_id=user_id,
                            preset_id=preset.id,
                            task_type=func_type,
                            prompt_category=category,
                            prompt_name=prompt_name,
                            content=prompt_data["content"],
                            version_number=1,
                            is_default=False,
                            note="Imported",
                            created_at=now
                        )
                        db.add(prompt)
                        prompt_count += 1

        # 4. Create fragments from nested structure
        fragments_data = data.get("fragments", {})
        for folder_key, fragments in fragments_data.items():
            folder_path = None if folder_key == "_root" else folder_key
            for frag_name, frag_data in fragments.items():
                fragment = PromptFragment(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=preset.id,
                    folder_path=folder_path,
                    fragment_name=frag_name,
                    content=frag_data["content"],
                    description=frag_data.get("description"),
                    is_system_default=False,
                    version_number=1,
                    note="Imported",
                    created_at=now,
                    updated_at=now
                )
                db.add(fragment)
                fragment_count += 1

        # 5. Create variables from array
        variables_data = data.get("variables", [])
        for var_data in variables_data:
            variable = PromptVariable(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=preset.id,
                name=var_data["name"],
                var_type=var_data["var_type"],
                value={"value": var_data.get("value")},
                select_options=var_data.get("select_options"),
                number_options=var_data.get("number_options"),
                description=var_data.get("description"),
                display_order=var_data.get("display_order", 0),
                created_at=now,
                updated_at=now
            )
            db.add(variable)
            variable_count += 1

        db.commit()
        db.refresh(preset)

        return PresetResponse(
            id=str(preset.id),
            name=preset.name,
            description=preset.description,
            prompt_count=prompt_count,
            fragment_count=fragment_count,
            variable_count=variable_count,
            created_at=preset.created_at,
            updated_at=preset.updated_at
        )


# Export service instance
preset_service = PresetService()
