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


def test_ollama_cloud_task_config_allows_max_thinking_effort() -> None:
    normalized = normalize_task_config(
        "ollama_cloud",
        {
            "provider": "ollama_cloud",
            "model": "glm-5.2:cloud",
            "temperature": 0.2,
            "advanced": {
                "thinking_mode": "model",
                "thinking_config": {"effort": "max"},
            },
        },
    )

    assert normalized["advanced"]["thinking_config"]["effort"] == "max"


def test_ollama_cloud_task_config_defaults_invalid_reasoning_effort() -> None:
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


def test_ollama_cloud_native_request_maps_task_config_and_provider_settings() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    request = provider._prepare_request_body(
        messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
        model="glm-5.2:cloud",
        temperature=0.7,
        tools=[{"name": "lookup", "description": "Lookup", "parameters": {"type": "object"}}],
        max_tokens=128,
        thinking_config={"effort": "max"},
        thinking_mode="model",
        provider_settings={
            "options": {"top_p": 0.9, "think": "ignored", "temperature": 0.3},
            "format": {"type": "object", "properties": {"answer": {"type": "string"}}},
            "keep_alive": "10m",
            "logprobs": True,
            "top_logprobs": 3,
            "custom_fields": {"extra_native": "ok"},
        },
    )

    assert request["model"] == "glm-5.2:cloud"
    assert request["stream"] is True
    assert request["think"] == "max"
    assert request["options"] == {"temperature": 0.3, "num_predict": 128, "top_p": 0.9}
    assert "think" not in request["options"]
    assert request["format"] == {"type": "object", "properties": {"answer": {"type": "string"}}}
    assert request["keep_alive"] == "10m"
    assert request["logprobs"] is True
    assert request["top_logprobs"] == 3
    assert request["extra_native"] == "ok"
    assert request["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "lookup",
                "description": "Lookup",
                "parameters": {"type": "object"},
            },
        }
    ]


@pytest.mark.parametrize("thinking_mode", ["off", "custom"])
def test_ollama_cloud_native_request_disables_thinking(thinking_mode: str) -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    request = provider._prepare_request_body(
        messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
        model="qwen3",
        temperature=0.7,
        tools=None,
        max_tokens=None,
        thinking_config={"effort": "high"},
        thinking_mode=thinking_mode,
        provider_settings=None,
    )

    assert request["think"] is False


def test_ollama_cloud_native_request_maps_all_think_efforts() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    for effort in ("low", "medium", "high", "max"):
        request = provider._prepare_request_body(
            messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
            model="qwen3",
            temperature=0.7,
            tools=None,
            max_tokens=None,
            thinking_config={"effort": effort},
            thinking_mode="model",
            provider_settings=None,
        )
        assert request["think"] == effort


def _persisted_reasoning_text_from_native_chunk(provider: OllamaCloudProvider, chunk: dict[str, Any]) -> str:
    assembler = FallbackSnapshotAssembler(provider="ollama_cloud", model="qwen3")
    for event in provider._events_from_chunk(chunk):
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


def test_ollama_cloud_native_thinking_chunk_is_persistable() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    assert _persisted_reasoning_text_from_native_chunk(
        provider,
        {"message": {"thinking": "checked path ", "content": "answer"}},
    ) == "checked path "


def test_ollama_cloud_reasoning_text_history_serializes_to_ollama_thinking() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    converted = provider._convert_messages(
        [
            {
                "role": "assistant",
                "content_parts": [{"type": "content", "text": "answer"}],
                "reasoning_detail": {
                    "type": "ollama_cloud",
                    "meta": {
                        "provider": "ollama_cloud",
                        "thinking_display": "reasoning_text",
                    },
                    "data": {"reasoning_text": "checked path "},
                    "token_count": 0,
                },
            }
        ]
    )

    assert converted == [
        {
            "role": "assistant",
            "content": "answer",
            "thinking": "checked path ",
        }
    ]


def test_ollama_cloud_reasoning_text_history_ignores_non_ollama_detail() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    converted = provider._convert_messages(
        [
            {
                "role": "assistant",
                "content_parts": [{"type": "content", "text": "answer"}],
                "reasoning_detail": {
                    "type": "nanogpt",
                    "meta": {
                        "provider": "nanogpt",
                        "thinking_display": "reasoning_text",
                    },
                    "data": {"reasoning_text": "not for ollama"},
                    "token_count": 0,
                },
            }
        ]
    )

    assert converted == [
        {
            "role": "assistant",
            "content": "answer",
        }
    ]


def test_ollama_cloud_tool_results_convert_to_native_tool_messages() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})

    converted = provider._convert_messages(
        [
            {
                "role": "tool_results",
                "tool_results": [
                    {
                        "tool_call_id": "call_1",
                        "tool_name": "lookup",
                        "content": "result",
                    }
                ],
            }
        ]
    )

    assert converted == [
        {
            "role": "tool",
            "tool_name": "lookup",
            "content": "result",
            "tool_call_id": "call_1",
        }
    ]


