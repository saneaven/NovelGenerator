from __future__ import annotations

from dataclasses import dataclass
import sys
import types
from typing import Any


def _ensure_provider_stubs() -> None:
    if "openai" not in sys.modules:
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

    if "anthropic" not in sys.modules:
        fake_anthropic = types.ModuleType("anthropic")
        fake_anthropic.AsyncAnthropic = object
        sys.modules["anthropic"] = fake_anthropic

    google_module = sys.modules.setdefault("google", types.ModuleType("google"))
    if "google.genai" not in sys.modules:
        fake_genai = types.ModuleType("google.genai")
        fake_errors = types.ModuleType("google.genai.errors")
        fake_types = types.ModuleType("google.genai.types")

        class _StubClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

        class _StubHttpOptions:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

        class _StubPart:
            def __init__(self, **kwargs: object) -> None:
                self.__dict__.update(kwargs)

            @classmethod
            def from_text(cls, *, text: str) -> "_StubPart":
                return cls(text=text)

            @classmethod
            def from_bytes(cls, *, data: bytes, mime_type: str) -> "_StubPart":
                return cls(data=data, mime_type=mime_type)

            @classmethod
            def from_function_response(cls, *, name: str, response: dict[str, object]) -> "_StubPart":
                return cls(name=name, response=response)

            @classmethod
            def from_function_call(cls, *, name: str, args: dict[str, object]) -> "_StubPart":
                return cls(name=name, args=args)

            @classmethod
            def model_validate(cls, payload: dict[str, object]) -> "_StubPart":
                return cls(**payload)

        class _StubContent:
            def __init__(self, role: str | None = None, parts: list[object] | None = None) -> None:
                self.role = role
                self.parts = parts or []

        class _StubFunctionCallingConfigMode:
            AUTO = "AUTO"
            ANY = "ANY"
            NONE = "NONE"

        fake_genai.Client = _StubClient
        fake_types.HttpOptions = _StubHttpOptions
        fake_types.Part = _StubPart
        fake_types.Content = _StubContent
        fake_types.FunctionCallingConfigMode = _StubFunctionCallingConfigMode
        fake_genai.errors = fake_errors
        fake_genai.types = fake_types
        google_module.genai = fake_genai
        sys.modules["google.genai"] = fake_genai
        sys.modules["google.genai.errors"] = fake_errors
        sys.modules["google.genai.types"] = fake_types

    if "App.backend.models.db_models" not in sys.modules:
        fake_db_models = types.ModuleType("App.backend.models.db_models")

        class _StubRunMessageAttachmentModel:
            pass

        fake_db_models.RunMessageAttachmentModel = _StubRunMessageAttachmentModel
        sys.modules["App.backend.models.db_models"] = fake_db_models

    if "App.backend.services.chat_attachment_service" not in sys.modules:
        fake_chat_attachment_service = types.ModuleType("App.backend.services.chat_attachment_service")
        fake_chat_attachment_service.chat_attachment_service = types.SimpleNamespace(
            load_attachment_bytes=lambda _storage_key: b"",
            to_data_url=lambda mime_type, _data: f"data:{mime_type};base64,",
        )
        sys.modules["App.backend.services.chat_attachment_service"] = fake_chat_attachment_service


def _load_providers():
    _ensure_provider_stubs()
    from App.backend.providers.claude_provider import ClaudeProvider
    from App.backend.providers.custom import CustomProvider
    from App.backend.providers.gemini_provider import GeminiProvider
    from App.backend.providers.openai_responses_provider import OpenAIResponsesProvider
    from App.backend.providers.openrouter import OpenRouterProvider
    from App.backend.providers.xai_provider import XAIProvider

    return ClaudeProvider, CustomProvider, GeminiProvider, OpenAIResponsesProvider, OpenRouterProvider, XAIProvider


