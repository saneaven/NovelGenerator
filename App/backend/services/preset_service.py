"""Preset service for managing prompt presets"""
import copy
from enum import Enum
from datetime import datetime
import uuid

from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import Optional, List

from ..models.db_models import (
    PromptPreset,
    PromptScenarioVersion,
    PromptFragment,
    PromptVariable,
    UserSettings,
    SubAgentDefinitionModel,
)
from ..schemas.presets import (
    PresetExportData,
    PresetListItem,
    PresetResponse,
    PresetDetailResponse,
    ActivePresetResponse
)
from .folder_service import FolderService
from .default_preset_seed import NormalizedPresetSeed, load_default_preset_seed, normalize_preset_seed


class SeedApplyMode(str, Enum):
    SYSTEM_DEFAULT = "system_default"
    IMPORTED = "imported"


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
        """Count unique scenarios (by task_type, task_subtype combination)."""
        return db.query(
            PromptScenarioVersion.task_type,
            PromptScenarioVersion.task_subtype,
        ).filter(
            PromptScenarioVersion.preset_id == preset_id
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
    def _create_preset_row(
        db: Session,
        user_id: uuid.UUID,
        *,
        name: str,
        description: Optional[str],
    ) -> PromptPreset:
        now = datetime.utcnow()
        preset = PromptPreset(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            description=description,
            created_at=now,
            updated_at=now,
        )
        db.add(preset)
        db.flush()
        return preset

    @staticmethod
    def _apply_seed_to_preset(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        seed: NormalizedPresetSeed,
        *,
        mode: SeedApplyMode,
    ) -> tuple[int, int, int]:
        now = datetime.utcnow()
        scenario_count = 0
        fragment_count = 0
        variable_count = 0
        folder_cache: dict[str, uuid.UUID] = {}

        is_default = mode == SeedApplyMode.SYSTEM_DEFAULT
        note = "System default" if is_default else "Imported"

        for item in seed.scenarios:
            db.add(
                PromptScenarioVersion(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=preset_id,
                    task_type=item.task_type,
                    task_subtype=item.task_subtype,
                    scenario=copy.deepcopy(item.scenario),
                    version_number=1,
                    is_default=is_default,
                    note=note,
                    created_at=now,
                )
            )
            scenario_count += 1

        for item in seed.fragments:
            if item.folder_key == "_root":
                folder_id = None
            else:
                folder_id = folder_cache.get(item.folder_key)
                if folder_id is None:
                    folder = FolderService.get_or_create_folder_by_path(
                        db, user_id, preset_id, item.folder_key
                    )
                    folder_id = folder.id
                    folder_cache[item.folder_key] = folder_id

            db.add(
                PromptFragment(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=preset_id,
                    folder_id=folder_id,
                    fragment_name=item.fragment_name,
                    content=item.content,
                    description=item.description,
                    version_number=1,
                    note=note,
                    created_at=now,
                    updated_at=now,
                )
            )
            fragment_count += 1

        for item in seed.variables:
            db.add(
                PromptVariable(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=preset_id,
                    name=item.name,
                    var_type=item.var_type,
                    value={"value": item.value},
                    select_options=item.select_options,
                    number_options=item.number_options,
                    description=item.description,
                    display_order=item.display_order,
                    created_at=now,
                    updated_at=now,
                )
            )
            variable_count += 1

        id_map = {item.id: uuid.uuid4() for item in seed.sub_agents}
        for item in seed.sub_agents:
            llm_config_override = (
                item.llm_config_override.model_dump(exclude_none=True)
                if item.llm_config_override is not None
                else None
            )
            mapped_allowed = [str(id_map[ref]) for ref in item.allowed_sub_agent_ids if ref in id_map]

            db.add(
                SubAgentDefinitionModel(
                    id=id_map[item.id],
                    user_id=user_id,
                    preset_id=preset_id,
                    agent_name=item.agent_name,
                    display_name=item.display_name,
                    description=(item.description or item.display_name).strip(),
                    enabled=item.enabled,
                    allowed_invocation_modes=list(item.allowed_invocation_modes),
                    allowed_tool_names=list(item.allowed_tool_names),
                    allowed_sub_agent_ids=mapped_allowed,
                    use_custom_llm_config=item.use_custom_llm_config,
                    llm_config_override=llm_config_override,
                    created_at=now,
                    updated_at=now,
                )
            )

        return scenario_count, fragment_count, variable_count

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
        preset = PresetService._create_preset_row(
            db,
            user_id,
            name=name,
            description=description,
        )

        prompt_count = 0
        fragment_count = 0
        variable_count = 0

        if initialize_with_defaults:
            seed = load_default_preset_seed()
            prompt_count, fragment_count, variable_count = PresetService._apply_seed_to_preset(
                db,
                user_id,
                preset.id,
                seed,
                mode=SeedApplyMode.SYSTEM_DEFAULT,
            )

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

        # Copy scenarios (latest version of each unique scenario)
        prompt_count = PresetService._copy_scenarios(db, user_id, source_preset_id, new_preset.id)

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
    def _copy_scenarios(
        db: Session,
        user_id: uuid.UUID,
        source_preset_id: uuid.UUID,
        target_preset_id: uuid.UUID
    ) -> int:
        """Copy latest version of each scenario to target preset."""
        unique_scenarios = db.query(
            PromptScenarioVersion.task_type,
            PromptScenarioVersion.task_subtype,
        ).filter(
            PromptScenarioVersion.preset_id == source_preset_id
        ).distinct().all()

        count = 0
        now = datetime.utcnow()

        for task_type, task_subtype in unique_scenarios:
            latest = db.query(PromptScenarioVersion).filter(
                and_(
                    PromptScenarioVersion.preset_id == source_preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            ).order_by(PromptScenarioVersion.version_number.desc()).first()

            if latest:
                new_row = PromptScenarioVersion(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    preset_id=target_preset_id,
                    task_type=latest.task_type,
                    task_subtype=latest.task_subtype,
                    scenario=latest.scenario if isinstance(latest.scenario, dict) else {},
                    version_number=1,
                    is_default=False,
                    note=f"Copied from preset",
                    created_at=now
                )
                db.add(new_row)
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
        preset_name: Optional[str] = None
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
        seed = load_default_preset_seed()
        preset = PresetService._create_preset_row(
            db,
            user_id,
            name=preset_name or seed.preset_name,
            description=seed.preset_description,
        )
        PresetService._apply_seed_to_preset(
            db,
            user_id,
            preset.id,
            seed,
            mode=SeedApplyMode.SYSTEM_DEFAULT,
        )

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
        unique_scenarios = db.query(
            PromptScenarioVersion.task_type,
            PromptScenarioVersion.task_subtype,
        ).filter(PromptScenarioVersion.preset_id == preset_id).distinct().all()

        for task_type, task_subtype in unique_scenarios:
            latest = db.query(PromptScenarioVersion).filter(
                and_(
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            ).order_by(PromptScenarioVersion.version_number.desc()).first()

            if latest:
                prompts_dict.setdefault(task_type, {})[task_subtype] = (
                    latest.scenario if isinstance(latest.scenario, dict) else {}
                )

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
        data: PresetExportData
    ) -> "PresetResponse":
        """
        Import a preset from export data.
        Creates new preset with all prompts, fragments, and variables.
        """
        if data.format_version != 1:
            raise ValueError(f"Unsupported format version: {data.format_version}")

        preset = PresetService._create_preset_row(
            db,
            user_id,
            name=name,
            description=description,
        )
        seed = normalize_preset_seed(data)
        prompt_count, fragment_count, variable_count = PresetService._apply_seed_to_preset(
            db,
            user_id,
            preset.id,
            seed,
            mode=SeedApplyMode.IMPORTED,
        )

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
