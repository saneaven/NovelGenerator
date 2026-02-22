from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from App.backend.services.reasoning.provider_io import get_provider_io


@dataclass
class _Snapshot:
    content_parts: list[dict[str, Any]]
    reasoning_details: list[dict[str, Any]]
    reasoning_tokens: int | None = None
    usage: dict[str, Any] | None = None


def test_provider_stream_thinking_display_paths() -> None:
    assert get_provider_io("openai", {}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert get_provider_io("gemini", {}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert get_provider_io("claude", {}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert get_provider_io("openrouter", {}).get_stream_thinking_display_path({}) == "reasoning"
    assert get_provider_io("xai", {}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert get_provider_io("custom", {}).get_stream_thinking_display_path({}) == "text"


def test_custom_template_stream_display_path_and_nested_data() -> None:
    advanced = {
        "custom_thinking_template_id": "tpl-1",
        "_resolved_template": {
            "response_fields": [
                {"path": "a.b", "as_var": "reasoning_info.reasoning_text", "is_stream_delta": True},
            ],
        },
    }
    io = get_provider_io("custom", advanced)
    assert io.get_stream_thinking_display_path(advanced) == "reasoning_info.reasoning_text"

    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "answer"}],
        reasoning_details=[
            {"_template_var": "reasoning_info.reasoning_text", "value": "hello "},
            {"_template_var": "reasoning_info.reasoning_text", "value": "world"},
        ],
    )
    detail = io.read_reasoning_detail(snapshot, advanced)
    assert detail is not None
    assert detail["type"] == "openai_compatible_template"
    assert detail["meta"]["provider"] == "custom"
    assert detail["meta"]["custom_thinking_template_id"] == "tpl-1"
    assert detail["meta"]["thinking_display"] == "reasoning_info.reasoning_text"
    assert detail["data"]["reasoning_info"]["reasoning_text"] == "hello world"


def test_custom_template_without_stream_field_has_no_display_path() -> None:
    advanced = {
        "custom_thinking_template_id": "tpl-1",
        "_resolved_template": {
            "response_fields": [
                {"path": "x", "as_var": "reasoning_info.other", "is_stream_delta": False},
            ],
        },
    }
    io = get_provider_io("custom", advanced)
    assert io.get_stream_thinking_display_path(advanced) is None

    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "answer"}],
        reasoning_details=[
            {"_template_var": "reasoning_info.other", "value": "value"},
        ],
    )
    detail = io.read_reasoning_detail(snapshot, advanced)
    assert detail is not None
    assert "thinking_display" not in detail["meta"]

