from __future__ import annotations

import sys
import types
from types import SimpleNamespace

if "anthropic" not in sys.modules:
    anthropic_stub = types.ModuleType("anthropic")
    anthropic_stub.AsyncAnthropic = object
    sys.modules["anthropic"] = anthropic_stub

if "openai" not in sys.modules:
    openai_stub = types.ModuleType("openai")

    class OpenAIError(Exception):
        pass

    class APIConnectionError(OpenAIError):
        pass

    class APIStatusError(OpenAIError):
        pass

    class AuthenticationError(OpenAIError):
        pass

    class BadRequestError(OpenAIError):
        pass

    class RateLimitError(OpenAIError):
        pass

    class AsyncOpenAI:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    openai_stub.OpenAIError = OpenAIError
    openai_stub.APIConnectionError = APIConnectionError
    openai_stub.APIStatusError = APIStatusError
    openai_stub.AuthenticationError = AuthenticationError
    openai_stub.BadRequestError = BadRequestError
    openai_stub.RateLimitError = RateLimitError
    openai_stub.AsyncOpenAI = AsyncOpenAI
    sys.modules["openai"] = openai_stub

if "App.backend.models.db_models" not in sys.modules:
    db_models_stub = types.ModuleType("App.backend.models.db_models")

    class RunMessageAttachmentModel:  # pragma: no cover - import stub for provider unit tests
        pass

    class ThreadPromptCache:  # pragma: no cover - import stub for cache planner unit tests
        pass

    db_models_stub.RunMessageAttachmentModel = RunMessageAttachmentModel
    db_models_stub.ThreadPromptCache = ThreadPromptCache
    sys.modules["App.backend.models.db_models"] = db_models_stub

if "App.backend.services.chat_attachment_service" not in sys.modules:
    attachment_service_stub = types.ModuleType("App.backend.services.chat_attachment_service")
    attachment_service_stub.chat_attachment_service = SimpleNamespace(
        load_attachment_bytes=lambda *_args, **_kwargs: b"",
        to_data_url=lambda mime_type, _data: f"data:{mime_type};base64,",
    )
    sys.modules["App.backend.services.chat_attachment_service"] = attachment_service_stub

if "App.backend.services.storage_usage_service" not in sys.modules:
    storage_usage_stub = types.ModuleType("App.backend.services.storage_usage_service")
    storage_usage_stub.apply_project_usage_delta = lambda *args, **kwargs: None
    storage_usage_stub.build_thread_prompt_cache_delta = lambda *args, **kwargs: {}
    storage_usage_stub.snapshot_thread_prompt_cache_row = lambda row: row
    sys.modules["App.backend.services.storage_usage_service"] = storage_usage_stub

from App.backend.providers.claude.llm import ClaudeProvider
from App.backend.providers.openai.llm import OpenAIResponsesProvider
from App.backend.providers.xai.llm import XAIProvider
from App.backend.services.prompt_cache_service import (
    PreparedCachePlan,
    build_prepared_cache_plan,
    gemini_ttl_seconds,
)
from App.backend.services.task_config_settings import normalize_effective_task_config


def test_normalize_effective_task_config_keeps_explicit_cache_false() -> None:
    normalized = normalize_effective_task_config(
        {
            "provider": "openai",
            "model": "gpt-5-mini",
            "temperature": 0.7,
            "provider_preference": None,
            "max_output_tokens": None,
            "context_window_tokens": 32000,
            "advanced": {
                "thinking_mode": "off",
                "provider_settings": {
                    "cache": {
                        "enabled": False,
                        "retention": "24h",
                    }
                },
            },
        }
    )

    assert normalized["advanced"]["provider_settings"]["cache"]["enabled"] is False
    assert normalized["advanced"]["provider_settings"]["cache"]["retention"] == "24h"


def test_openai_prepare_responses_request_includes_prompt_cache_hints() -> None:
    provider = OpenAIResponsesProvider({})
    request = provider._prepare_responses_request(
        model="gpt-5-mini",
        input_items=[{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}],
        temperature=0.2,
        tools=None,
        tool_choice=None,
        max_tokens=100,
        thinking_config=None,
        verbosity=None,
        provider_settings={"cache": {"enabled": True, "retention": "24h"}},
        cache_plan=SimpleNamespace(thread_cache_key="thread-123"),
    )

    assert request["prompt_cache_key"] == "thread-123"
    assert request["prompt_cache_retention"] == "24h"


