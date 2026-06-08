from __future__ import annotations

import asyncio
import sys
import types
from typing import Any

import pytest
from sqlalchemy.orm import declarative_base

if "openai" not in sys.modules:
    fake_openai = types.ModuleType("openai")

    class _StubAsyncOpenAI:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.args = args
            self.kwargs = kwargs

    class _StubOpenAIError(Exception):
        pass

    fake_openai.AsyncOpenAI = _StubAsyncOpenAI
    fake_openai.OpenAIError = _StubOpenAIError
    fake_openai.APIConnectionError = _StubOpenAIError
    fake_openai.APIStatusError = _StubOpenAIError
    fake_openai.AuthenticationError = _StubOpenAIError
    fake_openai.BadRequestError = _StubOpenAIError
    fake_openai.RateLimitError = _StubOpenAIError
    sys.modules["openai"] = fake_openai

if "httpx" not in sys.modules:
    fake_httpx = types.ModuleType("httpx")

    class _StubTimeout:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.args = args
            self.kwargs = kwargs

    class _StubAsyncClient:
        pass

    fake_httpx.Timeout = _StubTimeout
    fake_httpx.AsyncClient = _StubAsyncClient
    sys.modules["httpx"] = fake_httpx

if "App.backend.database" not in sys.modules:
    fake_database = types.ModuleType("App.backend.database")
    fake_database.Base = declarative_base()
    fake_database.SessionLocal = lambda: None
    fake_database.get_db = lambda: None
    sys.modules["App.backend.database"] = fake_database
    sys.modules["database"] = fake_database

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

from App.backend.providers.ollama_cloud.embedding import embed_many, list_models
from App.backend.providers.ollama_cloud.llm import OllamaCloudProvider
from App.backend.providers.registry import list_specs, normalize_credentials, normalize_task_config
from App.backend.providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.reasoning.normalize import normalize_reasoning_detail


def test_ollama_cloud_provider_is_registered_and_projects_specs() -> None:
    specs = {spec.id: spec for spec in list_specs()}

    spec = specs["ollama_cloud"]

    assert spec.llm is not None
    assert spec.embedding is not None
    assert spec.ui.display_name_key == "settings.credentials.ollamaCloud.title"
    assert spec.ui.model_browser_grouping_llm == "ollama_tag_family"
    assert spec.ui.model_browser_grouping_embedding == "ollama_tag_family"


def test_ollama_cloud_credentials_normalize_to_api_key_only() -> None:
    normalized = normalize_credentials(
        "ollama_cloud",
        {
            "api_key": "  ollama-key  ",
            "ignored": "value",
        },
    )

    assert normalized == {"api_key": "  ollama-key  "}


def test_ollama_cloud_task_config_limits_reasoning_effort() -> None:
    normalized = normalize_task_config(
        "ollama_cloud",
        {
            "provider": "ollama_cloud",
            "model": "qwen3",
            "temperature": 0.2,
            "advanced": {
                "thinking_mode": "model",
                "thinking_config": {"effort": "xhigh"},
            },
        },
    )

    assert normalized["advanced"]["thinking_config"]["effort"] == "medium"


def test_ollama_cloud_request_uses_openai_base_url_and_reasoning_effort() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content": "hello"}],
        model="qwen3",
        temperature=0.7,
        tools=[{"name": "lookup", "parameters": {"type": "object"}}],
        tool_choice=None,
        max_tokens=128,
        provider_preference=None,
        thinking_config={"effort": "high"},
        thinking_mode="model",
        provider_settings=None,
    )

    assert provider.base_url == "https://ollama.com/v1"
    assert request["extra_body"] == {"reasoning_effort": "high"}
    assert request["tools"] == [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}]


def test_ollama_cloud_request_disables_native_reasoning_when_off() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content": "hello"}],
        model="qwen3",
        temperature=0.7,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        provider_preference=None,
        thinking_config={"effort": "high"},
        thinking_mode="off",
        provider_settings=None,
    )

    assert request["extra_body"] == {"reasoning_effort": "none"}


def test_ollama_cloud_request_disables_native_reasoning_for_custom_thinking() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    request = provider._prepare_request_kwargs(
        messages=[{"role": "user", "content": "hello"}],
        model="qwen3",
        temperature=0.7,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        provider_preference=None,
        thinking_config={"effort": "high"},
        thinking_mode="custom",
        provider_settings=None,
    )

    assert request["extra_body"] == {"reasoning_effort": "none"}


