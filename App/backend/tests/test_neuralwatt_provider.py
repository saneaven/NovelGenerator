from __future__ import annotations

import asyncio
import copy
import inspect
from types import SimpleNamespace
from typing import Any

import pytest

from App.backend.providers.neuralwatt.llm import NeuralwattProvider
from App.backend.providers.neuralwatt import llm as neuralwatt_llm
from App.backend.providers.registry import list_specs, normalize_credentials, normalize_task_config
from App.backend.providers.shared.async_openai_provider import AsyncOpenAIProvider
from App.backend.providers.shared.parsing.fallback_snapshot_assembler import FallbackSnapshotAssembler
from App.backend.services.reasoning.normalize import normalize_reasoning_detail


def _iter_schema_conditions(node: Any):
    yield from getattr(node, "when", ())
    yield from getattr(node, "disabled_when", ())
    fields = getattr(node, "fields", None)
    if isinstance(fields, dict):
        for child in fields.values():
            yield from _iter_schema_conditions(child)


def test_neuralwatt_provider_is_registered_as_llm_only() -> None:
    specs = {spec.id: spec for spec in list_specs()}

    spec = specs["neuralwatt"]

    assert spec.llm is not None
    assert spec.embedding is None
    assert spec.image is None
    assert spec.llm.supports_tools is True
    assert spec.llm.supports_thinking is True
    assert spec.ui.display_name_key == "settings.credentials.neuralwatt.title"
    assert spec.ui.description_key == "settings.taskConfig.providerDescriptions.neuralwatt"
    assert spec.ui.icon_key == "neuralwatt"
    assert spec.ui.llm_order == 65
    assert spec.ui.model_browser_grouping_llm == "flat"
    assert spec.ui.llm_show_pricing is True


def test_neuralwatt_credentials_are_api_key_only() -> None:
    specs = {spec.id: spec for spec in list_specs()}
    credential = specs["neuralwatt"].credentials.fields["api_key"]

    assert set(specs["neuralwatt"].credentials.fields) == {"api_key"}
    assert credential.required is True
    assert credential.ui is not None
    assert credential.ui.widget == "password"
    assert credential.ui.link_url == "https://portal.neuralwatt.com/"

    assert normalize_credentials(
        "neuralwatt",
        {"api_key": "  neuralwatt-key  ", "ignored": "value"},
    ) == {"api_key": "  neuralwatt-key  "}
    assert NeuralwattProvider({"api_key": "   "}).validate_config() is False


def test_neuralwatt_task_config_supports_all_existing_reasoning_efforts_and_flex() -> None:
    spec = next(spec for spec in list_specs() if spec.id == "neuralwatt")
    thinking_config = spec.llm.common_task_config.fields["advanced"].fields["thinking_config"]
    assert thinking_config.fields["effort"].default.__class__.__name__ == "_Missing"

    for effort in ("none", "minimal", "low", "medium", "high", "xhigh", "max"):
        normalized = normalize_task_config(
            "neuralwatt",
            {
                "provider": "neuralwatt",
                "model": "any-model-id",
                "temperature": 0.2,
                "advanced": {
                    "tokenizer_override": "claude",
                    "thinking_mode": "model",
                    "thinking_config": {"effort": effort, "max_tokens": 4096},
                    "provider_settings": {"service_tier": "flex"},
                },
            },
        )

        assert normalized["advanced"]["thinking_config"] == {
            "effort": effort,
            "max_tokens": 4096,
        }
        assert normalized["advanced"]["provider_settings"] == {"service_tier": "flex"}
        assert normalized["advanced"]["tokenizer_override"] == "claude"


def test_neuralwatt_spec_has_no_model_dependent_conditions_or_flags() -> None:
    spec = next(spec for spec in list_specs() if spec.id == "neuralwatt")

    assert spec.llm is not None
    conditions = list(_iter_schema_conditions(spec.llm.common_task_config))
    assert all(condition.path not in {"model", "advanced.model"} for condition in conditions)
    assert all(flag.source_path not in {"model", "advanced.model"} for flag in spec.llm.derived_flags)
    provider_source = inspect.getsource(neuralwatt_llm)
    assert "import re" not in provider_source
    assert "re.compile" not in provider_source


