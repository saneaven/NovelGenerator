from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
import json
import sys
import types
from typing import Any

import pytest

from App.backend.services.reasoning.history_filter import filter_history_by_run
from App.backend.services.reasoning.normalize import normalize_reasoning_detail


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

    if "httpx" not in sys.modules:
        fake_httpx = types.ModuleType("httpx")

        class _StubAsyncClient:
            pass

        class _StubHTTPStatusError(Exception):
            pass

        class _StubTimeout:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

        fake_httpx.AsyncClient = _StubAsyncClient
        fake_httpx.HTTPStatusError = _StubHTTPStatusError
        fake_httpx.Timeout = _StubTimeout
        sys.modules["httpx"] = fake_httpx

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
        fake_errors.APIError = Exception
        fake_genai.errors = fake_errors
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

    if "App.backend.services.prompt_cache_service" not in sys.modules:
        fake_prompt_cache_service = types.ModuleType("App.backend.services.prompt_cache_service")
        fake_prompt_cache_service.gemini_ttl_seconds = lambda _ttl_preset: "3600s"
        sys.modules["App.backend.services.prompt_cache_service"] = fake_prompt_cache_service


def _load_providers():
    _ensure_provider_stubs()
    from App.backend.providers.claude.llm import ClaudeProvider
    from App.backend.providers.custom.llm import CustomProvider
    from App.backend.providers.gemini.llm import GeminiProvider
    from App.backend.providers.openai.llm import OpenAIResponsesProvider
    from App.backend.providers.openrouter.llm import OpenRouterProvider
    from App.backend.providers.xai.llm import XAIProvider

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


def test_openrouter_merge_reasoning_details_preserves_boundaries_and_input() -> None:
    _ensure_provider_stubs()
    from App.backend.providers.openrouter.llm import _merge_openrouter_reasoning_details

    details: list[Any] = [
        {
            "id": "text-first",
            "index": 7,
            "type": "reasoning.text",
            "text": "first\n",
            "format": "",
            "signature": "",
        },
        {
            "id": "text-later",
            "index": 0,
            "type": "reasoning.text",
            "signature": "sig-later",
        },
        {
            "id": "text-last",
            "index": 99,
            "type": "reasoning.text",
            "text": "second",
            "format": "openai-responses-v1",
        },
        {
            "id": "summary-first",
            "index": 11,
            "type": "reasoning.summary",
            "summary": "sum",
        },
        {
            "id": "summary-later",
            "index": 0,
            "type": "reasoning.summary",
            "format": "openai-responses-v1",
        },
        {
            "id": "summary-last",
            "index": 42,
            "type": "reasoning.summary",
            "summary": "mary",
        },
    ]
    original = copy.deepcopy(details)

    merged = _merge_openrouter_reasoning_details(details)

    assert merged == [
        {
            "id": "text-first",
            "index": 7,
            "type": "reasoning.text",
            "text": "first\nsecond",
            "format": "openai-responses-v1",
            "signature": "sig-later",
        },
        {
            "id": "summary-first",
            "index": 11,
            "type": "reasoning.summary",
            "summary": "summary",
            "format": "openai-responses-v1",
        },
    ]
    assert details == original
    assert merged is not details
    assert merged[0] is not details[0]


def test_openrouter_merge_reasoning_details_stops_at_opaque_or_malformed_items() -> None:
    _ensure_provider_stubs()
    from App.backend.providers.openrouter.llm import _merge_openrouter_reasoning_details

    details: list[Any] = [
        {"type": "reasoning.text", "text": "a"},
        {"type": "reasoning.encrypted", "data": "opaque"},
        {"type": "reasoning.text", "text": "b"},
        {"type": "vendor.reasoning", "text": "unknown"},
        {"type": "reasoning.text", "text": "c"},
        {"type": "reasoning.text", "text": 123},
        {"type": "reasoning.text", "text": "d"},
        "malformed",
        {"type": ["reasoning.text"], "text": "malformed type"},
        {"id": "summary", "type": "reasoning.summary", "summary": "one"},
        {"type": "reasoning.summary", "format": "openai-responses-v1"},
        {"type": "reasoning.summary", "summary": "two"},
    ]

    assert _merge_openrouter_reasoning_details(details) == [
        *details[:9],
        {
            "id": "summary",
            "type": "reasoning.summary",
            "summary": "onetwo",
            "format": "openai-responses-v1",
        },
    ]


