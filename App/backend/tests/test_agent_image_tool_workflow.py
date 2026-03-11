from __future__ import annotations

from types import SimpleNamespace
from App.backend.image_providers.model_capabilities import get_gemini_supported_aspect_ratios
from App.backend.services.image_run_service import (
    IMAGE_OBJECT_TOOL,
    IMAGE_SCENE_TOOL,
    _pick_nearest_ratio_label,
    _pick_nearest_size,
)
from App.backend.models.db_models import RunModel, Thread
from App.backend.services.tool_engine.contexts import ToolModuleContext
from App.backend.services.tool_engine.modules.generate_module import GenerateToolCallModule
from App.backend.services.tool_engine.service import ToolEngineService
from uuid import uuid4


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


def test_image_tools_register_without_auto_approve() -> None:
    module = GenerateToolCallModule()
    specs = {spec.name: spec for spec in module.list_tools(_make_ctx())}
    object_tool = specs.get(IMAGE_OBJECT_TOOL)
    scene_tool = specs.get(IMAGE_SCENE_TOOL)

    assert object_tool is not None
    assert scene_tool is not None
    assert object_tool.auto_approve_category is None
    assert scene_tool.auto_approve_category is None


def test_extract_execution_controls_supports_working_transition() -> None:
    continue_as, extra_patch, result = ToolEngineService._extract_execution_controls(  # noqa: SLF001
        {
            "__continue_as": "working",
            "success": True,
            "message": "Image generation started.",
            "image_run_id": "run-123",
        }
    )

    assert continue_as == "working"
    assert extra_patch is None
    assert result == {"success": True, "message": "Image generation started.", "image_run_id": "run-123"}


def test_ratio_resolution_picks_nearest_supported_values() -> None:
    aspect_ratios = get_gemini_supported_aspect_ratios("gemini-3.1-flash-image-preview")

    assert _pick_nearest_ratio_label(aspect_ratios, 16 / 9) == "16:9"
    assert _pick_nearest_ratio_label(aspect_ratios, 0.6) == "9:16"
    assert _pick_nearest_size(["1024x1024", "1792x1024", "1024x1792"], 16 / 9, "1024x1024") == "1792x1024"


def test_image_tool_schemas_require_explicit_target_ids() -> None:
    module = GenerateToolCallModule()
    specs = {spec.name: spec for spec in module.list_tools(_make_ctx())}
    object_tool = specs.get(IMAGE_OBJECT_TOOL)
    scene_tool = specs.get(IMAGE_SCENE_TOOL)

    assert object_tool is not None
    assert scene_tool is not None
    assert object_tool.parameters["required"] == ["prompt", "ratio", "object_id"]
    assert scene_tool.parameters["required"] == ["prompt", "ratio", "manuscript_id", "insert_before"]