def test_neuralwatt_uses_openai_compatible_client_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class _FakeAsyncOpenAI:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    monkeypatch.setitem(AsyncOpenAIProvider._build_client.__globals__, "AsyncOpenAI", _FakeAsyncOpenAI)
    monkeypatch.setitem(
        AsyncOpenAIProvider._build_client.__globals__,
        "get_llm_stream_timeout",
        lambda: "test-timeout",
    )

    provider = NeuralwattProvider({"api_key": "neuralwatt-key"})

    assert provider.name == "neuralwatt"
    assert provider.display_name == "Neuralwatt"
    assert provider.base_url == "https://api.neuralwatt.com/v1"
    assert provider.validate_config() is True
    assert captured["api_key"] == "neuralwatt-key"
    assert captured["base_url"] == "https://api.neuralwatt.com/v1"


class _FakeModel:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def model_dump(self) -> dict[str, Any]:
        return self._payload


class _FakeModelsAPI:
    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self.payloads = payloads
        self.calls = 0

    async def list(self) -> SimpleNamespace:
        self.calls += 1
        return SimpleNamespace(data=[_FakeModel(payload) for payload in self.payloads])


class _FakeModelsClient:
    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self.models = _FakeModelsAPI(payloads)


def test_neuralwatt_models_project_nested_metadata_without_losing_it() -> None:
    metadata = {
        "display_name": "Private Reasoning Vision Model",
        "description": "Account-specific model",
        "provider": "Example Lab",
        "capabilities": {
            "vision": True,
            "reasoning": False,
            "reasoning_effort": False,
            "tools": True,
        },
        "limits": {
            "max_context_length": 131072,
            "max_output_tokens": 16384,
        },
        "pricing": {
            "input_per_million": "0.25",
            "output_per_million": 1.5,
            "cached_input_per_million": "0.05",
            "pricing_tbd": False,
        },
        "deprecated": True,
    }
    provider = NeuralwattProvider({})
    provider._client = _FakeModelsClient(
        [
            {
                "id": "private/model-alpha",
                "owned_by": "neuralwatt",
                "max_model_len": 65536,
                "metadata": metadata,
            }
        ]
    )

    result = asyncio.run(provider.get_models())

    assert provider._client.models.calls == 1
    assert len(result["data"]) == 1
    model = result["data"][0]
    assert model["id"] == "private/model-alpha"
    assert model["display_name"] == "Private Reasoning Vision Model"
    assert model["description"] == "Account-specific model"
    assert model["category"] == "Example Lab"
    assert model["context_length"] == 131072
    assert model["max_output_tokens"] == 16384
    assert model["capabilities"] == metadata["capabilities"]
    assert model["pricing"] == {
        "input_per_million": "0.25",
        "output_per_million": 1.5,
    }
    assert model["pricing_display"] == {
        "prompt_per_1m": 0.25,
        "completion_per_1m": 1.5,
    }
    assert model["input_modalities"] == ["text", "image"]
    assert model["metadata"] == metadata
    assert model["metadata"]["pricing"]["cached_input_per_million"] == "0.05"
    assert model["metadata"]["pricing"]["pricing_tbd"] is False
    assert model["metadata"]["deprecated"] is True


def test_neuralwatt_models_fall_back_to_max_model_len_and_project_nonvision() -> None:
    provider = NeuralwattProvider({})
    provider._client = _FakeModelsClient(
        [
            {
                "id": "plain-model",
                "max_model_len": 32768,
                "metadata": {
                    "capabilities": {"vision": False},
                    "limits": {"max_output_tokens": 2048},
                },
            }
        ]
    )

    model = asyncio.run(provider.get_models())["data"][0]

    assert model["context_length"] == 32768
    assert model["max_output_tokens"] == 2048
    assert model["input_modalities"] == ["text"]


def test_neuralwatt_models_fall_back_to_max_model_len_without_metadata() -> None:
    provider = NeuralwattProvider({})
    provider._client = _FakeModelsClient(
        [{"id": "minimal-model", "max_model_len": 16384}]
    )

    model = asyncio.run(provider.get_models())["data"][0]

    assert model["context_length"] == 16384
    assert "metadata" not in model


def test_neuralwatt_pricing_tbd_and_cache_prices_stay_in_metadata_only() -> None:
    metadata = {
        "pricing": {
            "input_per_million": "1.0",
            "output_per_million": "2.0",
            "cached_input_per_million": "0.1",
            "pricing_tbd": True,
        }
    }
    provider = NeuralwattProvider({})
    provider._client = _FakeModelsClient(
        [{"id": "tbd-model", "metadata": metadata}]
    )

    model = asyncio.run(provider.get_models())["data"][0]

    assert model["pricing"] == {
        "input_per_million": "1.0",
        "output_per_million": "2.0",
    }
    assert "pricing_display" not in model
    assert "cached_input_per_million" not in model["pricing"]
    assert "pricing_tbd" not in model["pricing"]
    assert model["metadata"] == metadata


