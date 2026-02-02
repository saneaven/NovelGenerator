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


_SUB_AGENT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


DEFAULT_SUB_AGENT_SYSTEM_PROMPT = """You are a Sub Agent inside Novel Buds.

You will receive:
- Project context via {{project.*}}
- Your input via {{input.subagent}}

Use tools when helpful. Return the final answer as plain text."""

DEFAULT_SUB_AGENT_USER_PROMPT = "{{input.userMessage}}"
DEFAULT_SUB_AGENT_PREFILL = ""


class SubAgentService:
    @staticmethod
    def list_sub_agents(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID) -> List[SubAgentDefinition]:
        items = db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
            )
        ).order_by(SubAgentDefinitionModel.sub_agent_id.asc()).all()
        return [
            SubAgentDefinition(
                sub_agent_id=i.sub_agent_id,
                display_name=i.display_name,
                description=i.description,
                enabled=i.enabled,
                allowed_agent_modes=i.allowed_agent_modes,
                allowed_tool_names=i.allowed_tool_names,
                llm_config=i.llm_config,
            )
            for i in items
        ]

    @staticmethod
    def get_sub_agent(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID, sub_agent_id: str) -> Optional[SubAgentDefinitionModel]:
        return db.query(SubAgentDefinitionModel).filter(
            and_(
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
                SubAgentDefinitionModel.sub_agent_id == sub_agent_id,
            )
        ).first()

    @staticmethod
    def create_sub_agent(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID, data: SubAgentCreate) -> SubAgentDefinition:
        sub_agent_id = data.sub_agent_id.strip()
        if len(sub_agent_id) > 50:
            raise ValueError("sub_agent_id must be 50 characters or less")
        if not _SUB_AGENT_ID_RE.match(sub_agent_id):
            raise ValueError("sub_agent_id must match ^[a-zA-Z0-9_-]+$")

        existing = SubAgentService.get_sub_agent(db, user_id, preset_id, sub_agent_id)
        if existing:
            raise ValueError(f"Sub agent already exists: {sub_agent_id}")

        now = datetime.utcnow()

        model = SubAgentDefinitionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_id=preset_id,
            sub_agent_id=sub_agent_id,
            display_name=data.display_name,
            description=data.description,
            enabled=data.enabled,
            allowed_agent_modes=data.allowed_agent_modes,
            allowed_tool_names=data.allowed_tool_names,
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
                prompt_name=sub_agent_id,
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
                prompt_name=sub_agent_id,
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
                prompt_name=sub_agent_id,
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
            sub_agent_id=model.sub_agent_id,
            display_name=model.display_name,
            description=model.description,
            enabled=model.enabled,
            allowed_agent_modes=model.allowed_agent_modes,
            allowed_tool_names=model.allowed_tool_names,
            llm_config=model.llm_config,
        )

    @staticmethod
    def update_sub_agent(
        db: Session,
        user_id: uuid.UUID,
        preset_id: uuid.UUID,
        sub_agent_id: str,
        data: SubAgentUpdate
    ) -> SubAgentDefinition:
        model = SubAgentService.get_sub_agent(db, user_id, preset_id, sub_agent_id)
        if not model:
            raise ValueError(f"Sub agent not found: {sub_agent_id}")

        if data.display_name is not None:
            model.display_name = data.display_name
        if data.description is not None:
            model.description = data.description
        if data.enabled is not None:
            model.enabled = data.enabled
        if data.allowed_agent_modes is not None:
            model.allowed_agent_modes = data.allowed_agent_modes
        if data.allowed_tool_names is not None:
            model.allowed_tool_names = data.allowed_tool_names
        if data.llm_config is not None:
            model.llm_config = data.llm_config

        model.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(model)

        return SubAgentDefinition(
            sub_agent_id=model.sub_agent_id,
            display_name=model.display_name,
            description=model.description,
            enabled=model.enabled,
            allowed_agent_modes=model.allowed_agent_modes,
            allowed_tool_names=model.allowed_tool_names,
            llm_config=model.llm_config,
        )

    @staticmethod
    def delete_sub_agent(db: Session, user_id: uuid.UUID, preset_id: uuid.UUID, sub_agent_id: str) -> None:
        model = SubAgentService.get_sub_agent(db, user_id, preset_id, sub_agent_id)
        if not model:
            raise ValueError(f"Sub agent not found: {sub_agent_id}")

        # Delete prompts for this Sub Agent.
        db.query(PromptVersion).filter(
            and_(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == "subAgent",
                PromptVersion.prompt_name == sub_agent_id,
            )
        ).delete(synchronize_session=False)

        db.delete(model)
        db.commit()


sub_agent_service = SubAgentService()