@dataclass
class _Snapshot:
    content_parts: list[dict[str, Any]]
    reasoning_details: list[dict[str, Any]]
    reasoning_tokens: int | None = None
    usage: dict[str, Any] | None = None
    raw_native_response: dict[str, Any] | None = None


def test_provider_stream_thinking_display_paths() -> None:
    ClaudeProvider, CustomProvider, GeminiProvider, OpenAIResponsesProvider, OpenRouterProvider, XAIProvider = _load_providers()

    assert OpenAIResponsesProvider({}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert GeminiProvider({}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert ClaudeProvider({}).get_stream_thinking_display_path({}) == "reasoning_text"
    assert OpenRouterProvider({}).get_stream_thinking_display_path({}) == "reasoning"
    assert XAIProvider({}).get_stream_thinking_display_path({}) == "reasoning_text"

    custom = CustomProvider({})
    assert custom.get_stream_thinking_display_path({}) == "text"
    assert custom.get_stream_thinking_display_path({"custom_kind": "openai_response"}) == "reasoning_text"
    assert custom.get_stream_thinking_display_path({"custom_kind": "claude"}) == "reasoning_text"


def test_custom_template_stream_display_path_and_nested_data() -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    advanced = {
        "custom_thinking_template_id": "tpl-1",
        "_resolved_template": {
            "response_fields": [
                {"path": "a.b", "as_var": "reasoning_info.reasoning_text", "is_stream_delta": True},
            ],
        },
    }

    assert provider.get_stream_thinking_display_path(advanced) == "reasoning_info.reasoning_text"

    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "answer"}],
        reasoning_details=[
            {"_template_var": "reasoning_info.reasoning_text", "value": "hello "},
            {"_template_var": "reasoning_info.reasoning_text", "value": "world"},
        ],
    )
    detail = provider.read_reasoning_detail(snapshot, advanced)

    assert detail is not None
    assert detail["type"] == "openai_compatible_template"
    assert detail["meta"]["provider"] == "custom"
    assert detail["meta"]["custom_thinking_template_id"] == "tpl-1"
    assert detail["meta"]["thinking_display"] == "reasoning_info.reasoning_text"
    assert detail["data"]["reasoning_info"]["reasoning_text"] == "hello world"


def test_custom_template_without_stream_field_has_no_display_path() -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    advanced = {
        "custom_thinking_template_id": "tpl-1",
        "_resolved_template": {
            "response_fields": [
                {"path": "x", "as_var": "reasoning_info.other", "is_stream_delta": False},
            ],
        },
    }

    assert provider.get_stream_thinking_display_path(advanced) is None

    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "answer"}],
        reasoning_details=[
            {"_template_var": "reasoning_info.other", "value": "value"},
        ],
    )
    detail = provider.read_reasoning_detail(snapshot, advanced)

    assert detail is not None
    assert "thinking_display" not in detail["meta"]


def test_openai_read_reasoning_detail_captures_output_msg_id() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
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

    detail = provider.read_reasoning_detail(snapshot, {})

    assert detail is not None
    assert detail["data"]["output_msg_id"] == "msg_xyz"
    assert detail["data"]["items"][0]["id"] == "rs_abc"


def test_openai_read_reasoning_detail_no_raw_response() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "Hello"}],
        reasoning_details=[
            {"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"},
        ],
    )

    detail = provider.read_reasoning_detail(snapshot, {})

    assert detail is not None
    assert "output_msg_id" not in detail["data"]
    assert detail["data"]["items"][0]["id"] == "rs_abc"


def test_custom_openai_response_read_reasoning_detail_delegates_to_responses_provider() -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "Hello"}],
        reasoning_details=[
            {"id": "rs_abc", "type": "reasoning", "encrypted_content": "enc123"},
        ],
        raw_native_response={
            "output": [
                {"type": "message", "id": "msg_xyz", "role": "assistant", "content": [{"type": "output_text", "text": "Hello"}]},
            ],
        },
    )

    detail = provider.read_reasoning_detail(snapshot, {"custom_kind": "openai_response"})

    assert detail is not None
    assert detail["type"] == "openai"
    assert detail["data"]["output_msg_id"] == "msg_xyz"


