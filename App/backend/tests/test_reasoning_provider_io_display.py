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
    raw_native_response: dict[str, Any] | None = None


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


# --- OpenAI reasoning multi-turn pairing tests ---


def test_openai_read_reasoning_detail_captures_output_msg_id() -> None:
    """read_reasoning_detail should extract the output message ID from the raw native response."""
    io = get_provider_io("openai", {})
    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "Hello"}],
        reasoning_details=[
            {"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"},
        ],
        raw_native_response={
            "output": [
                {"type": "reasoning", "id": "rs_abc", "encrypted_content": "enc123"},
                {"type": "message", "id": "msg_xyz", "role": "assistant", "content": [{"type": "output_text", "text": "Hello"}]},
            ],
        },
    )
    detail = io.read_reasoning_detail(snapshot, {})
    assert detail is not None
    assert detail["data"]["output_msg_id"] == "msg_xyz"
    assert detail["data"]["items"][0]["id"] == "rs_abc"


def test_openai_read_reasoning_detail_no_raw_response() -> None:
    """read_reasoning_detail should work without raw_native_response (no output_msg_id)."""
    io = get_provider_io("openai", {})
    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "Hello"}],
        reasoning_details=[
            {"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"},
        ],
    )
    detail = io.read_reasoning_detail(snapshot, {})
    assert detail is not None
    assert "output_msg_id" not in detail["data"]
    assert detail["data"]["items"][0]["id"] == "rs_abc"


def test_openai_to_provider_messages_preserves_output_msg_id() -> None:
    """to_provider_messages should preserve output_msg_id through reasoning item filtering."""
    io = get_provider_io("openai", {})
    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "Hello"}],
            "reasoning_detail": {
                "type": "openai",
                "meta": {"provider": "openai"},
                "data": {
                    "items": [{"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"}],
                    "output_msg_id": "msg_xyz",
                },
                "token_count": 0,
            },
        },
    ]
    result = io.to_provider_messages(messages, "o3", {})
    rd = result[0]["reasoning_detail"]
    assert rd["data"]["output_msg_id"] == "msg_xyz"
    assert len(rd["data"]["items"]) == 1


def test_openai_convert_messages_includes_id_and_status() -> None:
    """_convert_messages should include id and status on assistant messages following reasoning items."""
    from App.backend.providers.openai_responses_provider import OpenAIResponsesProvider

    provider = OpenAIResponsesProvider.__new__(OpenAIResponsesProvider)
    messages = [
        {"role": "user", "content_parts": [{"type": "content", "text": "Hi"}]},
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "Hello"}],
            "reasoning_detail": {
                "type": "openai",
                "data": {
                    "items": [{"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"}],
                    "output_msg_id": "msg_xyz",
                },
            },
        },
    ]
    result = provider._convert_messages(messages)
    # Should be: user message, reasoning item, assistant message
    assert len(result) == 3
    assert result[1]["type"] == "reasoning"
    assert result[1]["id"] == "rs_abc"
    assert result[2]["id"] == "msg_xyz"
    assert result[2]["status"] == "completed"
    assert result[2]["type"] == "message"
    assert result[2]["role"] == "assistant"


def test_openai_convert_messages_no_reasoning_no_extra_fields() -> None:
    """_convert_messages should NOT add id/status when no reasoning items are present."""
    from App.backend.providers.openai_responses_provider import OpenAIResponsesProvider

    provider = OpenAIResponsesProvider.__new__(OpenAIResponsesProvider)
    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "Hello"}],
        },
    ]
    result = provider._convert_messages(messages)
    assert len(result) == 1
    assert "id" not in result[0]
    assert "status" not in result[0]
    assert "type" not in result[0]

