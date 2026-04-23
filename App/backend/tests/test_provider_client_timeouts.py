from __future__ import annotations

try:
    import httpx
except ImportError:  # pragma: no cover - fallback for stripped-down test envs.
    import sys
    import types

    fake_httpx = types.ModuleType("httpx")

    class _StubTimeout:
        def __init__(
            self,
            timeout: float | None = None,
            *,
            connect: float | None = None,
            read: float | None = None,
            write: float | None = None,
            pool: float | None = None,
        ) -> None:
            self.connect = connect if connect is not None else timeout
            self.read = read if read is not None else timeout
            self.write = write if write is not None else timeout
            self.pool = pool if pool is not None else timeout

    fake_httpx.Timeout = _StubTimeout
    sys.modules.setdefault("httpx", fake_httpx)

    import httpx

import App.backend.providers.shared.async_openai_provider as async_openai_provider_module
import App.backend.providers.claude.llm as claude_provider_module
import App.backend.providers.custom.llm as custom_provider_module
import App.backend.providers.openai.llm as openai_responses_provider_module
from App.backend.providers.shared.async_openai_provider import AsyncOpenAIProvider
from App.backend.providers.claude.llm import ClaudeProvider
from App.backend.providers.shared.transport.client_timeouts import (
    LLM_STREAM_TIMEOUT_ENV_VAR,
    get_llm_stream_timeout,
)
from App.backend.providers.openai.llm import OpenAIResponsesProvider


def _assert_default_timeout(timeout: object) -> None:
    assert isinstance(timeout, httpx.Timeout)
    assert timeout.connect == 5.0
    assert timeout.read == 3600.0
    assert timeout.write == 3600.0
    assert timeout.pool == 3600.0


def test_llm_stream_timeout_helper_uses_centralized_defaults() -> None:
    assert LLM_STREAM_TIMEOUT_ENV_VAR == "LLM_STREAM_TIMEOUT_SECONDS"
    _assert_default_timeout(get_llm_stream_timeout())


def test_async_openai_provider_build_client_uses_centralized_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_async_openai(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(async_openai_provider_module, "AsyncOpenAI", _fake_async_openai)
    monkeypatch.setattr(async_openai_provider_module, "validate_outbound_base_url", lambda url: url)

    class _Provider(AsyncOpenAIProvider):
        @property
        def name(self) -> str:
            return "test-openai"

        @property
        def display_name(self) -> str:
            return "Test OpenAI"

        def validate_config(self) -> bool:
            return True

    _Provider({"api_key": "key", "base_url": "https://example.invalid/v1"})

    _assert_default_timeout(captured["timeout"])
    assert captured["api_key"] == "key"
    assert captured["base_url"] == "https://example.invalid/v1"


def test_openai_responses_provider_build_client_uses_centralized_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_async_openai(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(openai_responses_provider_module, "AsyncOpenAI", _fake_async_openai)

    OpenAIResponsesProvider({"api_key": "key"})

    _assert_default_timeout(captured["timeout"])
    assert captured["api_key"] == "key"
    assert captured["base_url"] == "https://api.openai.com/v1"


def test_claude_provider_build_client_uses_centralized_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_async_anthropic(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(claude_provider_module, "AsyncAnthropic", _fake_async_anthropic)

    ClaudeProvider({"api_key": "key"})

    _assert_default_timeout(captured["timeout"])
    assert captured["api_key"] == "key"
    assert "base_url" not in captured


def test_custom_openai_responses_provider_build_client_uses_centralized_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_async_openai(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(custom_provider_module, "AsyncOpenAI", _fake_async_openai)
    monkeypatch.setattr(custom_provider_module, "validate_outbound_base_url", lambda url: url)

    provider = custom_provider_module._CustomOpenAIResponseProvider(
        {
            "base_url": "https://gateway.invalid/v1",
            "api_key": "key",
            "additional_headers": {"X-Test": "1"},
        }
    )
    provider._build_client()

    _assert_default_timeout(captured["timeout"])
    assert captured["api_key"] == "key"
    assert captured["base_url"] == "https://gateway.invalid/v1"
    assert captured["default_headers"] == {"X-Test": "1"}


def test_custom_claude_provider_build_client_uses_centralized_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_async_anthropic(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(custom_provider_module, "AsyncAnthropic", _fake_async_anthropic)
    monkeypatch.setattr(custom_provider_module, "validate_outbound_base_url", lambda url: url)
    monkeypatch.setattr(claude_provider_module, "validate_outbound_base_url", lambda url: url)

    provider = custom_provider_module._CustomClaudeProvider(
        {
            "base_url": "https://gateway.invalid/claude",
            "api_key": "key",
            "additional_headers": {"X-Test": "1"},
        }
    )
    provider._build_client()

    _assert_default_timeout(captured["timeout"])
    assert captured["api_key"] == "key"
    assert captured["base_url"] == "https://gateway.invalid/claude"
    assert captured["default_headers"] == {"X-Test": "1"}
