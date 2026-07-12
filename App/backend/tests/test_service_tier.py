"""Service tier (flex/priority) provider settings tests."""

from __future__ import annotations

import asyncio

from App.backend.providers.registry import normalize_task_config


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