@pytest.mark.parametrize("thinking_mode", ["off", "custom"])
def test_neuralwatt_off_and_custom_modes_disable_native_thinking(thinking_mode: str) -> None:
    provider = NeuralwattProvider({})

    assert provider._build_extra_body(
        None,
        {"effort": "max", "max_tokens": 4096},
        "arbitrary-model",
        thinking_mode=thinking_mode,
        provider_settings=None,
    ) == {"chat_template_kwargs": {"enable_thinking": False}}


@pytest.mark.parametrize("effort", ["none", "minimal", "low", "medium", "high", "xhigh", "max"])
def test_neuralwatt_model_mode_maps_all_existing_reasoning_efforts(effort: str) -> None:
    provider = NeuralwattProvider({})

    assert provider._build_extra_body(
        None,
        {"effort": effort, "max_tokens": 8192},
        "arbitrary-model",
        thinking_mode="model",
        provider_settings=None,
    ) == {
        "reasoning_effort": effort,
        "thinking_token_budget": 8192,
    }


def test_neuralwatt_model_mode_omits_unset_reasoning_options() -> None:
    provider = NeuralwattProvider({})

    assert provider._build_extra_body(
        None,
        None,
        "arbitrary-model",
        thinking_mode="model",
        provider_settings=None,
    ) is None

    assert provider._build_extra_body(
        None,
        {"effort": "low"},
        "arbitrary-model",
        thinking_mode="model",
        provider_settings=None,
    ) == {"reasoning_effort": "low"}
    assert provider._build_extra_body(
        None,
        {"max_tokens": 2048},
        "arbitrary-model",
        thinking_mode="model",
        provider_settings=None,
    ) == {"thinking_token_budget": 2048}


def test_neuralwatt_reasoning_request_is_identical_for_arbitrary_model_ids() -> None:
    provider = NeuralwattProvider({})

    bodies = [
        provider._build_extra_body(
            {"only": ["must-be-ignored"]},
            {"effort": "high", "max_tokens": 4096},
            model_id,
            thinking_mode="model",
            provider_settings={"service_tier": "flex"},
        )
        for model_id in ("glm-anything", "vendor/vision-model", "manual-unknown-id")
    ]

    assert bodies == [
        {"reasoning_effort": "high", "thinking_token_budget": 4096},
        {"reasoning_effort": "high", "thinking_token_budget": 4096},
        {"reasoning_effort": "high", "thinking_token_budget": 4096},
    ]


def test_neuralwatt_reasoning_request_ignores_catalog_capability_values() -> None:
    provider = NeuralwattProvider({})
    provider._client = _FakeModelsClient(
        [
            {
                "id": "capability-false-model",
                "metadata": {
                    "capabilities": {
                        "reasoning": False,
                        "reasoning_effort": False,
                    }
                },
            }
        ]
    )

    model = asyncio.run(provider.get_models())["data"][0]
    body = provider._build_extra_body(
        None,
        {"effort": "high", "max_tokens": 4096},
        model["id"],
        thinking_mode="model",
        provider_settings=None,
    )

    assert model["capabilities"]["reasoning"] is False
    assert body == {
        "reasoning_effort": "high",
        "thinking_token_budget": 4096,
    }


def test_neuralwatt_request_uses_inherited_service_tier_mapping() -> None:
    provider = NeuralwattProvider({})
    base_args = {
        "messages": [{"role": "user", "content": "hello"}],
        "model": "manual-model",
        "temperature": 0.7,
        "tools": None,
        "tool_choice": None,
        "max_tokens": None,
        "provider_preference": None,
        "thinking_config": None,
        "thinking_mode": "model",
    }

    default_request = provider._prepare_request_kwargs(
        **base_args,
        provider_settings={"service_tier": "default"},
    )
    flex_request = provider._prepare_request_kwargs(
        **base_args,
        provider_settings={"service_tier": "flex"},
    )

    assert "service_tier" not in default_request
    assert flex_request["service_tier"] == "flex"


