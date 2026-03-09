from __future__ import annotations

from App.backend.image_providers.model_capabilities import get_gemini_supported_aspect_ratios
from App.backend.services.image_run_service import (
    IMAGE_OBJECT_TOOL,
    IMAGE_SCENE_TOOL,
    _pick_nearest_ratio_label,
    _pick_nearest_size,
)
from App.backend.services.tool_engine.modules import image_module
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.service import ToolEngineService


def test_image_tools_register_without_auto_approve() -> None:
    registry = ToolRegistry()

    image_module.register(registry)

    object_tool = registry.get_registered_tool(IMAGE_OBJECT_TOOL)
    scene_tool = registry.get_registered_tool(IMAGE_SCENE_TOOL)

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
    registry = ToolRegistry()
    image_module.register(registry)

    object_tool = registry.get_registered_tool(IMAGE_OBJECT_TOOL)
    scene_tool = registry.get_registered_tool(IMAGE_SCENE_TOOL)

    assert object_tool is not None
    assert scene_tool is not None
    assert object_tool.parameters["required"] == ["prompt", "ratio", "object_id"]
    assert scene_tool.parameters["required"] == ["prompt", "ratio", "manuscript_id", "insert_before"]
