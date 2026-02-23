"""Sub Agent service (per prompt preset).

No legacy compatibility / fallback branches:
- Sub Agents are stored as a ScenarioDocument (task_type='subAgent', task_subtype=agent_name)
- Deleting a Sub Agent also deletes its scenario versions
"""

from __future__ import annotations

from datetime import datetime
import re
import uuid
from typing import Dict, List, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models.db_models import PromptScenarioVersion, SubAgentDefinitionModel
from ..schemas.sub_agents import SubAgentCreate, SubAgentDefinition, SubAgentUpdate


_AGENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,49}$")


DEFAULT_SUB_AGENT_SYSTEM_PROMPT = """You are a Sub Agent inside Novel Buds.

You will receive:
- Project context via {{project.*}}
- Your input in the user message

Use tools when helpful.

Do not summarize unless explicitly requested."""

DEFAULT_SUB_AGENT_USER_PROMPT = "{{input.agentMessage}}"
DEFAULT_SUB_AGENT_PREFILL = ""
DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE = "{{input.subAgentMessage}}"


class SubAgentService:
    @staticmethod
    def list_sub_agents(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID) -> List[SubAgentDefinition]:
        items = db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
            )
        ).order_by(SubAgentDefinitionModel.agent_name.asc()).all()
        return [
            SubAgentDefinition(
                id=i.id,
                agent_name=i.agent_name,
                display_name=i.display_name,
                description=(i.description or i.display_name).strip(),
                enabled=i.enabled,
                allowed_invocation_modes=i.allowed_invocation_modes,
                allowed_tool_names=i.allowed_tool_names,
                allowed_sub_agent_ids=i.allowed_sub_agent_ids,
                use_custom_llm_config=i.use_custom_llm_config,
                llm_config_override=i.llm_config_override,
            )
            for i in items
        ]

    @staticmethod
    def get_sub_agent_by_id(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        sub_agent_id: uuid.UUID
    ) -> Optional[SubAgentDefinitionModel]:
        return db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
                SubAgentDefinitionModel.id == sub_agent_id,
            )
        ).first()

    @staticmethod
    def get_sub_agent_by_agent_name(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        agent_name: str
    ) -> Optional[SubAgentDefinitionModel]:
        return db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
                SubAgentDefinitionModel.agent_name == agent_name,
            )
        ).first()

    @staticmethod
    def create_sub_agent(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        data: SubAgentCreate,
        *,
        prompt_templates: Optional[Dict[str, str]] = None,
        prompt_is_default: bool = False,
        prompt_note: str = "SubAgent auto-created",
        commit: bool = True,
    ) -> SubAgentDefinition:
        agent_name = data.agent_name.strip()
        if agent_name.startswith("call_"):
            agent_name = agent_name[5:]
        if len(agent_name) > 50:
            raise ValueError("agent_name must be 50 characters or less")
        if not _AGENT_NAME_RE.match(agent_name):
            raise ValueError("agent_name must match ^[a-z][a-z0-9_]{0,49}$")

        description = data.description.strip()
        if not description:
            raise ValueError("description is required")

        existing = SubAgentService.get_sub_agent_by_agent_name(db, user_id, preset_id, agent_name)
        if existing:
            raise ValueError(f"Sub agent already exists: {agent_name}")

        now = datetime.utcnow()

        use_custom_llm_config = bool(getattr(data, "use_custom_llm_config", False))
        llm_config_override = (
            data.llm_config_override.model_dump(exclude_none=True) if data.llm_config_override is not None else None
        )
        if use_custom_llm_config and not llm_config_override:
            raise ValueError("llm_config_override is required when use_custom_llm_config is true")

        prompt_templates = prompt_templates or {}

        if "systemPrompt" in prompt_templates:
            system_content = prompt_templates["systemPrompt"]
        else:
            system_content = DEFAULT_SUB_AGENT_SYSTEM_PROMPT

        if "userPrompt" in prompt_templates:
            user_content = prompt_templates["userPrompt"]
        else:
            user_content = DEFAULT_SUB_AGENT_USER_PROMPT

        if "prefill" in prompt_templates:
            prefill_content = prompt_templates["prefill"]
        else:
            prefill_content = DEFAULT_SUB_AGENT_PREFILL

        if not system_content.strip():
            raise ValueError("systemPrompt is required")
        if not user_content.strip():
            raise ValueError("userPrompt is required")

        model = SubAgentDefinitionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            agent_name=agent_name,
            display_name=data.display_name,
            description=description,
            enabled=data.enabled,
            allowed_invocation_modes=data.allowed_invocation_modes,
            allowed_tool_names=data.allowed_tool_names,
            allowed_sub_agent_ids=[str(x) for x in data.allowed_sub_agent_ids],
            use_custom_llm_config=use_custom_llm_config,
            llm_config_override=llm_config_override,
            created_at=now,
            updated_at=now,
        )
        db.add(model)

        scenario_doc = {
            "system_template": system_content,
            "blocks": [
                {
                    "id": str(uuid.uuid4()),
                    "block_order": 0,
                    "enabled": True,
                    "type": "rangeMapping",
                    "rangeMapping": {
                        "start_index": 0,
                        "end_index": -1,
                        "user_template": user_content,
                        "assistant_template": DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE,
                    },
                },
                {
                    "id": str(uuid.uuid4()),
                    "block_order": 1,
                    "enabled": True,
                    "type": "staticPrompt",
                    "staticPrompt": {
                        "subtype": "prefill",
                        "role": "assistant",
                        "template": prefill_content,
                    },
                },
            ],
        }

        db.add(
            PromptScenarioVersion(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=preset_id,
                task_type="subAgent",
                task_subtype=agent_name,
                scenario=scenario_doc,
                version_number=1,
                is_default=prompt_is_default,
                note=prompt_note,
                created_at=now,
            )
        )

        if commit:
            db.commit()
            db.refresh(model)
        else:
            # Ensure INSERTs are staged so subsequent operations in the same transaction can see IDs.
            db.flush()

        return SubAgentDefinition(
            id=model.id,
            agent_name=model.agent_name,
            display_name=model.display_name,
            description=(model.description or model.display_name).strip(),
            enabled=model.enabled,
            allowed_invocation_modes=model.allowed_invocation_modes,
            allowed_tool_names=model.allowed_tool_names,
            allowed_sub_agent_ids=model.allowed_sub_agent_ids,
            use_custom_llm_config=model.use_custom_llm_config,
            llm_config_override=model.llm_config_override,
        )

    @staticmethod
    def update_sub_agent(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        sub_agent_id: uuid.UUID,
        data: SubAgentUpdate
    ) -> SubAgentDefinition:
        model = SubAgentService.get_sub_agent_by_id(db, user_id, preset_id, sub_agent_id)
        if not model:
            raise ValueError(f"Sub agent not found: {sub_agent_id}")

        if data.agent_name is not None:
            agent_name = data.agent_name.strip()
            if agent_name.startswith("call_"):
                agent_name = agent_name[5:]
            if len(agent_name) > 50:
                raise ValueError("agent_name must be 50 characters or less")
            if not _AGENT_NAME_RE.match(agent_name):
                raise ValueError("agent_name must match ^[a-z][a-z0-9_]{0,49}$")

            if agent_name != model.agent_name:
                existing = SubAgentService.get_sub_agent_by_agent_name(db, user_id, preset_id, agent_name)
                if existing and existing.id != model.id:
                    raise ValueError(f"Sub agent already exists: {agent_name}")

                old_agent_name = model.agent_name
                model.agent_name = agent_name

                # Rename scenario versions tied to this Sub Agent.
                db.query(PromptScenarioVersion).filter(
                    and_(
                        PromptScenarioVersion.user_id == user_id,
                        PromptScenarioVersion.preset_id == preset_id,
                        PromptScenarioVersion.task_type == "subAgent",
                        PromptScenarioVersion.task_subtype == old_agent_name,
                    )
                ).update(
                    {PromptScenarioVersion.task_subtype: agent_name},
                    synchronize_session=False,
                )

        if data.display_name is not None:
            model.display_name = data.display_name
        if data.description is not None:
            description = data.description.strip()
            if not description:
                raise ValueError("description is required")
            model.description = description
        if data.enabled is not None:
            model.enabled = data.enabled
        if data.allowed_invocation_modes is not None:
            model.allowed_invocation_modes = data.allowed_invocation_modes
        if data.allowed_tool_names is not None:
            model.allowed_tool_names = data.allowed_tool_names
        if data.allowed_sub_agent_ids is not None:
            model.allowed_sub_agent_ids = [str(x) for x in data.allowed_sub_agent_ids]
        if data.use_custom_llm_config is not None:
            model.use_custom_llm_config = bool(data.use_custom_llm_config)
        if data.llm_config_override is not None:
            model.llm_config_override = data.llm_config_override.model_dump(exclude_none=True)

        if model.use_custom_llm_config and not model.llm_config_override:
            raise ValueError("llm_config_override is required when use_custom_llm_config is true")

        model.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(model)

        return SubAgentDefinition(
            id=model.id,
            agent_name=model.agent_name,
            display_name=model.display_name,
            description=(model.description or model.display_name).strip(),
            enabled=model.enabled,
            allowed_invocation_modes=model.allowed_invocation_modes,
            allowed_tool_names=model.allowed_tool_names,
            allowed_sub_agent_ids=model.allowed_sub_agent_ids,
            use_custom_llm_config=model.use_custom_llm_config,
            llm_config_override=model.llm_config_override,
        )

    @staticmethod
    def delete_sub_agent(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID, sub_agent_id: uuid.UUID) -> None:
        model = SubAgentService.get_sub_agent_by_id(db, user_id, preset_id, sub_agent_id)
        if not model:
            raise ValueError(f"Sub agent not found: {sub_agent_id}")

        agent_name = model.agent_name

        # Delete scenarios for this Sub Agent.
        db.query(PromptScenarioVersion).filter(
            and_(
                PromptScenarioVersion.user_id == user_id,
                PromptScenarioVersion.preset_id == preset_id,
                PromptScenarioVersion.task_type == "subAgent",
                PromptScenarioVersion.task_subtype == agent_name,
            )
        ).delete(synchronize_session=False)

        db.delete(model)
        db.commit()


sub_agent_service = SubAgentService()