def test_openrouter_read_reasoning_detail_merges_stream_fragments_before_storage() -> None:
    _, _, _, _, OpenRouterProvider, _ = _load_providers()
    provider = OpenRouterProvider({})
    snapshot = _Snapshot(
        content_parts=[{"type": "thinking", "text": "first\nsecond"}],
        reasoning_details=[
            {
                "id": "summary-first",
                "index": 0,
                "type": "reasoning.summary",
                "summary": "first\n",
            },
            {
                "id": "summary-later",
                "index": 0,
                "type": "reasoning.summary",
                "summary": "second",
                "format": "openai-responses-v1",
            },
        ],
    )
    original_details = copy.deepcopy(snapshot.reasoning_details)

    detail = provider.read_reasoning_detail(snapshot, {})

    assert detail is not None
    assert detail["meta"] == {
        "provider": "openrouter",
        "openrouter_reasoning_format": "openai-responses-v1",
        "thinking_display": "reasoning",
    }
    assert detail["data"] == {
        "reasoning": "first\nsecond",
        "reasoning_details": [
            {
                "id": "summary-first",
                "index": 0,
                "type": "reasoning.summary",
                "summary": "first\nsecond",
                "format": "openai-responses-v1",
            }
        ],
    }
    assert snapshot.reasoning_details == original_details


@pytest.mark.parametrize("details_key", ["reasoning_details", "details"])
def test_openrouter_history_merges_before_reasoning_format_filter(details_key: str) -> None:
    _, _, _, _, OpenRouterProvider, _ = _load_providers()
    provider = OpenRouterProvider({})
    reasoning_detail = {
        "type": "openrouter",
        "meta": {
            "provider": "openrouter",
            "openrouter_reasoning_format": "openai-responses-v1",
        },
        "data": {
            details_key: [
                {
                    "id": "summary-first",
                    "index": 5,
                    "type": "reasoning.summary",
                    "summary": "first",
                },
                {
                    "id": "summary-later",
                    "index": 0,
                    "type": "reasoning.summary",
                    "summary": "\nsecond",
                    "format": "openai-responses-v1",
                },
            ]
        },
    }
    messages = [
        {
            "role": "assistant",
            "content_parts": [{"type": "content", "text": "answer"}],
            "reasoning_detail": reasoning_detail,
        }
    ]
    original_messages = copy.deepcopy(messages)

    converted = provider._convert_messages(messages)

    assert converted == [
        {
            "role": "assistant",
            "content": "answer",
            "reasoning_details": [
                {
                    "id": "summary-first",
                    "index": 5,
                    "type": "reasoning.summary",
                    "summary": "first\nsecond",
                    "format": "openai-responses-v1",
                }
            ],
        }
    ]
    assert messages == original_messages


def test_nanogpt_read_reasoning_detail_preserves_text_details_and_display() -> None:
    _ensure_provider_stubs()
    from App.backend.providers.nanogpt.llm import NanoGPTProvider

    provider = NanoGPTProvider({})
    snapshot = _Snapshot(
        content_parts=[
            {"type": "thinking", "text": "route analysis"},
            {"type": "content", "text": "answer"},
        ],
        reasoning_details=[{"format": "native", "text": "route analysis"}],
    )

    detail = normalize_reasoning_detail(provider.read_reasoning_detail(snapshot, {}))

    assert detail is not None
    assert detail["type"] == "nanogpt"
    assert detail["meta"] == {
        "provider": "nanogpt",
        "thinking_display": "reasoning_text",
    }
    assert detail["data"]["reasoning_text"] == "route analysis"
    assert detail["data"]["reasoning_details"] == [{"format": "native", "text": "route analysis"}]


