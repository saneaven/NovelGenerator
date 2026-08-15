from __future__ import annotations

import sys
import types
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import declarative_base


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _install_import_stubs() -> None:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database


_install_import_stubs()

from App.backend.models.db_models import PromptScenarioVersion, SubAgentDefinitionModel
from App.backend.schemas.settings import TaskAIConfig
from App.backend.schemas.sub_agents import SubAgentCreate, SubAgentPromptTemplates, SubAgentToolGrant
from App.backend.services.sub_agent_service import (
    DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE,
    SubAgentService,
)


def _llm_config(provider: str) -> TaskAIConfig:
    return TaskAIConfig(
        provider=provider,
        model="some-model",
        temperature=0.5,
        context_window_tokens=32000,
        advanced={"thinking_mode": "off"},
    )


def _create_payload(**overrides: object) -> SubAgentCreate:
    payload: dict[str, object] = {
        "agent_name": "draft_writer",
        "display_name": "Draft Writer",
        "description": "Writes the first pass",
        "enabled": True,
        "allowed_invocation_modes": ["agentMode", "subAgent"],
        "tool_grants": [],
        "allowed_sub_agent_ids": [],
        "allowed_mcp_server_ids": [],
    }
    payload.update(overrides)
    return SubAgentCreate(**payload)


class FakeQuery:
    def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
        return self

    def first(self) -> object:
        return None


class FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0
        self.refreshed: list[object] = []

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.commits += 1

    def refresh(self, obj: object) -> None:
        self.refreshed.append(obj)

    def flush(self) -> None:
        pass

    def query(self, _model: object) -> FakeQuery:
        return FakeQuery()


def test_create_sub_agent_uses_prompt_templates_from_payload() -> None:
    session = FakeSession()
    user_id = uuid4()
    preset_id = uuid4()

    created = SubAgentService.create_sub_agent(
        session,
        user_id=user_id,
        preset_id=preset_id,
        data=SubAgentCreate(
            agent_name="draft_writer",
            display_name="Draft Writer",
            description="Writes the first pass",
            enabled=True,
            allowed_invocation_modes=["agentMode", "subAgent"],
            tool_grants=[
                SubAgentToolGrant(feature_key="manuscript", categories=["read", "write"]),
            ],
            allowed_sub_agent_ids=[],
            allowed_mcp_server_ids=[],
            prompt_templates=SubAgentPromptTemplates(
                system_prompt="System template from create payload",
                user_prompt="User template from create payload",
            ),
        ),
    )

    created_model = next(row for row in session.added if isinstance(row, SubAgentDefinitionModel))
    created_scenario = next(row for row in session.added if isinstance(row, PromptScenarioVersion))

    assert created.agent_name == "draft_writer"
    assert created_model.agent_name == "draft_writer"
    assert created_scenario.task_type == "subAgent"
    assert created_scenario.task_subtype == "draft_writer"
    assert created_scenario.scenario["system_template"] == "System template from create payload"
    assert created_scenario.scenario["blocks"][0]["rangeMapping"]["user_template"] == "User template from create payload"
    assert created_scenario.scenario["blocks"][0]["rangeMapping"]["assistant_template"] == DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE
    assert session.commits == 1
    assert session.refreshed == [created_model]


def test_create_sub_agent_normalizes_llm_config_override() -> None:
    session = FakeSession()

    SubAgentService.create_sub_agent(
        session,
        user_id=uuid4(),
        preset_id=uuid4(),
        data=_create_payload(
            use_custom_llm_config=True,
            llm_config_override=_llm_config("openai"),
        ),
    )

    created_model = next(row for row in session.added if isinstance(row, SubAgentDefinitionModel))

    assert created_model.use_custom_llm_config is True
    assert created_model.llm_config_override["provider"] == "openai"
    assert created_model.llm_config_override["model"] == "some-model"
    assert isinstance(created_model.llm_config_override["advanced"], dict)


def test_create_sub_agent_rejects_llm_config_override_for_non_llm_provider() -> None:
    session = FakeSession()

    with pytest.raises(ValueError, match="llm_config_override"):
        SubAgentService.create_sub_agent(
            session,
            user_id=uuid4(),
            preset_id=uuid4(),
            data=_create_payload(
                use_custom_llm_config=True,
                llm_config_override=_llm_config("novelai"),
            ),
        )
