from __future__ import annotations

import asyncio
import sys
import types
from types import SimpleNamespace

import pytest

if "anthropic" not in sys.modules:
    fake_anthropic = types.ModuleType("anthropic")
    fake_anthropic.AsyncAnthropic = object
    sys.modules["anthropic"] = fake_anthropic

google_module = sys.modules.setdefault("google", types.ModuleType("google"))
if "google.genai" not in sys.modules:
    fake_genai = types.ModuleType("google.genai")
    fake_errors = types.ModuleType("google.genai.errors")
    fake_types = types.ModuleType("google.genai.types")

    class _HttpOptions:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

    class _Part:
        def __init__(self, **kwargs) -> None:
            self.__dict__.update(kwargs)

        @classmethod
        def from_text(cls, **kwargs):
            return cls(**kwargs)

        @classmethod
        def from_bytes(cls, **kwargs):
            return cls(**kwargs)

        @classmethod
        def from_function_response(cls, **kwargs):
            return cls(**kwargs)

        @classmethod
        def from_function_call(cls, **kwargs):
            return cls(**kwargs)

        @classmethod
        def model_validate(cls, payload):
            return cls(**payload)

    class _Content:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs
            self.__dict__.update(kwargs)

    class _CountTokensConfig:
        def __init__(self, **kwargs) -> None:
            self.__dict__.update(kwargs)

    class _FunctionCallingConfigMode:
        AUTO = "AUTO"
        ANY = "ANY"
        NONE = "NONE"

    class _GenerateContentConfig:
        @classmethod
        def model_validate(cls, _payload):
            return cls()

    fake_genai.Client = object
    fake_errors.APIError = Exception
    fake_genai.errors = fake_errors
    fake_types.HttpOptions = _HttpOptions
    fake_types.Part = _Part
    fake_types.Content = _Content
    fake_types.CountTokensConfig = _CountTokensConfig
    fake_types.FunctionCallingConfigMode = _FunctionCallingConfigMode
    fake_types.FunctionDeclaration = object
    fake_types.Tool = object
    fake_types.GenerateContentConfig = _GenerateContentConfig
    fake_genai.types = fake_types
    google_module.genai = fake_genai
    sys.modules["google.genai"] = fake_genai
    sys.modules["google.genai.errors"] = fake_errors
    sys.modules["google.genai.types"] = fake_types

from App.backend.services import token_counting_service as token_service


def test_claude_token_counting_closes_client(monkeypatch) -> None:
    instances: list[object] = []

    class _Messages:
        async def count_tokens(self, **_kwargs):
            return SimpleNamespace(input_tokens=17)

    class _Client:
        def __init__(self, **_kwargs) -> None:
            self.messages = _Messages()
            self.closed = False
            instances.append(self)

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr(token_service, "AsyncAnthropic", _Client)

    result = asyncio.run(
        token_service.count_tokens_claude(
            text="hello",
            model="claude-test",
            api_key="key",
        )
    )

    assert result == 17
    assert len(instances) == 1
    assert instances[0].closed is True


def test_gemini_token_counting_closes_client(monkeypatch) -> None:
    instances: list[object] = []

    class _Models:
        async def count_tokens(self, **_kwargs):
            return SimpleNamespace(total_tokens=23)

    class _AsyncClient:
        def __init__(self) -> None:
            self.models = _Models()
            self.closed = False

        async def aclose(self) -> None:
            self.closed = True

    class _Client:
        def __init__(self, **_kwargs) -> None:
            self.aio = _AsyncClient()
            self.closed = False
            self.options = _kwargs
            instances.append(self)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(token_service.genai, "Client", _Client)

    result = asyncio.run(
        token_service.count_tokens_gemini(
            text="hello",
            model="gemini-test",
            api_key="key",
        )
    )

    assert result == 23
    assert len(instances) == 1
    assert instances[0].closed is True
    assert instances[0].aio.closed is True
    assert instances[0].options["enterprise"] is False


@pytest.mark.parametrize("outcome", ["success", "error", "cancel"])
def test_vertex_token_counting_uses_provider_and_closes_client(monkeypatch, outcome) -> None:
    captured: dict[str, object] = {}

    class _Models:
        async def count_tokens(self, **kwargs):
            captured["request"] = kwargs
            if outcome == "error":
                raise RuntimeError("count failed")
            if outcome == "cancel":
                raise asyncio.CancelledError()
            return SimpleNamespace(total_tokens=29)

    class _Provider:
        def __init__(self) -> None:
            self.client = SimpleNamespace(aio=SimpleNamespace(models=_Models()))
            self.closed = False

        def validate_config(self) -> bool:
            return True

        def _ensure_client(self):
            return self.client

        async def aclose(self) -> None:
            self.closed = True

    runtime = _Provider()
    provider_config = {
        "project_id": "my-project",
        "location": "global",
        "service_account_json": {"type": "service_account"},
    }

    def _create_provider(provider, config):
        captured["provider"] = provider
        captured["provider_config"] = config
        return runtime

    def _unexpected_gemini_client(**_kwargs):
        raise AssertionError("Vertex counting must use its authenticated provider client")

    monkeypatch.setattr(token_service, "create_llm_provider", _create_provider)
    monkeypatch.setattr(token_service.genai, "Client", _unexpected_gemini_client)
    config = SimpleNamespace(system_instruction="system prompt")
    request = token_service.count_tokens_gemini_contents(
        ["hello"],
        model="gemini-test",
        config=config,
        provider="vertex",
        provider_config=provider_config,
    )

    if outcome == "success":
        assert asyncio.run(request) == 29
    else:
        expected_error = asyncio.CancelledError if outcome == "cancel" else RuntimeError
        with pytest.raises(expected_error):
            asyncio.run(request)

    assert captured["provider"] == "vertex"
    assert captured["provider_config"] == provider_config
    assert captured["request"] == {"model": "gemini-test", "contents": ["hello"], "config": config}
    assert runtime.closed is True


@pytest.mark.parametrize("outcome", ["error", "cancel"])
def test_gemini_token_counting_closes_both_transports_on_failure(monkeypatch, outcome) -> None:
    closed: list[str] = []

    class _Models:
        async def count_tokens(self, **_kwargs):
            if outcome == "cancel":
                raise asyncio.CancelledError()
            raise RuntimeError("count failed")

    class _AsyncClient:
        models = _Models()

        async def aclose(self) -> None:
            closed.append("async")

    class _Client:
        aio = _AsyncClient()

        def close(self) -> None:
            closed.append("sync")

    monkeypatch.setattr(token_service.genai, "Client", lambda **_kwargs: _Client())
    expected_error = asyncio.CancelledError if outcome == "cancel" else RuntimeError
    with pytest.raises(expected_error):
        asyncio.run(token_service.count_tokens_gemini("hello", "gemini-test", "key"))
    assert closed == ["async", "sync"]
