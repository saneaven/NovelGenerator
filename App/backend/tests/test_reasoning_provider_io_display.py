from __future__ import annotations

from dataclasses import dataclass
import sys
import types
from typing import Any

from App.backend.services.reasoning.provider_io import (
    ClaudeIO,
    CustomOpenAICompletionIO,
    OpenAIResponsesIO,
    get_provider_io,
)


def _ensure_openai_stub() -> None:
    if "openai" in sys.modules:
        return

    fake_openai = types.ModuleType("openai")

    class _StubOpenAIError(Exception):
        pass

    fake_openai.AsyncOpenAI = object
    fake_openai.OpenAIError = _StubOpenAIError
    fake_openai.APIConnectionError = _StubOpenAIError
    fake_openai.APIStatusError = _StubOpenAIError
    fake_openai.AuthenticationError = _StubOpenAIError
    fake_openai.BadRequestError = _StubOpenAIError
    fake_openai.RateLimitError = _StubOpenAIError
    sys.modules["openai"] = fake_openai


def _load_openai_responses_provider():
    _ensure_openai_stub()
    from App.backend.providers.openai_responses_provider import OpenAIResponsesProvider

    return OpenAIResponsesProvider


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
    assert get_provider_io("custom", {"custom_kind": "openai_response"}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert get_provider_io("custom", {"custom_kind": "claude"}).get_stream_thinking_display_path({}) == "reasoning_text"


def test_custom_provider_io_routes_by_custom_kind() -> None:
    assert isinstance(get_provider_io("custom", {}), CustomOpenAICompletionIO)
    assert isinstance(get_provider_io("custom", {"custom_kind": "openai_completion"}), CustomOpenAICompletionIO)
    assert isinstance(get_provider_io("custom", {"custom_kind": "openai_response"}), OpenAIResponsesIO)
    assert isinstance(get_provider_io("custom", {"custom_kind": "claude"}), ClaudeIO)
    assert isinstance(get_provider_io("custom", {"custom_kind": "unknown"}), CustomOpenAICompletionIO)


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


def test_custom_openai_response_to_provider_messages_preserves_output_msg_id() -> None:
    advanced = {"custom_kind": "openai_response"}
    io = get_provider_io("custom", advanced)
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
    result = io.to_provider_messages(messages, "gpt-5.4", advanced)
    rd = result[0]["reasoning_detail"]
    assert rd["data"]["output_msg_id"] == "msg_xyz"
    assert len(rd["data"]["items"]) == 1


def test_custom_openai_response_convert_messages_keeps_reasoning_items_before_output_and_tool_calls() -> None:
    advanced = {"custom_kind": "openai_response"}
    io = get_provider_io("custom", advanced)
    provider_cls = _load_openai_responses_provider()
    provider = provider_cls.__new__(provider_cls)
    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "Hello"}],
            "tool_calls": [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {"name": "read_story_object", "arguments": "{\"id\":\"abc\"}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "meta": {"provider": "openai"},
                "data": {
                    "items": [{"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"}],
                    "output_msg_id": "msg_xyz",
                    "function_call_item_ids": {"call_123": "fc_xyz"},
                },
                "token_count": 0,
            },
        },
    ]
    prepared = io.to_provider_messages(messages, "gpt-5.4", advanced)
    result = provider._convert_messages(prepared)
    assert [item["type"] for item in result] == ["reasoning", "message", "function_call"]
    assert result[0]["id"] == "rs_abc"
    assert result[1]["id"] == "msg_xyz"
    assert result[1]["status"] == "completed"
    assert result[2]["id"] == "fc_xyz"
    assert result[2]["status"] == "completed"


def test_openai_convert_messages_includes_id_and_status() -> None:
    """_convert_messages should include id and status on assistant messages following reasoning items."""
    provider_cls = _load_openai_responses_provider()
    provider = provider_cls.__new__(provider_cls)
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
    provider_cls = _load_openai_responses_provider()
    provider = provider_cls.__new__(provider_cls)
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


def test_custom_claude_to_provider_messages_preserves_reasoning_blocks() -> None:
    advanced = {"custom_kind": "claude"}
    io = get_provider_io("custom", advanced)
    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "Hello"}],
            "reasoning_detail": {
                "type": "claude",
                "meta": {"provider": "claude", "thinking_display": "reasoning_text"},
                "data": {
                    "blocks": [
                        {"type": "thinking", "thinking": "step one", "signature": "sig_123"},
                    ],
                    "reasoning_text": "step one",
                },
                "token_count": 0,
            },
        },
    ]
    result = io.to_provider_messages(messages, "claude-3.7", advanced)
    rd = result[0]["reasoning_detail"]
    assert rd["type"] == "claude"
    assert rd["data"]["blocks"][0]["thinking"] == "step one"
    assert rd["data"]["blocks"][0]["signature"] == "sig_123"