def test_ollama_cloud_native_tool_calls_normalize_to_app_deltas() -> None:
    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    assembler = FallbackSnapshotAssembler(provider="ollama_cloud", model="qwen3")

    for event in provider._events_from_chunk(
        {
            "message": {
                "tool_calls": [
                    {
                        "id": "call_1",
                        "function": {
                            "index": 0,
                            "name": "lookup",
                            "arguments": {"query": "x"},
                        },
                    }
                ]
            }
        }
    ):
        if event.delta is not None:
            assembler.apply_delta(event.delta)

    snapshot = assembler.finalize_or_raise()
    assert len(snapshot.tool_calls) == 1
    assert snapshot.tool_calls[0].id == "call_1"
    assert snapshot.tool_calls[0].tool_name == "lookup"
    assert snapshot.tool_calls[0].arguments == {"query": "x"}


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200, text: str = "") -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeStreamResponse:
    def __init__(self, lines: list[str], status_code: int = 200, text: str = "") -> None:
        self.lines = lines
        self.status_code = status_code
        self.text = text

    async def __aenter__(self) -> "_FakeStreamResponse":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def aiter_lines(self):
        for line in self.lines:
            yield line

    async def aread(self) -> bytes:
        return self.text.encode("utf-8")


class _FakeAsyncClient:
    get_responses: list[_FakeResponse] = []
    post_responses: list[_FakeResponse] = []
    stream_responses: list[_FakeStreamResponse] = []
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

    def stream(self, method: str, url: str, **kwargs: Any) -> _FakeStreamResponse:
        self.requests.append({"method": method, "url": url, **kwargs})
        return self.stream_responses.pop(0)


@pytest.fixture(autouse=True)
def _reset_fake_client() -> None:
    _FakeAsyncClient.get_responses = []
    _FakeAsyncClient.post_responses = []
    _FakeAsyncClient.stream_responses = []
    _FakeAsyncClient.requests = []


def test_ollama_cloud_stream_chat_posts_to_native_api(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    _FakeAsyncClient.stream_responses = [
        _FakeStreamResponse(
            [
                '{"message":{"thinking":"plan "},"done":false}',
                '{"message":{"content":"answer"},"done":false}',
                '{"done":true,"done_reason":"stop","prompt_eval_count":5,"eval_count":7}',
            ]
        )
    ]
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    events = asyncio.run(
        _collect_events(
            provider.stream_chat(
                messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
                model="glm-5.2:cloud",
                temperature=0.7,
                max_tokens=64,
                thinking_config={"effort": "max"},
                thinking_mode="model",
            )
        )
    )

    request = _FakeAsyncClient.requests[0]
    assert request["method"] == "POST"
    assert request["url"] == "https://ollama.com/api/chat"
    assert request["headers"]["Authorization"] == "Bearer ollama-key"
    assert request["json"]["think"] == "max"
    assert request["json"]["options"] == {"temperature": 0.7, "num_predict": 64}
    assert [event.delta.thinking_delta for event in events if event.delta and event.delta.thinking_delta] == ["plan "]
    assert [event.delta.content_delta for event in events if event.delta and event.delta.content_delta] == ["answer"]
    meta_events = [event for event in events if event.meta is not None]
    assert meta_events[-1].meta.usage == {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12}
    assert meta_events[-1].meta.finish_reason == "stop"
    assert meta_events[-1].raw_response == {
        "chunks": [
            {"message": {"thinking": "plan "}, "done": False},
            {"message": {"content": "answer"}, "done": False},
            {"done": True, "done_reason": "stop", "prompt_eval_count": 5, "eval_count": 7},
        ]
    }


def test_ollama_cloud_stream_chat_parses_custom_thinking_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    _FakeAsyncClient.stream_responses = [
        _FakeStreamResponse(
            [
                '{"message":{"content":"<thinking>plan</thinking>answer"},"done":false}',
                '{"done":true,"done_reason":"stop"}',
            ]
        )
    ]
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    events = asyncio.run(
        _collect_events(
            provider.stream_chat(
                messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
                model="qwen3",
                thinking_config={"effort": "max"},
                thinking_mode="custom",
            )
        )
    )

    assert _FakeAsyncClient.requests[0]["json"]["think"] is False
    assert [event.delta.thinking_delta for event in events if event.delta and event.delta.thinking_delta] == ["plan"]
    assert [event.delta.content_delta for event in events if event.delta and event.delta.content_delta] == ["answer"]


def test_ollama_cloud_stream_chat_parses_native_tool_call_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    _FakeAsyncClient.stream_responses = [
        _FakeStreamResponse(
            [
                '{"message":{"content":"<tool_call>{\\"tool\\":\\"lookup\\",\\"query\\":\\"x\\"}</tool_call>"},"done":false}',
                '{"done":true,"done_reason":"stop"}',
            ]
        )
    ]
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    provider = OllamaCloudProvider({"api_key": "ollama-key"})
    events = asyncio.run(
        _collect_events(
            provider.stream_chat(
                messages=[{"role": "user", "content_parts": [{"type": "content", "text": "hello"}]}],
                model="qwen3",
                thinking_mode="off",
                native_tool_call=True,
            )
        )
    )

    assembler = FallbackSnapshotAssembler(provider="ollama_cloud", model="qwen3")
    for event in events:
        if event.delta is not None:
            assembler.apply_delta(event.delta)
    snapshot = assembler.finalize_or_raise()

    assert [event.delta.content_delta for event in events if event.delta and event.delta.content_delta] == []
    assert len(snapshot.tool_calls) == 1
    assert snapshot.tool_calls[0].tool_name == "lookup"
    assert snapshot.tool_calls[0].arguments == {"query": "x"}
    assert any(event.meta and event.meta.finish_reason == "tool_calls" for event in events)


async def _collect_events(stream) -> list[Any]:
    events = []
    async for event in stream:
        events.append(event)
    return events


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
