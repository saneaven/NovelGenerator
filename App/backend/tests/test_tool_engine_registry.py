from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from App.backend.models.db_models import RunModel, Thread
from App.backend.services.tool_engine.contracts import ToolOffer, ToolSpec
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.schema_validation import validate_schema_required_enum_additional_properties
from App.backend.services.tool_engine.service import ToolEngineService


async def _noop_executor(_args, _ctx):
    return {"success": True}


def _make_spec(name: str) -> ToolSpec:
    return ToolSpec(
        name=name,
        description=f"spec:{name}",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "value": {"type": "string"},
            },
            "required": ["value"],
        },
        tool_sets=frozenset({"agent_agent_mode"}),
        auto_approve_category="read",
        validators=(),
        executor=_noop_executor,
    )


def test_tool_registry_register_duplicate_name_raises() -> None:
    registry = ToolRegistry()
    spec = _make_spec("read_story_object")

    registry.register_tool(spec)

    with pytest.raises(ValueError, match="Duplicate tool registration"):
        registry.register_tool(spec)


def test_validate_unknown_tool_fails() -> None:
    service = ToolEngineService(ToolRegistry())

    thread = Thread(
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="done",
    )
    run = RunModel(
        thread_id=uuid4(),
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
    )
    offer = ToolOffer(
        tool_set_name="agent_agent_mode",
        specs_by_name={},
        provider_tools=[],
        auto_approve_category_by_name={},
    )

    result = asyncio.run(
        service.validate_tool_call(
            db=object(),
            thread=thread,
            run=run,
            tool_name="unknown_tool",
            args={},
            offer=offer,
            user_id=thread.user_id,
            project_id=thread.project_id,
            language="English",
            preset_id=None,
        )
    )

    assert result.valid is False
    assert result.validator == "validate_tool_is_in_offer"


def test_validate_schema_rejects_additional_properties() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "value": {"type": "string", "enum": ["a", "b"]},
        },
        "required": ["value"],
    }

    result = validate_schema_required_enum_additional_properties(
        {"value": "a", "extra": "x"},
        schema,
    )

    assert result.valid is False
    assert result.validator == "validate_schema_required_enum_additional_properties"
