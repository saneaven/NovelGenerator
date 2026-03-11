from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from App.backend.models.db_models import RunModel, Thread
from App.backend.services.tool_engine.contexts import ToolModuleContext
from App.backend.services.tool_engine.contracts import ToolCallModule, ToolOffer, ToolSpec
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.schema_validation import validate_schema_required_enum_additional_properties
from App.backend.services.tool_engine.service import ToolEngineService


class _DummyModule(ToolCallModule):
    def __init__(self, prefix: str, spec_name: str = "read_story_object") -> None:
        self.prefix = prefix
        self._spec_name = spec_name

    def list_auto_approve_categories(self) -> tuple[str, ...]:
        return ("read",)

    def list_tools(self, _ctx: ToolModuleContext) -> list[ToolSpec]:
        return [_make_spec(self._spec_name)]

    async def validate(self, _tool_name, _args, _ctx):
        raise NotImplementedError

    async def execute(self, _tool_name, _args, _ctx):
        raise NotImplementedError


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
        auto_approve_category="read",
    )


def test_tool_registry_register_duplicate_prefix_raises() -> None:
    registry = ToolRegistry()
    registry.register_module(_DummyModule("read_"))

    with pytest.raises(ValueError, match="Duplicate tool module prefix"):
        registry.register_module(_DummyModule("read_"))


def test_tool_registry_resolves_longest_prefix() -> None:
    registry = ToolRegistry()
    patch_module = _DummyModule("patch_", "patch_story_object")
    patch_translation_module = _DummyModule("patch_translation_", "patch_translation_story_object")

    registry.register_module(patch_module)
    registry.register_module(patch_translation_module)

    assert registry.resolve_module("patch_story_object") is patch_module
    assert registry.resolve_module("patch_translation_story_object") is patch_translation_module


def test_tool_registry_lists_auto_approve_categories_from_modules() -> None:
    registry = ToolRegistry()
    registry.register_module(_DummyModule("read_"))
    registry.register_module(_DummyModule("search_", "search_keyword"))

    assert registry.list_auto_approve_categories() == ["read"]


def test_validate_unknown_tool_prefix_fails() -> None:
    service = ToolEngineService(ToolRegistry())

    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="done",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=uuid4(),
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
    )
    offer = ToolOffer(
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
            settings=SimpleNamespace(),
            user_id=thread.user_id,
            project_id=thread.project_id,
            language="English",
            preset_id=None,
            input_payload={},
            vector_storage_enabled=False,
        )
    )

    assert result.valid is False
    assert result.validator == "validate_tool_prefix"


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
