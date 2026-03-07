from __future__ import annotations

from App.backend.services.agent_image_tool_service import (
    GEMINI_ASPECT_RATIOS,
    _pick_nearest_ratio_label,
    _pick_nearest_size,
    get_image_state,
    merge_extra_content,
    reject_generated_preview,
)
from App.backend.services.tool_engine.modules import image_module
from App.backend.services.tool_engine.registry import ToolRegistry
from App.backend.services.tool_engine.service import ToolEngineService


def test_image_tools_register_without_auto_approve() -> None:
    registry = ToolRegistry()

    image_module.register(registry)

    object_tool = registry.get_registered_tool("generate_object_image")
    scene_tool = registry.get_registered_tool("generate_scene_image")

    assert object_tool is not None
    assert scene_tool is not None
    assert object_tool.auto_approve_category is None
    assert scene_tool.auto_approve_category is None


def test_extract_execution_controls_supports_working_transition() -> None:
    continue_as, extra_patch, result = ToolEngineService._extract_execution_controls(  # noqa: SLF001
        {
            "__continue_as": "working",
            "__extra_content": {"image_state": "generating"},
            "success": True,
            "message": "generated preview",
        }
    )

    assert continue_as == "working"
    assert extra_patch == {"image_state": "generating"}
    assert result == {"success": True, "message": "generated preview"}


def test_ratio_resolution_picks_nearest_supported_values() -> None:
    assert _pick_nearest_ratio_label(GEMINI_ASPECT_RATIOS, 16 / 9) == "16:9"
    assert _pick_nearest_ratio_label(GEMINI_ASPECT_RATIOS, 0.6) == "9:16"
    assert _pick_nearest_size(["1024x1024", "1792x1024", "1024x1792"], 16 / 9, "1024x1024") == "1792x1024"


def test_image_state_helpers_cover_default_merge_and_user_reject() -> None:
    assert get_image_state(None) == "generating"
    assert merge_extra_content({"image_state": "generating"}, {"preview_asset_id": "asset-1"}) == {
        "image_state": "generating",
        "preview_asset_id": "asset-1",
    }

    payload = reject_generated_preview(tool_call=object())  # type: ignore[arg-type]
    assert payload["success"] is False
    assert payload["data"]["failure_code"] == "user_rejected_generated_image"
