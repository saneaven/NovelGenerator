from __future__ import annotations

import sys
import types
from types import SimpleNamespace
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

from App.backend.models.db_models import RunModel, Thread
from App.backend.services.tool_engine.contexts import ToolModuleContext
from App.backend.services.tool_engine.modules.generate_module import GenerateToolCallModule
from uuid import uuid4

IMAGE_OBJECT_TOOL = "generate_object_image"
IMAGE_SCENE_TOOL = "generate_scene_image"


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
    module = GenerateToolCallModule()
    specs = {spec.name: spec for spec in module.list_tools(_make_ctx())}
    object_tool = specs.get(IMAGE_OBJECT_TOOL)
    scene_tool = specs.get(IMAGE_SCENE_TOOL)

    assert object_tool is not None
    assert scene_tool is not None


def test_image_tool_schemas_require_explicit_target_ids() -> None:
    module = GenerateToolCallModule()
    specs = {spec.name: spec for spec in module.list_tools(_make_ctx())}
    object_tool = specs.get(IMAGE_OBJECT_TOOL)
    scene_tool = specs.get(IMAGE_SCENE_TOOL)

    assert object_tool is not None
    assert scene_tool is not None
    assert object_tool.parameters["required"] == ["prompt", "ratio", "object_id"]
    assert scene_tool.parameters["required"] == ["prompt", "ratio", "manuscript_id", "insert_before"]
