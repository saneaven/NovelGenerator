"""Seed default Sub Agents for a newly created prompt preset.

No legacy compatibility / migrations: this seeds only the current default set.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Dict, List

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models.db_models import SubAgentDefinitionModel
from ..schemas.sub_agents import SubAgentCreate
from .sub_agent_service import sub_agent_service


_TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "prompts" / "templates" / "subAgentDefaults"


def _read_required(agent_name: str, filename: str) -> str:
    path = _TEMPLATES_DIR / agent_name / filename
    if not path.exists():
        raise RuntimeError(f"Missing built-in sub-agent prompt template: {path}")
    return path.read_text(encoding="utf-8")


DEFAULT_SUB_AGENT_SPECS: List[Dict[str, Any]] = [
    {
        "agent_name": "lore_explorer",
        "display_name": "Lore Explorer",
        "description": "Explore and retrieve existing lore, facts, and references from the project using read/search tools.",
        "allowed_invocation_modes": ["planMode", "agentMode", "subAgent"],
        "allowed_tool_names": ["read_story_object", "read_outline", "read_manuscript", "keyword_search", "rag_search"],
    },
    {
        "agent_name": "world_planner",
        "display_name": "World Planner",
        "description": "Plan worldbuilding: setting rules, factions, cultures, technology/magic systems, and consistency checks.",
        "allowed_invocation_modes": ["planMode", "agentMode", "subAgent"],
        "allowed_tool_names": ["read_story_object", "read_outline", "read_manuscript", "keyword_search", "rag_search"],
    },
    {
        "agent_name": "character_planner",
        "display_name": "Character Planner",
        "description": "Plan characters: motivations, arcs, relationships, voice, backstory, and role in the plot.",
        "allowed_invocation_modes": ["planMode", "agentMode", "subAgent"],
        "allowed_tool_names": ["read_story_object", "read_outline", "read_manuscript", "keyword_search", "rag_search"],
    },
    {
        "agent_name": "outline_planner",
        "display_name": "Outline Planner",
        "description": "Plan and analyze story structure: outlines, acts, chapters, beats, pacing, and missing links.",
        "allowed_invocation_modes": ["planMode", "agentMode", "subAgent"],
        "allowed_tool_names": ["read_story_object", "read_outline", "read_manuscript", "keyword_search", "rag_search"],
    },
    {
        "agent_name": "novel_planner",
        "display_name": "Novel Planner",
        "description": "Plan scenes and chapters: goals, conflict, emotional beats, POV, hooks, and continuity.",
        "allowed_invocation_modes": ["planMode", "agentMode", "subAgent"],
        "allowed_tool_names": ["read_story_object", "read_outline", "read_manuscript", "keyword_search", "rag_search"],
    },
    {
        "agent_name": "novel_writer",
        "display_name": "Novel Writer",
        "description": "Write and revise prose for chapters. Uses manuscript edit tools when appropriate.",
        "allowed_invocation_modes": ["agentMode", "subAgent"],
        "allowed_tool_names": [
            "read_manuscript",
            "patch_manuscript",
            "replace_manuscript",
            "read_story_object",
            "read_outline",
            "keyword_search",
            "rag_search",
        ],
    },
]


def seed_default_sub_agents(db: Session, *, user_id: uuid.UUID, preset_id: uuid.UUID) -> int:
    """Seed default Sub Agents for a preset. Returns number of sub agents created.

    The caller controls the transaction boundary (this function does not commit).
    """

    existing = db.query(SubAgentDefinitionModel.id).filter(
        and_(
            SubAgentDefinitionModel.user_id == user_id,
            SubAgentDefinitionModel.preset_id == preset_id,
        )
    ).first()
    if existing:
        return 0

    for spec in DEFAULT_SUB_AGENT_SPECS:
        agent_name = spec["agent_name"]
        prompt_templates = {
            "systemPrompt": _read_required(agent_name, "systemPrompt.md"),
            "userPrompt": _read_required(agent_name, "userPrompt.md"),
            "prefill": _read_required(agent_name, "prefill.md"),
        }
        sub_agent_service.create_sub_agent(
            db=db,
            user_id=user_id,
            preset_id=preset_id,
            data=SubAgentCreate(
                agent_name=agent_name,
                display_name=spec["display_name"],
                description=spec["description"],
                enabled=True,
                allowed_invocation_modes=spec["allowed_invocation_modes"],
                allowed_tool_names=spec["allowed_tool_names"],
                allowed_sub_agent_ids=[],
                use_custom_llm_config=False,
                llm_config_override=None,
            ),
            prompt_templates=prompt_templates,
            prompt_is_default=True,
            prompt_note="System default (built-in SubAgent)",
            commit=False,
        )

    db.flush()
    return len(DEFAULT_SUB_AGENT_SPECS)
