from __future__ import annotations

import asyncio
import sys
import types
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.orm import declarative_base


fake_database = types.ModuleType("App.backend.database")
fake_database.Base = declarative_base()
fake_database.SessionLocal = lambda: None
fake_database.get_db = lambda: None
sys.modules.setdefault("App.backend.database", fake_database)
sys.modules.setdefault("database", fake_database)

fake_notification_service = types.ModuleType("App.backend.services.notification_service")
fake_notification_service.build_agent_notification_snapshot = lambda **_kwargs: SimpleNamespace()
fake_notification_service.build_sub_agent_notification_snapshot = lambda **_kwargs: SimpleNamespace()
fake_notification_service.build_journey_notification_snapshot = lambda **_kwargs: SimpleNamespace()
fake_notification_service.upsert_notification_source = lambda *_args, **_kwargs: None
sys.modules.setdefault("App.backend.services.notification_service", fake_notification_service)

fake_image_run_service = types.ModuleType("App.backend.services.image_run_service")
fake_image_run_service.IMAGE_OBJECT_TOOL = "generate_object_image"
fake_image_run_service.IMAGE_SCENE_TOOL = "generate_scene_image"
fake_image_run_service.image_run_service = SimpleNamespace(create_tool_preview_run=None)
fake_image_run_service.resolve_explicit_object_target = lambda *_args, **_kwargs: None
fake_image_run_service.resolve_prompt_format = lambda provider, _model: provider


async def _validate_scene_anchor(*_args, **_kwargs):
    return None


fake_image_run_service.validate_scene_anchor = _validate_scene_anchor
sys.modules.setdefault("App.backend.services.image_run_service", fake_image_run_service)

from App.backend.models.db_models import Journey, RunModel, Thread
from App.backend.services.prompt_runtime.output_mode import resolve_output_mode
from App.backend.services.tool_engine.contexts import ToolModuleContext
from App.backend.services.tool_engine.contracts import (
    PersistedToolMeta,
    ToolBinding,
    ToolBindingMeta,
    ToolExecutionOutcome,
    ToolFeatureModule,
    ToolSpec,
)
from App.backend.services.tool_engine.modules.image_module import (
    SUBMIT_IMAGE_PROMPT_TOOL,
    ImageFeatureModule,
)
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.result_utils import valid_result


class _JourneyQuery:
    def __init__(self, journey: Journey) -> None:
        self._journey = journey

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._journey


class _JourneyDb:
    def __init__(self, journey: Journey) -> None:
        self._journey = journey

    def query(self, model):
        assert model is Journey
        return _JourneyQuery(self._journey)


def _make_ctx(
    *,
    prompt_format: str,
    journey_kind: str | None,
) -> ToolModuleContext:
    user_id = uuid4()
    project_id = uuid4()
    parent_id = uuid4()
    thread = Thread(
        id=uuid4(),
        project_id=project_id,
        user_id=user_id,
        thread_type="journey" if journey_kind else "agent",
        parent_id=parent_id,
        status="running",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=user_id,
        project_id=project_id,
        status="running",
        language="English",
        run_mode="agentMode",
        input_payload={"promptFormat": prompt_format},
    )
    journey = Journey(
        id=parent_id,
        project_id=project_id,
        user_id=user_id,
        kind=journey_kind or "imagePrompt",
        display_label="Image Prompt",
        status="running",
    )
    return ToolModuleContext(
        db=_JourneyDb(journey) if journey_kind else SimpleNamespace(),
        thread=thread,
        run=run,
        settings=SimpleNamespace(
            image_gen_config={"provider": prompt_format, "model": "test-image-model"}
        ),
        preset_id=uuid4(),
        user_id=user_id,
        project_id=project_id,
        input_payload=run.input_payload,
        vector_storage_enabled=False,
        invocation_mode="agentMode",
    )


@pytest.mark.parametrize(
    ("prompt_format", "properties", "required"),
    [
        ("natural", {"prompt"}, ["prompt"]),
        ("positive_negative", {"positive", "negative"}, ["positive", "negative"]),
        ("novelai", {"positive", "negative", "characters"}, ["positive", "negative", "characters"]),
    ],
)
def test_image_prompt_journey_offers_only_dynamic_submit_tool(
    prompt_format: str,
    properties: set[str],
    required: list[str],
) -> None:
    ctx = _make_ctx(prompt_format=prompt_format, journey_kind="imagePrompt")

    bindings = ImageFeatureModule().list_bindings(ctx)

    assert [binding.spec.name for binding in bindings] == [SUBMIT_IMAGE_PROMPT_TOOL]
    spec = bindings[0].spec
    assert spec.execution_policy == "immediate"
    assert spec.ends_run is True
    assert set(spec.parameters["properties"]) == properties
    assert spec.parameters["required"] == required
    assert spec.parameters["additionalProperties"] is False