class _FakeStreamChunk:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def model_dump(self, *, exclude_none: bool = False) -> dict[str, Any]:
        del exclude_none
        return copy.deepcopy(self.payload)


class _FakeChatStream:
    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self.chunks = [_FakeStreamChunk(payload) for payload in payloads]
        self.closed = False

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for chunk in self.chunks:
            yield chunk

    async def close(self) -> None:
        self.closed = True


class _FakeChatCompletions:
    def __init__(self, stream: _FakeChatStream) -> None:
        self.stream = stream
        self.request: dict[str, Any] | None = None

    async def create(self, **kwargs: Any) -> _FakeChatStream:
        self.request = kwargs
        return self.stream


class _FakeChatClient:
    def __init__(self, stream: _FakeChatStream) -> None:
        self.chat = SimpleNamespace(completions=_FakeChatCompletions(stream))


def test_neuralwatt_inherited_stream_maps_tools_reasoning_usage_and_cache() -> None:
    tool_call = {
        "index": 0,
        "id": "call_1",
        "type": "function",
        "function": {"name": "lookup", "arguments": '{"query":"x"}'},
    }
    stream = _FakeChatStream(
        [
            {
                "choices": [
                    {
                        "delta": {
                            "content": "answer",
                            "reasoning_content": "reason",
                            "tool_calls": [tool_call],
                        }
                    }
                ]
            },
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                    "prompt_tokens_details": {"cached_tokens": 4},
                    "completion_tokens_details": {"reasoning_tokens": 3},
                },
            },
        ]
    )
    client = _FakeChatClient(stream)
    provider = NeuralwattProvider({})
    provider.config["api_key"] = "neuralwatt-key"
    provider._client = client

    async def _collect_events():
        return [
            event
            async for event in provider.stream_chat(
                messages=[
                    {
                        "role": "user",
                        "content_parts": [{"type": "content", "text": "hello"}],
                    }
                ],
                model="arbitrary-model",
                tools=[
                    {
                        "name": "lookup",
                        "description": "Look something up",
                        "parameters": {"type": "object", "properties": {}},
                    }
                ],
                thinking_mode="model",
                thinking_config={"effort": "high", "max_tokens": 4096},
                provider_settings={"service_tier": "flex"},
            )
        ]

    events = asyncio.run(_collect_events())

    request = client.chat.completions.request
    assert request is not None
    assert request["messages"] == [{"role": "user", "content": "hello"}]
    assert request["tools"] == [{"type": "function", "function": {
        "name": "lookup",
        "description": "Look something up",
        "parameters": {"type": "object", "properties": {}},
    }}]
    assert request["extra_body"] == {
        "reasoning_effort": "high",
        "thinking_token_budget": 4096,
    }
    assert request["service_tier"] == "flex"

    delta = next(event.delta for event in events if event.delta is not None)
    assert delta.content_delta == "answer"
    assert delta.thinking_delta == "reason"
    assert delta.tool_call_deltas == [tool_call]

    final_meta = next(
        event.meta
        for event in events
        if event.meta is not None and event.meta.reasoning_tokens is not None
    )
    assert final_meta.usage == {
        "prompt_tokens": 10,
        "completion_tokens": 5,
        "total_tokens": 15,
    }
    assert final_meta.reasoning_tokens == 3
    assert final_meta.cache_metrics == {"cached_tokens": 4}
    assert stream.closed is True


def _reasoning_detail_from_chunk(
    provider: NeuralwattProvider,
    chunk: dict[str, Any],
    *,
    thinking_mode: str = "model",
) -> dict[str, Any] | None:
    assembler = FallbackSnapshotAssembler(provider="neuralwatt", model="any-model")
    mutated, extra_chunks = provider._mutate_chunk(chunk, thinking_mode)
    for item in ([mutated] if mutated is not None else []) + extra_chunks:
        for event in provider._chunk_to_events(item):
            if event.delta is not None:
                assembler.apply_delta(event.delta)
            if event.meta is not None:
                assembler.apply_meta(event.meta)

    snapshot = assembler.finalize_or_raise()
    return normalize_reasoning_detail(
        provider.read_reasoning_detail(snapshot, {"thinking_mode": thinking_mode})
    )


