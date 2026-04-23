from __future__ import annotations

from types import SimpleNamespace

from App.backend.providers.claude.llm import ClaudeProvider
from App.backend.providers.openai.llm import OpenAIResponsesProvider
from App.backend.providers.xai.llm import XAIProvider
from App.backend.services.llm_cache_settings import validate_llm_cache_settings
from App.backend.services.prompt_cache_service import (
    PreparedCachePlan,
    build_prepared_cache_plan,
    gemini_ttl_seconds,
)


def test_validate_llm_cache_settings_fills_defaults() -> None:
    settings = validate_llm_cache_settings({"openai": {"retention": "24h"}})

    assert settings["openai"]["enabled"] is True
    assert settings["openai"]["retention"] == "24h"
    assert settings["claude"]["ttl"] == "5m"
    assert settings["gemini"]["explicit_ttl_preset"] == "1h"
    assert settings["xai"]["enabled"] is True
    assert settings["nanogpt"]["stickyProvider"] is False


def test_openai_prepare_responses_request_includes_prompt_cache_hints() -> None:
    provider = OpenAIResponsesProvider({"api_key": "test-key"})
    request = provider._prepare_responses_request(
        model="gpt-5-mini",
        input_items=[{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}],
        temperature=0.2,
        tools=None,
        tool_choice=None,
        max_tokens=100,
        thinking_config=None,
        verbosity=None,
        cache_settings={"enabled": True, "retention": "24h"},
        cache_plan=SimpleNamespace(thread_cache_key="thread-123"),
    )

    assert request["prompt_cache_key"] == "thread-123"
    assert request["prompt_cache_retention"] == "24h"


def test_xai_request_kwargs_include_grok_conversation_header() -> None:
    provider = XAIProvider({"api_key": "test-key"})
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
        provider_settings=None,
        cache_settings={"enabled": True},
        cache_plan=SimpleNamespace(thread_cache_key="thread-xyz"),
    )

    assert request["extra_headers"]["x-grok-conv-id"] == "thread-xyz"


def test_claude_explicit_cache_controls_mark_system_and_message_targets() -> None:
    provider = ClaudeProvider({"api_key": "test-key"})
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