def _patch_gemini_part_types(monkeypatch: Any) -> None:
    from App.backend.providers.gemini import llm as gemini_llm

    class _Part:
        def __init__(self, **kwargs: object) -> None:
            self.__dict__.update(kwargs)

        @classmethod
        def from_text(cls, *, text: str) -> "_Part":
            return cls(text=text)

        @classmethod
        def from_bytes(cls, *, data: bytes, mime_type: str) -> "_Part":
            return cls(data=data, mime_type=mime_type)

        @classmethod
        def from_function_response(cls, *, name: str, response: dict[str, object]) -> "_Part":
            return cls(name=name, response=response)

        @classmethod
        def from_function_call(cls, *, name: str, args: dict[str, object]) -> "_Part":
            return cls(name=name, args=args)

        @classmethod
        def model_validate(cls, payload: dict[str, object]) -> "_Part":
            return cls(**payload)

        def model_dump(self, *_args: object, **_kwargs: object) -> dict[str, object]:
            return dict(self.__dict__)

    class _Content:
        def __init__(self, role: str | None = None, parts: list[object] | None = None) -> None:
            self.role = role
            self.parts = parts or []

    monkeypatch.setattr(gemini_llm.types, "Part", _Part)
    monkeypatch.setattr(gemini_llm.types, "Content", _Content)


def test_gemini_convert_messages_restores_function_call_thought_signature(monkeypatch: Any) -> None:
    _, _, GeminiProvider, _, _, _ = _load_providers()
    _patch_gemini_part_types(monkeypatch)
    provider = GeminiProvider({})

    converted = provider._convert_messages(
        [
            {
                "role": "assistant",
                "content_parts": [],
                "tool_calls": [
                    {
                        "id": "tool_call_1",
                        "type": "function",
                        "function": {
                            "name": "patch_story_entity",
                            "arguments": '{"id":"entity-1"}',
                        },
                        "extra_content": {
                            "gemini_thought_signature": "sig-a",
                            "__tool_meta": {"preview": True},
                        },
                    }
                ],
            }
        ]
    )

    part = converted["contents"][0].parts[0]
    assert part.name == "patch_story_entity"
    assert part.args == {"id": "entity-1"}
    assert part.thought_signature == "sig-a"


def test_gemini_convert_messages_without_signature_keeps_existing_function_call_shape(monkeypatch: Any) -> None:
    _, _, GeminiProvider, _, _, _ = _load_providers()
    _patch_gemini_part_types(monkeypatch)
    provider = GeminiProvider({})

    converted = provider._convert_messages(
        [
            {
                "role": "assistant",
                "content_parts": [],
                "tool_calls": [
                    {
                        "id": "tool_call_1",
                        "type": "function",
                        "function": {
                            "name": "patch_story_entity",
                            "arguments": '{"id":"entity-1"}',
                        },
                    }
                ],
            }
        ]
    )

    part = converted["contents"][0].parts[0]
    assert part.name == "patch_story_entity"
    assert part.args == {"id": "entity-1"}
    assert not hasattr(part, "thought_signature")


def test_gemini_function_call_delta_captures_thought_signature() -> None:
    _, _, GeminiProvider, _, _, _ = _load_providers()
    function_call = types.SimpleNamespace(id="call_1", name="patch_story_entity", args={"id": "entity-1"})
    part = types.SimpleNamespace(function_call=function_call, thought_signature="sig-a")

    delta = GeminiProvider._function_call_delta_from_part(
        part=part,
        function_call=function_call,
        index=0,
    )

    assert delta["extra_content"] == {"gemini_thought_signature": "sig-a"}
    assert delta["function"]["name"] == "patch_story_entity"


def test_gemini_function_call_delta_base64_encodes_bytes_signature() -> None:
    _, _, GeminiProvider, _, _, _ = _load_providers()
    function_call = types.SimpleNamespace(id="call_1", name="patch_story_entity", args={"id": "entity-1"})
    part = types.SimpleNamespace(function_call=function_call, thought_signature=b"sig-a")

    delta = GeminiProvider._function_call_delta_from_part(
        part=part,
        function_call=function_call,
        index=0,
    )

    assert delta["extra_content"] == {"gemini_thought_signature": "c2lnLWE="}


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


