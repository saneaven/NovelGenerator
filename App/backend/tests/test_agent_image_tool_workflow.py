from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from uuid import uuid4

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


async def _validate_scene_anchor(*_args, **_kwargs):
    return None


fake_image_run_service.validate_scene_anchor = _validate_scene_anchor
sys.modules.setdefault("App.backend.services.image_run_service", fake_image_run_service)

import asyncio

from App.backend.models.db_models import RunModel, Thread
from App.backend.services.tool_engine.contexts import ToolModuleContext
from App.backend.services.tool_engine.modules.image_module import ImageFeatureModule

IMAGE_OBJECT_TOOL = "generate_object_image"
IMAGE_SCENE_TOOL = "generate_scene_image"
READ_IMAGE_TOOL = "read_image"


def _make_ctx() -> ToolModuleContext:
    thread = Thread(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        thread_type="agent",
        status="running",
    )
    run = RunModel(
        id=uuid4(),
        thread_id=thread.id,
        user_id=thread.user_id,
        project_id=thread.project_id,
        status="running",
        language="English",
        run_mode="agentMode",
        input_payload={},
    )
    return ToolModuleContext(
        db=SimpleNamespace(),
        thread=thread,
        run=run,
        settings=SimpleNamespace(),
        preset_id=uuid4(),
        user_id=thread.user_id,
        project_id=thread.project_id,
        input_payload={},
        vector_storage_enabled=False,
        invocation_mode="agentMode",
    )


def test_generate_tool_schemas_register() -> None:
    specs = {binding.spec.name: binding.spec for binding in ImageFeatureModule().list_bindings(_make_ctx())}

    assert specs.get(IMAGE_OBJECT_TOOL) is not None
    assert specs.get(IMAGE_SCENE_TOOL) is not None


def test_image_tool_schemas_require_explicit_target_ids() -> None:
    specs = {binding.spec.name: binding.spec for binding in ImageFeatureModule().list_bindings(_make_ctx())}
    object_tool = specs.get(IMAGE_OBJECT_TOOL)
    scene_tool = specs.get(IMAGE_SCENE_TOOL)

    assert object_tool is not None
    assert scene_tool is not None
    assert object_tool.parameters["required"] == ["prompt", "ratio", "object_id"]
    assert scene_tool.parameters["required"] == ["prompt", "ratio", "manuscript_id", "insert_before"]


def _fake_db_returning(asset: object) -> SimpleNamespace:
    class _Query:
        def filter(self, *_a, **_k):
            return self

        def first(self):
            return asset

    return SimpleNamespace(query=lambda *_a, **_k: _Query())


def test_read_image_tool_registers() -> None:
    specs = {binding.spec.name: binding.spec for binding in ImageFeatureModule().list_bindings(_make_ctx())}
    read_tool = specs.get(READ_IMAGE_TOOL)
    assert read_tool is not None
    assert read_tool.parameters["required"] == ["image_id"]


def test_read_image_records_asset_id_and_metadata() -> None:
    ctx = _make_ctx()
    bindings = {binding.spec.name: binding for binding in ImageFeatureModule().list_bindings(ctx)}
    binding = bindings[READ_IMAGE_TOOL]

    asset_id = uuid4()
    asset = SimpleNamespace(
        id=asset_id,
        mime_type="image/png",
        generation_prompt={"prefix": "sunset", "content": "over the sea", "postfix": ""},
        generation_positive_prompt=None,
        generation_negative_prompt=None,
        generation_provider="openai",
        generation_model="gpt-image-1",
        name="scene",
        asset_type="scene",
        width=1024,
        height=768,
    )
    exec_ctx = SimpleNamespace(db=_fake_db_returning(asset), project_id=ctx.project_id)

    outcome = asyncio.run(binding.execute({"image_id": str(asset_id)}, exec_ctx))

    assert outcome.lifecycle == "applied"
    assert outcome.result["data"]["image_asset_ids"] == [str(asset_id)]
    assert "sunset over the sea" in outcome.result["message"]
    assert "gpt-image-1" in outcome.result["message"]


def test_read_image_missing_asset_is_validation_error() -> None:
    ctx = _make_ctx()
    bindings = {binding.spec.name: binding for binding in ImageFeatureModule().list_bindings(ctx)}
    binding = bindings[READ_IMAGE_TOOL]

    validation_ctx = SimpleNamespace(db=_fake_db_returning(None), project_id=ctx.project_id)
    result = asyncio.run(binding.validate({"image_id": str(uuid4())}, validation_ctx))
    assert result.valid is False