def test_submit_novelai_schema_and_validator_are_strictly_nested() -> None:
    ctx = _make_ctx(prompt_format="novelai", journey_kind="sceneImagePrompt")
    binding = ImageFeatureModule().list_bindings(ctx)[0]
    character_schema = binding.spec.parameters["properties"]["characters"]["items"]

    assert character_schema["additionalProperties"] is False
    assert character_schema["required"] == ["positive", "negative"]
    valid = asyncio.run(
        binding.validate(
            {"positive": "cinematic scene", "negative": "", "characters": []},
            SimpleNamespace(),
        )
    )
    assert valid.valid is True

    invalid_payloads = [
        {"positive": " ", "negative": "", "characters": []},
        {"positive": "scene", "negative": "", "characters": [{"positive": " ", "negative": ""}]},
        {
            "positive": "scene",
            "negative": "",
            "characters": [{"positive": "hero", "negative": "", "extra": "nope"}],
        },
        {"positive": "scene", "negative": "", "characters": [{"positive": "hero"}]},
    ]
    for payload in invalid_payloads:
        result = asyncio.run(binding.validate(payload, SimpleNamespace()))
        assert result.valid is False


def test_generate_image_specs_use_prompt_format_and_keep_approval_lifecycle() -> None:
    ctx = _make_ctx(prompt_format="positive_negative", journey_kind=None)
    ctx.input_payload["promptFormat"] = "natural"
    specs = {
        binding.spec.name: binding.spec
        for binding in ImageFeatureModule().list_bindings(ctx)
    }

    object_spec = specs["generate_object_image"]
    scene_spec = specs["generate_scene_image"]
    assert object_spec.parameters["required"] == ["positive", "negative", "ratio", "object_id"]
    assert scene_spec.parameters["required"] == [
        "positive",
        "negative",
        "ratio",
        "manuscript_id",
        "insert_before",
    ]
    assert "prompt" not in object_spec.parameters["properties"]
    assert object_spec.execution_policy == "approval"
    assert scene_spec.execution_policy == "approval"
    assert object_spec.ends_run is False
    assert scene_spec.ends_run is False


class _ExtraModule(ToolFeatureModule):
    feature_key = "mcp"

    def list_bindings(self, _ctx):
        spec = ToolSpec(
            name="unrelated_tool",
            description="Unrelated.",
            parameters={"type": "object", "properties": {}, "required": []},
        )

        async def _execute(_args, _ctx):
            return ToolExecutionOutcome(lifecycle="applied")

        return [
            ToolBinding(
                spec=spec,
                meta=ToolBindingMeta(feature_key="mcp", category="mcp", op="mcp", target_kind="mcp_tool"),
                validate=lambda _args, _ctx: valid_result(),
                execute=_execute,
                build_persisted_meta=lambda _ctx, _args: PersistedToolMeta(
                    feature_key="mcp",
                    category="mcp",
                    op="mcp",
                    target_kind="mcp_tool",
                    target_id=None,
                    merge_key=None,
                ),
            )
        ]


def test_registry_keeps_run_ending_submit_tool_exclusive() -> None:
    registry = ToolRegistry()
    registry.register_module(ImageFeatureModule())
    registry.register_module(_ExtraModule())

    offer = registry.build_offer(_make_ctx(prompt_format="natural", journey_kind="imagePrompt"))

    assert list(offer.specs_by_name) == [SUBMIT_IMAGE_PROMPT_TOOL]
    assert list(offer.bindings_by_name) == [SUBMIT_IMAGE_PROMPT_TOOL]
    assert [tool["name"] for tool in offer.provider_tools] == [SUBMIT_IMAGE_PROMPT_TOOL]


@pytest.mark.parametrize("journey_kind", ["imagePrompt", "sceneImagePrompt"])
def test_image_prompt_journeys_force_normal_tool_call_mode(journey_kind: str) -> None:
    assert resolve_output_mode(
        journey_kind=journey_kind,
        payload={"promptFormat": "natural"},
        native_output_mode=True,
    ) == "tool_call"