def test_openai_read_reasoning_detail_stores_tool_output_items_directly() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    raw_output = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc",
            "status": "completed",
            "content": None,
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "read_story_entity",
            "arguments": '{ "id" : "entity-1" }',
            "status": "completed",
        },
    ]
    snapshot = _Snapshot(
        content_parts=[],
        reasoning_details=[],
        raw_native_response={"output": raw_output},
    )

    detail = provider.read_reasoning_detail(snapshot, {})

    assert detail is not None
    assert detail["data"] == {
        "output_items": [
            {
                "id": "rs_1",
                "type": "reasoning",
                "summary": [],
                "encrypted_content": "enc",
                "status": "completed",
            },
            {
                "id": "fc_1",
                "type": "function_call",
                "call_id": "call_1",
                "name": "read_story_entity",
                "arguments": '{ "id" : "entity-1" }',
                "status": "completed",
            },
        ]
    }
    assert "tool_replay" not in detail["data"]
    assert "version" not in detail["data"]


def test_custom_openai_response_read_reasoning_detail_does_not_build_delegate(monkeypatch) -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    monkeypatch.setattr(
        provider,
        "_build_openai_response_delegate",
        lambda: (_ for _ in ()).throw(AssertionError("delegate should not be built")),
    )
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


def test_custom_openai_response_stores_the_same_direct_output_items(monkeypatch) -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    monkeypatch.setattr(
        provider,
        "_build_openai_response_delegate",
        lambda: (_ for _ in ()).throw(AssertionError("delegate should not be built")),
    )
    raw_output = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc",
            "status": "completed",
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "read_story_entity",
            "arguments": "{}",
            "status": "completed",
        },
    ]
    snapshot = _Snapshot(
        content_parts=[],
        reasoning_details=[],
        raw_native_response={"output": raw_output},
    )

    detail = provider.read_reasoning_detail(snapshot, {"custom_kind": "openai_response"})

    assert detail is not None
    assert detail["data"] == {"output_items": raw_output}
    assert "tool_replay" not in detail["data"]
    assert "version" not in detail["data"]


def test_custom_claude_read_reasoning_detail_does_not_build_delegate(monkeypatch) -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    monkeypatch.setattr(
        provider,
        "_build_claude_delegate",
        lambda: (_ for _ in ()).throw(AssertionError("delegate should not be built")),
    )
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


def test_custom_stream_closes_delegate(monkeypatch) -> None:
    _, CustomProvider, _, _, _, _ = _load_providers()
    provider = CustomProvider({})
    closed: list[str] = []

    class _Delegate:
        async def stream_chat(self, **_kwargs):
            yield types.SimpleNamespace(kind="meta")

        async def aclose(self) -> None:
            closed.append("closed")

    monkeypatch.setattr(provider, "_build_claude_delegate", lambda: _Delegate())

    async def _collect() -> list[object]:
        return [
            event
            async for event in provider.stream_chat(
                messages=[],
                model="model-a",
                custom_kind="claude",
            )
        ]

    events = asyncio.run(_collect())

    assert len(events) == 1
    assert closed == ["closed"]


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
                    "function": {"name": "read_story_entity", "arguments": "{}"},
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
                    "function": {"name": "read_story_entity", "arguments": "{}"},
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


def test_openai_convert_messages_replays_direct_output_items_without_empty_message() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    output_items = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc",
            "status": "completed",
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "read_story_entity",
            "arguments": '{ "id" : "entity-1" }',
            "status": "completed",
        },
    ]
    messages = [
        {
            "role": "assistant",
            "content_parts": [],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "read_story_entity",
                        "arguments": '{"id":"entity-1"}',
                    },
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {"output_items": output_items},
            },
        },
        {
            "role": "tool_results",
            "content_parts": [],
            "tool_results": [
                {"tool_call_id": "call_1", "content": "result payload"}
            ],
        },
    ]

    result = provider._convert_messages(messages)

    assert [item["type"] for item in result] == [
        "reasoning",
        "function_call",
        "function_call_output",
    ]
    assert result[:2] == output_items
    assert result[1]["arguments"] == '{ "id" : "entity-1" }'
    assert result[2]["call_id"] == "call_1"