def _persisted_reasoning_text_from_chunk(provider: OllamaCloudProvider, chunk: dict[str, Any]) -> str:
    assembler = FallbackSnapshotAssembler(provider="ollama_cloud", model="qwen3")
    for event in provider._chunk_to_events(chunk):
        if event.kind == "delta" and event.delta is not None:
            assembler.apply_delta(event.delta)

    snapshot = assembler.finalize_or_raise()
    reasoning = normalize_reasoning_detail(provider.read_reasoning_detail(snapshot, {"thinking_mode": "model"}))

    assert reasoning is not None
    assert reasoning["type"] == "ollama_cloud"
    assert reasoning["meta"] == {
        "provider": "ollama_cloud",
        "thinking_display": "reasoning_text",
    }
    return reasoning["data"]["reasoning_text"]


def test_ollama_cloud_string_thinking_delta_is_normalized_and_persisted() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    chunk, extra = provider._mutate_chunk(
        {"choices": [{"delta": {"thinking": "checked path ", "content": "answer"}}]},
        "model",
    )
    assert extra == []

    assert _persisted_reasoning_text_from_chunk(provider, chunk) == "checked path "


def test_ollama_cloud_reasoning_delta_is_normalized_and_persisted() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    chunk, extra = provider._mutate_chunk(
        {"choices": [{"delta": {"reasoning": "checked route ", "content": "answer"}}]},
        "model",
    )
    assert extra == []

    assert _persisted_reasoning_text_from_chunk(provider, chunk) == "checked route "


def test_ollama_cloud_reasoning_delta_does_not_override_existing_thinking() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    chunk, extra = provider._mutate_chunk(
        {"choices": [{"delta": {"reasoning": "ignored ", "thinking": "kept ", "content": "answer"}}]},
        "model",
    )
    assert extra == []

    assert _persisted_reasoning_text_from_chunk(provider, chunk) == "kept "


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200, text: str = "") -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    get_responses: list[_FakeResponse] = []
    post_responses: list[_FakeResponse] = []
    requests: list[dict[str, Any]] = []

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.requests.append({"method": "GET", "url": url, **kwargs})
        return self.get_responses.pop(0)

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.requests.append({"method": "POST", "url": url, **kwargs})
        return self.post_responses.pop(0)


@pytest.fixture(autouse=True)
def _reset_fake_client() -> None:
    _FakeAsyncClient.get_responses = []
    _FakeAsyncClient.post_responses = []
    _FakeAsyncClient.requests = []


def test_ollama_cloud_models_use_api_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    _FakeAsyncClient.get_responses = [
        _FakeResponse({"models": [{"model": "qwen3", "name": "ignored"}, {"name": "llama3.2"}]})
    ]
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    result = asyncio.run(list_models(provider_config={"api_key": "ollama-key"}, runtime_spec=None))

    assert [item["id"] for item in result["data"]] == ["qwen3", "llama3.2"]
    assert _FakeAsyncClient.requests[0]["url"] == "https://ollama.com/api/tags"
    assert _FakeAsyncClient.requests[0]["headers"]["Authorization"] == "Bearer ollama-key"


def test_ollama_cloud_embed_many_posts_to_api_embed(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    _FakeAsyncClient.post_responses = [_FakeResponse({"embeddings": [[1, 2], [3.5, 4.5]]})]
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    result = asyncio.run(
        embed_many(
            provider_config={"api_key": "ollama-key"},
            model="embed-model",
            inputs=["a", "b"],
            dimensions=256,
            purpose="search",
            timeout_s=12.0,
            runtime_spec=None,
        )
    )

    assert result == [[1.0, 2.0], [3.5, 4.5]]
    request = _FakeAsyncClient.requests[0]
    assert request["url"] == "https://ollama.com/api/embed"
    assert request["json"] == {"model": "embed-model", "input": ["a", "b"], "dimensions": 256}


def test_ollama_cloud_embed_many_rejects_size_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    _FakeAsyncClient.post_responses = [_FakeResponse({"embeddings": [[1, 2]]})]
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    with pytest.raises(RuntimeError, match="Embedding response size mismatch"):
        asyncio.run(
            embed_many(
                provider_config={"api_key": "ollama-key"},
                model="embed-model",
                inputs=["a", "b"],
                dimensions=None,
                purpose="search",
                timeout_s=12.0,
                runtime_spec=None,
            )
        )
