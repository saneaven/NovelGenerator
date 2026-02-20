"""Preset service for managing prompt presets"""
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from typing import Optional, List, Dict
from datetime import datetime
import uuid

from pydantic import ValidationError

from ..models.db_models import (
    PromptPreset,
    PromptVersion,
    PromptFragment,
    PromptFolder,
    PromptVariable,
    UserSettings,
    SubAgentDefinitionModel,
)
from ..schemas.settings import TaskAIConfig
from ..schemas.presets import (
    PresetListItem,
    PresetResponse,
    PresetDetailResponse,
    ActivePresetResponse
)
from ..prompts import get_default_prompts, get_default_fragments
from .folder_service import FolderService
from .sub_agent_seed_service import seed_default_sub_agents


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
        """Count unique prompts (by task_type, task_subtype, category combination)"""
        return db.query(
            PromptVersion.task_type,
            PromptVersion.task_subtype,
            PromptVersion.prompt_category,
        ).filter(
            PromptVersion.preset_id == preset_id
        ).distinct().count()

    @staticmethod
    def _count_unique_fragments(db: Session, preset_id: uuid.UUID) -> int:
        """Count unique fragments (by folder_id, fragment_name combination)"""
        return db.query(
            PromptFragment.folder_id,
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

            # Seed default Sub Agents (user-editable, per preset)
            seed_default_sub_agents(db, user_id=user_id, preset_id=preset.id)

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

        for task_type, subtypes in default_prompts.items():
            for task_subtype, categories in subtypes.items():
                if not isinstance(categories, dict):
                    raise ValueError("Default prompts must be nested as {task_type: {task_subtype: {category: content}}}.")

                for category, content in categories.items():
                    prompt = PromptVersion(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        preset_id=preset_id,
                        task_type=task_type,
                        task_subtype=task_subtype,
                        prompt_category=category,
                        content=content,
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
        folder_cache: dict[str, uuid.UUID] = {}

        for path, content in default_fragments.items():
            if '/' in path:
                parts = path.rsplit('/', 1)
                folder_path_str = parts[0]
                fragment_name = parts[1]

                if folder_path_str not in folder_cache:
                    folder = FolderService.get_or_create_folder_by_path(
                        db, user_id, preset_id, folder_path_str
                    )
                    folder_cache[folder_path_str] = folder.id
                folder_id = folder_cache[folder_path_str]
            else:
                folder_id = None
                fragment_name = path

            fragment = PromptFragment(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=preset_id,
                folder_id=folder_id,
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

        # Copy sub agents (definitions only; prompts are already duplicated above)
        PresetService._copy_sub_agents(db, user_id, source_preset_id, new_preset.id)

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
            PromptVersion.task_subtype,
            PromptVersion.prompt_category,
        ).filter(
            PromptVersion.preset_id == source_preset_id
        ).distinct().all()

        count = 0
        now = datetime.utcnow()

        for task_type, task_subtype, prompt_category in unique_prompts:
            # Get latest version
            latest = db.query(PromptVersion).filter(
                and_(
                    PromptVersion.preset_id == source_preset_id,
                    PromptVersion.task_type == task_type,
                    PromptVersion.task_subtype == task_subtype,
                    PromptVersion.prompt_category == prompt_category,
                )
            ).order_by(PromptVersion.version_number.desc()).first()

            if latest:
                new_prompt = PromptVersion(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=target_preset_id,
                    task_type=latest.task_type,
                    task_subtype=latest.task_subtype,
                    prompt_category=latest.prompt_category,
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
        """Copy folder tree + latest version of each fragment to target preset."""
        # Copy folder tree first, get old→new ID mapping
        folder_id_map = FolderService.copy_folder_tree(
            db, user_id, source_preset_id, target_preset_id
        )

        unique_fragments = db.query(
            PromptFragment.folder_id,
            PromptFragment.fragment_name
        ).filter(
            PromptFragment.preset_id == source_preset_id
        ).distinct().all()

        count = 0
        now = datetime.utcnow()

        for folder_id, fragment_name in unique_fragments:
            latest = db.query(PromptFragment).filter(
                and_(
                    PromptFragment.preset_id == source_preset_id,
                    PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                    PromptFragment.fragment_name == fragment_name
                )
            ).order_by(PromptFragment.version_number.desc()).first()

            if latest:
                new_folder_id = folder_id_map.get(latest.folder_id) if latest.folder_id else None
                new_fragment = PromptFragment(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=target_preset_id,
                    folder_id=new_folder_id,
                    fragment_name=latest.fragment_name,
                    content=latest.content,
                    description=latest.description,
                    is_system_default=False,
                    version_number=1,
                    note="Copied from preset",
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
    def _copy_sub_agents(
        db: Session,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        target_preset_id: uuid.UUID
    ) -> int:
        """Copy sub agent definitions to target preset (prompts are copied separately)."""
        subs = db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == source_preset_id,
            )
        ).all()

        if not subs:
            return 0

        id_map = {s.id: uuid.uuid4() for s in subs}
        now = datetime.utcnow()

        for s in subs:
            mapped_allowed: List[str] = []
            for raw in s.allowed_sub_agent_ids or []:
                try:
                    ref = uuid.UUID(str(raw))
                except ValueError:
                    continue
                if ref in id_map:
                    mapped_allowed.append(str(id_map[ref]))

            db.add(SubAgentDefinitionModel(
                id=id_map[s.id],
                user_id=user_id,
                preset_id=target_preset_id,
                agent_name=s.agent_name,
                display_name=s.display_name,
                description=(s.description or s.display_name).strip(),
                enabled=s.enabled,
                allowed_invocation_modes=s.allowed_invocation_modes,
                allowed_tool_names=s.allowed_tool_names,
                allowed_sub_agent_ids=mapped_allowed,
                use_custom_llm_config=s.use_custom_llm_config,
                llm_config_override=s.llm_config_override,
                created_at=now,
                updated_at=now,
            ))

        return len(subs)

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

        # Seed default Sub Agents (user-editable, per preset)
        seed_default_sub_agents(db, user_id=user_id, preset_id=preset.id)

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
            PromptVersion.task_subtype,
            PromptVersion.prompt_category,
        ).filter(PromptVersion.preset_id == preset_id).distinct().all()

        for task_type, task_subtype, category in unique_prompts:
            latest = db.query(PromptVersion).filter(
                and_(
                    PromptVersion.preset_id == preset_id,
                    PromptVersion.task_type == task_type,
                    PromptVersion.task_subtype == task_subtype,
                    PromptVersion.prompt_category == category,
                )
            ).order_by(PromptVersion.version_number.desc()).first()

            if latest:
                prompts_dict.setdefault(task_type, {}).setdefault(task_subtype, {})[category] = {
                    "content": latest.content
                }

        # 3. Get unique fragments (latest version of each)
        fragments_dict = {}
        path_cache = FolderService.build_folder_path_cache(db, preset_id)

        unique_fragments = db.query(
            PromptFragment.folder_id,
            PromptFragment.fragment_name
        ).filter(PromptFragment.preset_id == preset_id).distinct().all()

        for folder_id, fragment_name in unique_fragments:
            latest = db.query(PromptFragment).filter(
                and_(
                    PromptFragment.preset_id == preset_id,
                    PromptFragment.folder_id == folder_id if folder_id else PromptFragment.folder_id.is_(None),
                    PromptFragment.fragment_name == fragment_name
                )
            ).order_by(PromptFragment.version_number.desc()).first()

            if latest:
                folder_key = path_cache.get(latest.folder_id, "_root") if latest.folder_id else "_root"
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

        # 4.5 Get sub agents for this preset
        sub_agents = db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
            )
        ).order_by(SubAgentDefinitionModel.agent_name.asc()).all()

        sub_agents_list = [
            {
                "id": str(s.id),
                "agent_name": s.agent_name,
                "display_name": s.display_name,
                "description": (s.description or s.display_name).strip(),
                "enabled": s.enabled,
                "allowed_invocation_modes": s.allowed_invocation_modes,
                "allowed_tool_names": s.allowed_tool_names,
                "allowed_sub_agent_ids": s.allowed_sub_agent_ids,
                "use_custom_llm_config": s.use_custom_llm_config,
                "llm_config_override": s.llm_config_override,
            }
            for s in sub_agents
        ]

        # 5. Build export structure
        return {
            "format_version": 1,
            "preset": {
                "name": preset.name,
                "description": preset.description
            },
            "prompts": prompts_dict,
            "fragments": fragments_dict,
            "variables": variables_list,
            "sub_agents": sub_agents_list,
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
        # 1. Validate format version (single current format; no legacy parsing / migrations)
        if data.get("format_version") != 1:
            raise ValueError(f"Unsupported format version: {data.get('format_version')}")

        # 1.1 Require sub_agents key (can be empty list)
        if "sub_agents" not in data or not isinstance(data.get("sub_agents"), list):
            raise ValueError("Invalid preset file: missing sub_agents")

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

        # 3. Create prompts from nested structure (named prompts only, no legacy backfill)
        prompts_data = data.get("prompts", {})
        if not isinstance(prompts_data, dict):
            raise ValueError("Invalid preset file: prompts must be an object")

        for task_type, subtypes in prompts_data.items():
            if not isinstance(subtypes, dict):
                raise ValueError("Invalid preset file: prompts subtypes must be an object")

            for task_subtype, categories in subtypes.items():
                if not isinstance(categories, dict):
                    raise ValueError("Invalid preset file: prompts categories must be an object")

                for category, prompt_data in categories.items():
                    if not isinstance(prompt_data, dict) or "content" not in prompt_data:
                        raise ValueError("Invalid preset file: prompt must have content")

                    db.add(PromptVersion(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        preset_id=preset.id,
                        task_type=str(task_type),
                        task_subtype=str(task_subtype),
                        prompt_category=str(category),
                        content=str(prompt_data["content"]),
                        version_number=1,
                        is_default=False,
                        note="Imported",
                        created_at=now,
                    ))
                    prompt_count += 1

        # 4. Create fragments from nested structure
        fragments_data = data.get("fragments", {})
        import_folder_cache: dict[str, uuid.UUID] = {}

        for folder_key, fragments in fragments_data.items():
            if folder_key == "_root":
                folder_id = None
            else:
                if folder_key not in import_folder_cache:
                    folder = FolderService.get_or_create_folder_by_path(
                        db, user_id, preset.id, folder_key
                    )
                    import_folder_cache[folder_key] = folder.id
                folder_id = import_folder_cache[folder_key]

            for frag_name, frag_data in fragments.items():
                fragment = PromptFragment(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=preset.id,
                    folder_id=folder_id,
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

        # 6. Create sub agents (definitions)
        sub_agents_data = data.get("sub_agents", [])

        id_map: Dict[uuid.UUID, uuid.UUID] = {}
        for sa_data in sub_agents_data:
            if not isinstance(sa_data, dict):
                raise ValueError("Invalid preset file: sub_agents entries must be objects")

            required = [
                "id",
                "agent_name",
                "display_name",
                "description",
                "allowed_invocation_modes",
                "allowed_tool_names",
                "allowed_sub_agent_ids",
                "use_custom_llm_config",
                "llm_config_override",
                "enabled",
            ]
            missing = [k for k in required if k not in sa_data]
            if missing:
                raise ValueError(f"Invalid preset file: sub_agents missing fields: {', '.join(missing)}")

            old_id = uuid.UUID(str(sa_data["id"]))
            id_map[old_id] = uuid.uuid4()

        for sa_data in sub_agents_data:
            old_id = uuid.UUID(str(sa_data["id"]))
            new_id = id_map[old_id]

            mapped_allowed: List[str] = []
            for raw in sa_data.get("allowed_sub_agent_ids", []) or []:
                try:
                    ref = uuid.UUID(str(raw))
                except ValueError:
                    continue
                if ref in id_map:
                    mapped_allowed.append(str(id_map[ref]))

            description = str(sa_data["description"]).strip()
            if not description:
                raise ValueError("Invalid preset file: sub_agents.description is required")

            use_custom_llm_config = bool(sa_data.get("use_custom_llm_config", False))
            llm_config_override = sa_data.get("llm_config_override")
            if use_custom_llm_config and not llm_config_override:
                raise ValueError("Invalid preset file: sub_agents.llm_config_override is required when use_custom_llm_config is true")

            if llm_config_override is not None:
                if not isinstance(llm_config_override, dict):
                    raise ValueError("Invalid preset file: sub_agents.llm_config_override must be an object or null")
                try:
                    TaskAIConfig.model_validate(llm_config_override)
                except ValidationError as e:
                    raise ValueError(f"Invalid preset file: sub_agents.llm_config_override is invalid: {e}") from e

            db.add(SubAgentDefinitionModel(
                id=new_id,
                user_id=user_id,
                preset_id=preset.id,
                agent_name=str(sa_data["agent_name"]),
                display_name=str(sa_data["display_name"]),
                description=description,
                enabled=bool(sa_data.get("enabled", True)),
                allowed_invocation_modes=sa_data.get("allowed_invocation_modes", []),
                allowed_tool_names=sa_data.get("allowed_tool_names", []),
                allowed_sub_agent_ids=mapped_allowed,
                use_custom_llm_config=use_custom_llm_config,
                llm_config_override=llm_config_override,
                created_at=now,
                updated_at=now,
            ))

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