def test_openai_convert_messages_preserves_interleaved_output_item_order() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    output_items = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc-1",
            "status": "completed",
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "first_tool",
            "arguments": "{}",
            "status": "completed",
        },
        {
            "id": "rs_2",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc-2",
            "status": "completed",
        },
        {
            "id": "fc_2",
            "type": "function_call",
            "call_id": "call_2",
            "name": "second_tool",
            "arguments": '{"value":2}',
            "status": "completed",
        },
    ]
    messages = [
        {
            "role": "assistant",
            "content_parts": [],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "first_tool", "arguments": "{}"},
                },
                {
                    "id": "call_2",
                    "type": "function",
                    "function": {
                        "name": "second_tool",
                        "arguments": '{"value": 2}',
                    },
                },
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {"output_items": output_items},
            },
        },
    ]

    result = provider._convert_messages(messages)

    assert result == output_items


def test_openai_convert_messages_preserves_real_message_in_direct_output_items() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    provider = OpenAIResponsesProvider({})
    output_items = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc",
            "status": "completed",
        },
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "status": "completed",
            "phase": "commentary",
            "content": [{"type": "output_text", "text": "Calling the tool."}],
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "read_story_entity",
            "arguments": "{}",
            "status": "completed",
        },
    ]
    messages = [
        {
            "role": "assistant",
            "content_parts": [
                {"type": "content", "text": "Calling the tool."}
            ],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "read_story_entity", "arguments": "{}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {"output_items": output_items},
            },
        },
    ]

    result = provider._convert_messages(messages)

    assert result == output_items


def test_openai_convert_messages_legacy_reasoning_without_message_id_does_not_add_message() -> None:
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
                    "function": {"name": "read_story_entity", "arguments": "{}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {
                    "items": [
                        {
                            "id": "rs_1",
                            "type": "reasoning",
                            "encrypted_content": "enc",
                        }
                    ],
                    "function_call_item_ids": {"call_1": "fc_1"},
                },
            },
        },
    ]

    result = provider._convert_messages(messages)

    assert [item["type"] for item in result] == ["reasoning", "function_call"]


def test_openai_convert_messages_does_not_treat_other_provider_data_as_output_items() -> None:
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
                    "function": {"name": "db_tool", "arguments": "{}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai_compatible_template",
                "data": {
                    "output_items": [
                        {
                            "id": "fc_other",
                            "type": "function_call",
                            "call_id": "call_other",
                            "name": "other_tool",
                            "arguments": "{}",
                        }
                    ]
                },
            },
        },
    ]

    result = provider._convert_messages(messages)

    assert result == [
        {
            "type": "function_call",
            "call_id": "call_1",
            "name": "db_tool",
            "arguments": "{}",
        }
    ]


@pytest.mark.parametrize(
    ("output_items", "tool_calls"),
    [
        (
            None,
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                }
            ],
        ),
        (
            [],
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                }
            ],
        ),
        (
            {"type": "function_call"},
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                }
            ],
        ),
        (
            [
                {
                    "id": "fc_1",
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "tool",
                }
            ],
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                }
            ],
        ),
        (
            [
                {
                    "id": "fc_1",
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "tool",
                    "arguments": "{}",
                },
                {
                    "id": "fc_2",
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "tool",
                    "arguments": "{}",
                },
            ],
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                },
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                },
            ],
        ),
        (
            [
                {
                    "id": "fc_2",
                    "type": "function_call",
                    "call_id": "call_2",
                    "name": "tool",
                    "arguments": "{}",
                },
                {
                    "id": "fc_1",
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "tool",
                    "arguments": "{}",
                },
            ],
            [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                },
                {
                    "id": "call_2",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                },
            ],
        ),
        (
            [
                {
                    "id": "fc_2",
                    "type": "function_call",
                    "call_id": "call_2",
                    "name": "tool",
                    "arguments": "{}",
                }
            ],
            [],
        ),
    ],
)
def test_openai_convert_messages_rejects_inconsistent_direct_output_items(
    output_items: Any,
    tool_calls: list[dict[str, Any]],
) -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    from App.backend.providers.openai.llm import (
        OPENAI_OUTPUT_ITEMS_ERROR,
        OpenAIOutputItemsError,
    )

    provider = OpenAIResponsesProvider({})
    message: dict[str, Any] = {
        "role": "assistant",
        "content_parts": [],
        "reasoning_detail": {
            "type": "openai",
            "data": {"output_items": output_items},
        },
    }
    if tool_calls:
        message["tool_calls"] = tool_calls

    with pytest.raises(OpenAIOutputItemsError, match=OPENAI_OUTPUT_ITEMS_ERROR):
        provider._convert_messages([message])


