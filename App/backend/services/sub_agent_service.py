"""Sub Agent service (per prompt preset).

No legacy compatibility / fallback branches:
- Sub Agents always have 3 prompt templates (systemPrompt/userPrompt/prefill)
- Deleting a Sub Agent also deletes its prompt versions
"""

from __future__ import annotations

from datetime import datetime
import re
import uuid
from typing import List, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models.db_models import PromptVersion, SubAgentDefinitionModel
from ..schemas.sub_agents import SubAgentCreate, SubAgentDefinition, SubAgentUpdate


_AGENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,49}$")


DEFAULT_SUB_AGENT_SYSTEM_PROMPT = """You are a Sub Agent inside Novel Buds.

You will receive:
- Project context via {{project.*}}
- Your input in the user message

Use tools when helpful.

When you are completely done, call `return_sub_agent_result` with the full final output in `result`.

Rules:
- Call `return_sub_agent_result` exactly once per invocation.
- `return_sub_agent_result` must be the ONLY tool call in the final message.
- Do other tool calls first; call `return_sub_agent_result` alone as the last step.

Do not summarize unless explicitly requested."""

DEFAULT_SUB_AGENT_USER_PROMPT = "{{input.agentMessage}}"
DEFAULT_SUB_AGENT_PREFILL = ""


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
                allowed_agent_modes=i.allowed_agent_modes,
                allowed_tool_names=i.allowed_tool_names,
                allowed_sub_agent_ids=i.allowed_sub_agent_ids,
                llm_config=i.llm_config,
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
    def create_sub_agent(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID, data: SubAgentCreate) -> SubAgentDefinition:
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

        model = SubAgentDefinitionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            agent_name=agent_name,
            display_name=data.display_name,
            description=description,
            enabled=data.enabled,
            allowed_agent_modes=data.allowed_agent_modes,
            allowed_tool_names=data.allowed_tool_names,
            allowed_sub_agent_ids=[str(x) for x in data.allowed_sub_agent_ids],
            llm_config=data.llm_config,
            created_at=now,
            updated_at=now,
        )
        db.add(model)

        # Create the 3 required prompt templates (no fallback).
        db.add_all([
            PromptVersion(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=preset_id,
                task_type="subAgent",
                prompt_category="systemPrompt",
                prompt_name=agent_name,
                content=DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
                version_number=1,
                is_default=False,
                note="SubAgent auto-created",
                created_at=now,
            ),
            PromptVersion(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=preset_id,
                task_type="subAgent",
                prompt_category="userPrompt",
                prompt_name=agent_name,
                content=DEFAULT_SUB_AGENT_USER_PROMPT,
                version_number=1,
                is_default=False,
                note="SubAgent auto-created",
                created_at=now,
            ),
            PromptVersion(
                id=uuid.uuid4(),
                user_id=user_id,
                preset_id=preset_id,
                task_type="subAgent",
                prompt_category="prefill",
                prompt_name=agent_name,
                content=DEFAULT_SUB_AGENT_PREFILL,
                version_number=1,
                is_default=False,
                note="SubAgent auto-created",
                created_at=now,
            ),
        ])

        db.commit()
        db.refresh(model)

        return SubAgentDefinition(
            id=model.id,
            agent_name=model.agent_name,
            display_name=model.display_name,
            description=(model.description or model.display_name).strip(),
            enabled=model.enabled,
            allowed_agent_modes=model.allowed_agent_modes,
            allowed_tool_names=model.allowed_tool_names,
            allowed_sub_agent_ids=model.allowed_sub_agent_ids,
            llm_config=model.llm_config,
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

                # Rename prompt versions tied to this Sub Agent (no fallback).
                db.query(PromptVersion).filter(
                    and_(
                        PromptVersion.user_id == user_id,
                        PromptVersion.preset_id == preset_id,
                        PromptVersion.task_type == "subAgent",
                        PromptVersion.prompt_name == old_agent_name,
                    )
                ).update(
                    {PromptVersion.prompt_name: agent_name},
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
        if data.allowed_agent_modes is not None:
            model.allowed_agent_modes = data.allowed_agent_modes
        if data.allowed_tool_names is not None:
            model.allowed_tool_names = data.allowed_tool_names
        if data.allowed_sub_agent_ids is not None:
            model.allowed_sub_agent_ids = [str(x) for x in data.allowed_sub_agent_ids]
        if data.llm_config is not None:
            model.llm_config = data.llm_config

        model.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(model)

        return SubAgentDefinition(
            id=model.id,
            agent_name=model.agent_name,
            display_name=model.display_name,
            description=(model.description or model.display_name).strip(),
            enabled=model.enabled,
            allowed_agent_modes=model.allowed_agent_modes,
            allowed_tool_names=model.allowed_tool_names,
            allowed_sub_agent_ids=model.allowed_sub_agent_ids,
            llm_config=model.llm_config,
        )

    @staticmethod
    def delete_sub_agent(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID, sub_agent_id: uuid.UUID) -> None:
        model = SubAgentService.get_sub_agent_by_id(db, user_id, preset_id, sub_agent_id)
        if not model:
            raise ValueError(f"Sub agent not found: {sub_agent_id}")

        agent_name = model.agent_name

        # Delete prompts for this Sub Agent.
        db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == "subAgent",
                PromptVersion.prompt_name == agent_name,
            )
        ).delete(synchronize_session=False)

        db.delete(model)
        db.commit()


sub_agent_service = SubAgentService()