@pytest.mark.parametrize(
    ("delta", "expected"),
    [
        ({"reasoning": "native reasoning"}, "native reasoning"),
        ({"reasoning_content": "legacy reasoning"}, "legacy reasoning"),
        ({"reasoning": {"text": "object reasoning"}}, "object reasoning"),
        (
            {"reasoning_content": "first ", "reasoning": {"text": "second"}},
            "first second",
        ),
    ],
)
def test_neuralwatt_reasoning_chunks_normalize_and_persist(
    delta: dict[str, Any],
    expected: str,
) -> None:
    provider = NeuralwattProvider({})
    delta = {**delta, "content": "answer"}

    reasoning_detail = _reasoning_detail_from_chunk(
        provider,
        {"choices": [{"delta": delta}]},
    )

    assert reasoning_detail == {
        "type": "neuralwatt",
        "meta": {
            "provider": "neuralwatt",
            "thinking_display": "reasoning",
        },
        "data": {
            "reasoning_details": [],
            "reasoning": expected,
        },
        "token_count": 0,
    }


def test_neuralwatt_reasoning_is_not_exposed_outside_model_mode() -> None:
    provider = NeuralwattProvider({})

    reasoning_detail = _reasoning_detail_from_chunk(
        provider,
        {"choices": [{"delta": {"reasoning": "hidden", "content": "answer"}}]},
        thinking_mode="off",
    )

    assert reasoning_detail is None


def test_neuralwatt_choice_level_reasoning_details_are_preserved() -> None:
    provider = NeuralwattProvider({})
    details = [{"format": "native", "encrypted_content": "enc_123"}]

    reasoning_detail = _reasoning_detail_from_chunk(
        provider,
        {
            "choices": [
                {
                    "delta": {"reasoning": "reason", "content": "answer"},
                    "reasoning_details": details,
                }
            ]
        },
    )

    assert reasoning_detail is not None
    assert reasoning_detail["data"]["reasoning"] == "reason"
    assert reasoning_detail["data"]["reasoning_details"] == details


def test_neuralwatt_reasoning_history_returns_to_assistant_message() -> None:
    provider = NeuralwattProvider({})

    converted = provider._convert_messages(
        [
            {
                "role": "assistant",
                "content_parts": [{"type": "content", "text": "answer"}],
                "reasoning_detail": {
                    "type": "neuralwatt",
                    "meta": {"provider": "neuralwatt"},
                    "data": {
                        "reasoning": "stored reasoning",
                        "reasoning_details": [
                            {"format": "native", "encrypted_content": "enc_123"}
                        ],
                    },
                    "token_count": 0,
                },
            }
        ]
    )

    assert converted == [
        {
            "role": "assistant",
            "content": "answer",
            "reasoning": "stored reasoning",
            "reasoning_details": [
                {"format": "native", "encrypted_content": "enc_123"}
            ],
        }
    ]


def test_neuralwatt_inherits_tool_result_message_conversion() -> None:
    provider = NeuralwattProvider({})

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
            "tool_call_id": "call_1",
            "content": "result",
            "name": "lookup",
        }
    ]


def test_neuralwatt_inherits_assistant_tool_call_history_conversion() -> None:
    provider = NeuralwattProvider({})
    tool_calls = [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "lookup", "arguments": '{"query":"x"}'},
        }
    ]

    converted = provider._convert_messages(
        [
            {
                "role": "assistant",
                "content_parts": [{"type": "content", "text": "checking"}],
                "tool_calls": tool_calls,
            }
        ]
    )

    assert converted == [
        {
            "role": "assistant",
            "content": "checking",
            "tool_calls": tool_calls,
        }
    ]


def test_neuralwatt_inherits_image_message_conversion(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = NeuralwattProvider({})
    build_content = provider._convert_messages.__func__.__globals__["build_openai_chat_content"]
    attachment_service = build_content.__globals__["chat_attachment_service"]
    monkeypatch.setattr(
        attachment_service,
        "load_attachment_bytes",
        lambda storage_key: b"image" if storage_key == "asset-key" else b"",
    )
    monkeypatch.setattr(
        attachment_service,
        "to_data_url",
        lambda mime_type, data: f"data:{mime_type};base64,aW1hZ2U=",
    )

    converted = provider._convert_messages(
        [
            {
                "role": "user",
                "content_parts": [
                    {"type": "content", "text": "describe"},
                    {
                        "type": "image",
                        "mime_type": "image/png",
                        "filename": "image.png",
                        "storage_key": "asset-key",
                    },
                ],
            }
        ]
    )

    assert converted == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,aW1hZ2U="},
                },
            ],
        }
    ]