def test_openai_stream_rejects_inconsistent_output_items_before_client_call(
    monkeypatch: Any,
    caplog: Any,
) -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    from App.backend.providers.openai.llm import OPENAI_OUTPUT_ITEMS_ERROR

    provider = OpenAIResponsesProvider({})
    client_called = False

    def _unexpected_client() -> None:
        nonlocal client_called
        client_called = True
        raise AssertionError("OpenAI client must not be created")

    monkeypatch.setattr(provider, "validate_config", lambda: True)
    monkeypatch.setattr(provider, "_ensure_client", _unexpected_client)
    messages = [
        {
            "role": "assistant",
            "run_id": "run-1",
            "content_parts": [],
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "tool", "arguments": "{}"},
                }
            ],
            "reasoning_detail": {
                "type": "openai",
                "data": {
                    "output_items": [
                        {
                            "id": "fc_2",
                            "type": "function_call",
                            "call_id": "call_2",
                            "name": "tool",
                            "arguments": '{"secret":"must-not-be-logged"}',
                        }
                    ]
                },
            },
        }
    ]

    async def _collect() -> list[Any]:
        return [
            event
            async for event in provider.stream_chat(
                messages=messages,
                model="gpt-test",
            )
        ]

    events = asyncio.run(_collect())

    assert client_called is False
    assert len(events) == 1
    assert events[0].kind == "error"
    assert events[0].error is not None
    assert events[0].error.message == OPENAI_OUTPUT_ITEMS_ERROR
    assert "run-1" in caplog.text
    assert "call_1" in caplog.text
    assert "call_2" in caplog.text
    assert "must-not-be-logged" not in caplog.text


def test_openai_output_items_survive_snapshot_normalization_and_history_filter() -> None:
    _, _, _, OpenAIResponsesProvider, _, _ = _load_providers()
    from App.backend.providers.shared.parsing.final_mappers import (
        map_openai_response_to_snapshot,
    )

    provider = OpenAIResponsesProvider({})
    raw_output = [
        {
            "id": "rs_1",
            "type": "reasoning",
            "summary": [],
            "encrypted_content": "enc",
            "status": "completed",
        },
        {
            "id": "fc_1",
            "type": "function_call",
            "call_id": "call_1",
            "name": "read_story_entity",
            "arguments": '{ "id" : "entity-1" }',
            "status": "completed",
        },
    ]
    snapshot = map_openai_response_to_snapshot(
        {
            "status": "completed",
            "output": raw_output,
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5,
                "total_tokens": 15,
            },
        },
        provider="openai",
        model="gpt-test",
    )
    detail = normalize_reasoning_detail(
        provider.read_reasoning_detail(snapshot, {})
    )
    assert detail is not None
    tool_call = snapshot.tool_calls[0]
    messages = [
        {
            "role": "assistant",
            "run_id": "r1",
            "content_parts": snapshot.content_parts,
            "reasoning_detail": detail,
            "tool_calls": [
                {
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.tool_name,
                        "arguments": json.dumps(tool_call.arguments),
                    },
                }
            ],
        },
        {
            "role": "tool_results",
            "run_id": "r1",
            "tool_results": [
                {"tool_call_id": "call_1", "content": "result payload"}
            ],
        },
    ]

    filtered = filter_history_by_run(
        messages,
        current_run_id="r2",
        tool_limit=1,
        thinking_limit=0,
    )
    converted = provider._convert_messages(filtered)

    assert [item["type"] for item in converted] == [
        "reasoning",
        "function_call",
        "function_call_output",
    ]
    assert converted[:2] == raw_output
    assert converted[1]["arguments"] == '{ "id" : "entity-1" }'