def test_openai_prepare_responses_request_omits_prompt_cache_hints_when_disabled() -> None:
    provider = OpenAIResponsesProvider({})
    request = provider._prepare_responses_request(
        model="gpt-5-mini",
        input_items=[{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}],
        temperature=0.2,
        tools=None,
        tool_choice=None,
        max_tokens=100,
        thinking_config=None,
        verbosity=None,
        provider_settings={"cache": {"enabled": False, "retention": "24h"}},
        cache_plan=SimpleNamespace(thread_cache_key="thread-123"),
    )

    assert "prompt_cache_key" not in request
    assert "prompt_cache_retention" not in request


def test_openai_prepare_responses_request_forwards_max_reasoning_effort() -> None:
    provider = OpenAIResponsesProvider({})
    request = provider._prepare_responses_request(
        model="gpt-5.6",
        input_items=[{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}],
        temperature=0.2,
        tools=None,
        tool_choice=None,
        max_tokens=100,
        thinking_config={"effort": "max"},
        verbosity=None,
    )

    assert request["reasoning"] == {"effort": "max", "summary": "auto"}


def test_xai_request_kwargs_include_grok_conversation_header() -> None:
    provider = XAIProvider({})
    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hi"}]}],
        model="grok-4",
        temperature=0.2,
        tools=None,
        tool_choice=None,
        max_tokens=32,
        provider_preference=None,
        thinking_config=None,
        thinking_mode="off",
        provider_settings={"cache": {"enabled": True}},
        cache_plan=SimpleNamespace(thread_cache_key="thread-xyz"),
    )

    assert request["extra_headers"]["x-grok-conv-id"] == "thread-xyz"


def test_xai_request_kwargs_omits_grok_conversation_header_when_cache_disabled() -> None:
    provider = XAIProvider({})
    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hi"}]}],
        model="grok-4",
        temperature=0.2,
        tools=None,
        tool_choice=None,
        max_tokens=32,
        provider_preference=None,
        thinking_config=None,
        thinking_mode="off",
        provider_settings={"cache": {"enabled": False}},
        cache_plan=SimpleNamespace(thread_cache_key="thread-xyz"),
    )

    assert "extra_headers" not in request or "x-grok-conv-id" not in request.get("extra_headers", {})


def test_claude_explicit_cache_controls_mark_system_and_message_targets() -> None:
    provider = ClaudeProvider({})
    cache_plan = PreparedCachePlan(
        provider="claude",
        provider_strategy="claude_explicit",
        enabled=True,
        cache_settings={"enabled": True, "ttl": "1h"},
        checkpoints=[
            SimpleNamespace(checkpoint_id="cp-system", provider_message_count=0, block_order=0),
            SimpleNamespace(checkpoint_id="cp-message", provider_message_count=1, block_order=1),
        ],
        applied_checkpoint_ids=["cp-system", "cp-message"],
        dropped_checkpoint_ids=[],
        ttl_label="1h",
    )

    system, messages = provider._apply_explicit_cache_controls(
        system_prompt="sys",
        anthropic_messages=[{"role": "user", "content": [{"type": "text", "text": "hello"}]}],
        cache_plan=cache_plan,
    )

    assert isinstance(system, list)
    assert system[-1]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    assert messages[0]["content"][-1]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}


def test_build_prepared_cache_plan_limits_claude_explicit_checkpoints() -> None:
    cache_boundaries = [
        {
            "checkpoint_id": f"cp-{index}",
            "block_id": f"cp-{index}",
            "block_order": index,
            "rendered_message_count": index,
            "last_seq_in_thread": index,
            "last_role": "assistant",
            "prefix_label": f"{index} messages",
            "prefix_digest_raw": f"digest-{index}",
        }
        for index in range(5)
    ]
    prepared = build_prepared_cache_plan(
        db=object(),
        thread_id="thread-1",
        provider="claude",
        model="claude-sonnet-4",
        cache_settings={"enabled": True, "ttl": "1h"},
        cache_boundaries=cache_boundaries,
        provider_messages_with_internal_keys=[
            {"role": "system"},
            *[
                {"role": "user", "_render_index": index}
                for index in range(5)
            ],
        ],
    )

    assert prepared.provider_strategy == "claude_explicit"
    assert prepared.applied_checkpoint_ids == ["cp-0", "cp-1", "cp-2", "cp-3"]
    assert prepared.dropped_checkpoint_ids == ["cp-4"]


def test_gemini_ttl_seconds_uses_presets() -> None:
    assert gemini_ttl_seconds("5m") == "300s"
    assert gemini_ttl_seconds("6h") == "21600s"
    assert gemini_ttl_seconds("unknown") == "3600s"
