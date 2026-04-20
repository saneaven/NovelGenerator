from __future__ import annotations

import asyncio
import sys
import types
from types import SimpleNamespace

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
        @classmethod
        def from_text(cls, **_kwargs):
            return cls()

        @classmethod
        def from_bytes(cls, **_kwargs):
            return cls()

        @classmethod
        def from_function_response(cls, **_kwargs):
            return cls()

        @classmethod
        def from_function_call(cls, **_kwargs):
            return cls()

        @classmethod
        def model_validate(cls, _payload):
            return cls()

    class _Content:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs

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
        def count_tokens(self, **_kwargs):
            return SimpleNamespace(total_tokens=23)

    class _Client:
        def __init__(self, **_kwargs) -> None:
            self.models = _Models()
            self.closed = False
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