def test_custom_claude_read_reasoning_detail_delegates_to_claude_provider() -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    snapshot = _Snapshot(
        content_parts=[{"type": "content", "text": "Hello"}],
        reasoning_details=[
            {"type": "thinking", "thinking": "step one", "signature": "sig_123"},
        ],
    )

    detail = provider.read_reasoning_detail(snapshot, {"custom_kind": "claude"})

    assert detail is not None
    assert detail["type"] == "claude"
    assert detail["data"]["blocks"][0]["thinking"] == "step one"
    assert detail["data"]["blocks"][0]["signature"] == "sig_123"


def test_custom_openai_completion_convert_messages_applies_history_inject() -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    provider.set_thinking_template(
        {
            "id": "tpl-1",
            "effort_fields": [],
            "response_fields": [],
            "history_fields": [
                {"path": "metadata.replayed_reasoning", "in_var": "reasoning_info.reasoning_text"},
            ],
        }
    )

    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "Hello"}],
            "reasoning_detail": {
                "type": "openai_compatible_template",
                "meta": {
                    "provider": "custom",
                    "custom_thinking_template_id": "tpl-1",
                },
                "data": {
                    "reasoning_info": {
                        "reasoning_text": "step one",
                    }
                },
                "token_count": 0,
            },
        },
    ]

    converted = provider._convert_messages(messages)

    assert converted[0]["metadata"]["replayed_reasoning"] == "step one"
    assert "reasoning" not in converted[0]
    assert "reasoning_details" not in converted[0]


def test_openai_convert_messages_includes_id_and_status() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
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

    assert len(result) == 3
    assert result[1]["type"] == "reasoning"
    assert result[1]["id"] == "rs_abc"
    assert result[2]["id"] == "msg_xyz"
    assert result[2]["status"] == "completed"
    assert result[2]["type"] == "message"
    assert result[2]["role"] == "assistant"


def test_openai_convert_messages_no_reasoning_no_extra_fields() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
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


def test_openai_convert_messages_tool_call_only_assistant_restores_empty_message() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    messages = [
        {
            "role": "assistant",
            "content_parts": [],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "read_story_object", "arguments": "{}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {
                    "items": [{"id": "rs_1", "type": "reasoning", "encrypted_content": "enc"}],
                    "output_msg_id": "msg_1",
                    "function_call_item_ids": {"call_1": "fc_1"},
                },
            },
        },
    ]

    result = provider._convert_messages(messages)

    assert [item["type"] for item in result] == ["reasoning", "message", "function_call"]
    assert result[0]["id"] == "rs_1"
    assert result[1]["id"] == "msg_1"
    assert result[1]["role"] == "assistant"
    assert result[1]["status"] == "completed"
    assert result[1]["content"] == []
    assert result[2]["id"] == "fc_1"
    assert result[2]["status"] == "completed"
    assert result[2]["call_id"] == "call_1"


def test_openai_convert_messages_tool_call_only_assistant_with_tool_results_keeps_full_chain() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    messages = [
        {
            "role": "assistant",
            "content_parts": [],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "read_story_object", "arguments": "{}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {
                    "items": [{"id": "rs_1", "type": "reasoning", "encrypted_content": "enc"}],
                    "output_msg_id": "msg_1",
                    "function_call_item_ids": {"call_1": "fc_1"},
                },
            },
        },
        {
            "role": "tool_results",
            "content_parts": [],
            "tool_results": [{"tool_call_id": "call_1", "content": "result payload"}],
        },
    ]

    result = provider._convert_messages(messages)

    assert [item["type"] for item in result] == ["reasoning", "message", "function_call", "function_call_output"]
    assert result[3]["call_id"] == "call_1"
