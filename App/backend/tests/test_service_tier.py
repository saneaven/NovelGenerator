"""Service tier (flex/priority) provider settings tests."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from google.genai import types

from App.backend.providers.registry import normalize_task_config
from App.backend.providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler


def _load_providers():
    from App.backend.providers.gemini.llm import GeminiProvider
    from App.backend.providers.openai.llm import OpenAIResponsesProvider
    from App.backend.providers.openrouter.llm import OpenRouterProvider

    return GeminiProvider, OpenAIResponsesProvider, OpenRouterProvider


def _task_config(provider: str, model: str, service_tier: str, **advanced_extra) -> dict:
    return {
        "provider": provider,
        "model": model,
        "temperature": 0.7,
        "advanced": {
            "provider_settings": {"service_tier": service_tier},
            **advanced_extra,
        },
    }


def test_openai_task_config_preserves_service_tier() -> None:
    normalized = normalize_task_config("openai", _task_config("openai", "gpt-5.2", "flex"))

    assert normalized["advanced"]["provider_settings"]["service_tier"] == "flex"


def test_openai_task_config_drops_invalid_service_tier() -> None:
    normalized = normalize_task_config("openai", _task_config("openai", "gpt-5.2", "turbo"))

    assert "service_tier" not in normalized["advanced"]["provider_settings"]


def test_gemini_task_config_preserves_service_tier() -> None:
    normalized = normalize_task_config("gemini", _task_config("gemini", "gemini-2.5-flash", "flex"))

    assert normalized["advanced"]["provider_settings"]["service_tier"] == "flex"


def test_gemini_task_config_drops_auto_service_tier() -> None:
    normalized = normalize_task_config("gemini", _task_config("gemini", "gemini-2.5-flash", "auto"))

    assert "service_tier" not in normalized["advanced"]["provider_settings"]


def test_openrouter_task_config_preserves_service_tier() -> None:
    normalized = normalize_task_config("openrouter", _task_config("openrouter", "openai/gpt-5.2", "flex"))

    assert normalized["advanced"]["provider_settings"]["service_tier"] == "flex"


def test_custom_openai_response_task_config_preserves_service_tier() -> None:
    normalized = normalize_task_config(
        "custom",
        _task_config("custom", "gpt-5.2", "flex", custom_kind="openai_response"),
    )

    assert normalized["advanced"]["provider_settings"]["service_tier"] == "flex"


def test_xai_task_config_drops_service_tier() -> None:
    normalized = normalize_task_config("xai", _task_config("xai", "grok-4", "flex"))

    assert "service_tier" not in normalized["advanced"].get("provider_settings", {})


def test_openai_responses_request_includes_service_tier() -> None:
    _, OpenAIResponsesProvider, _ = _load_providers()
    provider = OpenAIResponsesProvider({})

    request = provider._prepare_responses_request(
        model="gpt-5.2",
        input_items=[],
        temperature=0.7,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        thinking_config=None,
        verbosity=None,
        provider_settings={"service_tier": "flex"},
    )

    assert request["service_tier"] == "flex"


def test_openai_responses_request_omits_default_service_tier() -> None:
    _, OpenAIResponsesProvider, _ = _load_providers()
    provider = OpenAIResponsesProvider({})

    for provider_settings in (None, {}, {"service_tier": "default"}):
        request = provider._prepare_responses_request(
            model="gpt-5.2",
            input_items=[],
            temperature=0.7,
            tools=None,
            tool_choice=None,
            max_tokens=None,
            thinking_config=None,
            verbosity=None,
            provider_settings=provider_settings,
        )

        assert "service_tier" not in request


def test_chat_completions_request_includes_service_tier() -> None:
    _, _, OpenRouterProvider = _load_providers()
    provider = OpenRouterProvider({"api_key": "test-key"})

    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content": "hi"}],
        model="openai/gpt-5.2",
        temperature=0.7,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        provider_preference=None,
        thinking_config=None,
        thinking_mode=None,
        provider_settings={"service_tier": "flex"},
    )

    assert request["service_tier"] == "flex"


def test_chat_completions_request_omits_default_service_tier() -> None:
    _, _, OpenRouterProvider = _load_providers()
    provider = OpenRouterProvider({"api_key": "test-key"})

    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content": "hi"}],
        model="openai/gpt-5.2",
        temperature=0.7,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        provider_preference=None,
        thinking_config=None,
        thinking_mode=None,
        provider_settings={"service_tier": "default"},
    )

    assert "service_tier" not in request


def test_gemini_stream_config_includes_service_tier() -> None:
    GeminiProvider, _, _ = _load_providers()
    provider = GeminiProvider({"api_key": "test-key"})

    async def _first_event():
        gen = provider.stream_chat(
            messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hi"}]}],
            model="gemini-2.5-flash",
            provider_settings={"service_tier": "flex"},
        )
        try:
            return await gen.__anext__()
        finally:
            await gen.aclose()

    # First event is the meta raw_request, yielded before any network call.
    event = asyncio.run(_first_event())

    assert event.kind == "meta"
    tier = (event.raw_request or {}).get("config", {}).get("service_tier")
    assert getattr(tier, "value", tier) == "flex"


def test_gemini_argon_stream_uses_sdk_continuation_and_preserves_signatures(monkeypatch) -> None:
    GeminiProvider, _, _ = _load_providers()
    provider = GeminiProvider({"api_key": "test-key"})
    calls: list[types.GenerateContentConfig] = []

    async def _fake_generate_content_stream(*, model, contents, config):
        assert model == "gemini-4-argon"
        assert config.temperature is None
        assert config.cached_content is None
        assert config.thinking_config.thinking_level == types.ThinkingLevel.MEDIUM
        assert config.automatic_function_calling.disable is True
        calls.append(config)

        async def _chunks():
            if len(calls) == 1:
                yield types.GenerateContentResponse(
                    candidates=[types.Candidate(
                        content=types.Content(role="model", parts=[types.Part(text="Hello")]),
                        finish_reason="CONTINUATION",
                        continuation_token=b"checkpoint",
                    )],
                    usage_metadata=types.GenerateContentResponseUsageMetadata(
                        prompt_token_count=2,
                        candidates_token_count=1,
                        thoughts_token_count=2,
                        total_token_count=5,
                    ),
                )
            else:
                yield types.GenerateContentResponse(
                    candidates=[types.Candidate(
                        content=types.Content(role="model", parts=[
                            types.Part(text=" world", thought_signature=b"signed-output"),
                        ]),
                        finish_reason="STOP",
                    )],
                    usage_metadata=types.GenerateContentResponseUsageMetadata(
                        prompt_token_count=0,
                        candidates_token_count=1,
                        thoughts_token_count=3,
                        total_token_count=4,
                    ),
                )
        return _chunks()

    async def _unexpected_cache(**_kwargs):
        raise AssertionError("Argon must not create explicit caches")

    monkeypatch.setattr(provider._client.aio.models, "_generate_content_stream", _fake_generate_content_stream)
    monkeypatch.setattr(provider, "_create_cached_content", _unexpected_cache)

    async def _run():
        try:
            return [event async for event in provider.stream_chat(
                messages=[
                    {"role": "user", "content_parts": [{"type": "content", "text": "hi"}]},
                    {"role": "assistant", "content_parts": [{"type": "content", "text": "hello"}]},
                    {"role": "user", "content_parts": [{"type": "content", "text": "continue"}]},
                ],
                model="gemini-4-argon",
                max_tokens=131072,
                thinking_mode="model",
                tools=[{"name": "read_story", "parameters": {"type": "object", "properties": {}}}],
                provider_settings={"cache": {"enabled": True, "explicit": True}},
                cache_plan=SimpleNamespace(
                    provider_strategy="gemini_explicit",
                    selected_provider_message_count=1,
                    selected_cache_handle="cachedContents/old",
                ),
            )]
        finally:
            await provider.aclose()

    events = asyncio.run(_run())
    assert len(calls) == 2
    assert calls[0].continuation_token is None
    assert calls[1].continuation_token == b"checkpoint"
    assert not any(event.kind == "error" for event in events)
    assembler = FallbackSnapshotAssembler("gemini", "gemini-4-argon")
    for event in events:
        if event.delta:
            assembler.apply_delta(event.delta)
        if event.meta:
            assembler.apply_meta(event.meta)
    snapshot = assembler.finalize_or_raise()
    assert snapshot.content_parts == [{"type": "content", "text": "Hello world"}]
    assert snapshot.finish_reason == "stop"
    assert snapshot.usage == {"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 9}
    assert snapshot.reasoning_tokens == 5
    reasoning_detail = provider.read_reasoning_detail(snapshot, {})
    replay = provider._convert_messages([{
        "role": "assistant",
        "content_parts": snapshot.content_parts,
        "reasoning_detail": reasoning_detail,
    }])["contents"][0].parts
    assert [part.text for part in replay] == ["Hello", " world"]
    assert replay[0].thought_signature is None
    assert replay[1].thought_signature == b"signed-output"


def test_gemini_closes_async_and_sync_sdk_resources() -> None:
    GeminiProvider, _, _ = _load_providers()
    provider = GeminiProvider({})
    calls: list[str] = []

    async def _aclose():
        calls.append("async")

    def _close():
        calls.append("sync")

    provider._client = SimpleNamespace(aio=SimpleNamespace(aclose=_aclose), close=_close)
    asyncio.run(provider.aclose())
    asyncio.run(provider.aclose())
    assert calls == ["async", "sync"]


def test_gemini_replays_signature_only_assistant_without_dropping_turn() -> None:
    GeminiProvider, _, _ = _load_providers()
    provider = GeminiProvider({})
    reasoning_detail = provider.read_reasoning_detail(SimpleNamespace(
        content_parts=[],
        reasoning_details=[{"thought": False, "thought_signature": "c2lnbmVkLW91dHB1dA=="}],
    ), {})

    converted = provider._convert_messages([{
        "role": "assistant",
        "content_parts": [],
        "reasoning_detail": reasoning_detail,
    }])

    assert len(converted["contents"]) == 1
    content = converted["contents"][0]
    assert content.role == "model"
    assert len(content.parts) == 1
    assert content.parts[0].thought is False
    assert content.parts[0].text is None
    assert content.parts[0].thought_signature == b"signed-output"
