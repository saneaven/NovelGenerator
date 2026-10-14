from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from types import SimpleNamespace
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth.credentials import AnonymousCredentials
from google.genai import types
import httpx
import pytest

from App.backend.providers.gemini.llm import GeminiProvider
from App.backend.providers.registry import create_llm_provider, normalize_credentials, normalize_task_config, require_spec
from App.backend.providers.vertex import llm as vertex_llm
from App.backend.providers.vertex.llm import VertexProvider, prepare_config


@pytest.fixture(scope="module")
def service_account_config() -> dict[str, Any]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    return {
        "project_id": "target-project",
        "location": "global",
        "service_account_json": {
            "type": "service_account",
            "project_id": "credential-project",
            "private_key_id": "test-key-id",
            "private_key": pem,
            "client_email": "novel-test@credential-project.iam.gserviceaccount.com",
            "token_uri": "https://oauth2.googleapis.com/token",
        },
    }


def test_vertex_spec_reuses_gemini_llm_without_image_or_embedding() -> None:
    vertex = require_spec("vertex")
    gemini = require_spec("gemini")
    assert vertex.llm is not None
    assert vertex.embedding is None
    assert vertex.image is None
    assert vertex.llm.supports_tools is True
    assert vertex.llm.supports_thinking is True
    assert vertex.llm.variants["default"].tokenizer == "gemini"
    assert vertex.ui.model_browser_grouping_llm == "gemini_family"
    assert set(vertex.credentials.fields) == {"project_id", "location", "service_account_json"}
    assert vertex.credentials.fields["location"].default == "global"
    assert vertex.credentials.fields["service_account_json"].ui.widget == "json"

    normalized = normalize_task_config("vertex", {
        "provider": "gemini",
        "model": "gemini-3-pro-preview",
        "advanced": {
            "thinking_mode": "model",
            "thinking_config": {"gemini_thinking_level": "medium"},
            "provider_settings": {"service_tier": "flex", "cache": {"enabled": True}},
        },
    })
    assert normalized["provider"] == "vertex"
    assert normalized["supports_image_input"] is True
    assert normalized["advanced"]["thinking_config"] == {"gemini_thinking_level": "medium"}
    assert normalized["advanced"]["provider_settings"]["service_tier"] == "flex"
    tier = vertex.llm.common_task_config.fields["advanced"].fields["provider_settings"].fields["service_tier"]
    gemini_tier = gemini.llm.common_task_config.fields["advanced"].fields["provider_settings"].fields["service_tier"]
    assert tier.options == ("default", "flex", "priority")
    assert tier.ui == gemini_tier.ui


@pytest.mark.parametrize("tier", ["default", "flex", "priority"])
def test_vertex_task_config_preserves_service_tiers(tier) -> None:
    normalized = normalize_task_config("vertex", {
        "provider": "vertex",
        "model": "gemini-2.5-flash",
        "advanced": {"provider_settings": {"service_tier": tier}},
    })
    assert normalized["advanced"]["provider_settings"]["service_tier"] == tier


def test_vertex_credentials_and_prepared_config_remain_serializable(service_account_config) -> None:
    raw = deepcopy(service_account_config)
    raw.pop("location")
    raw["project_id"] = "  target-project  "
    raw.update(api_key="ignored", base_url="https://ignored.invalid", credentials=object())
    prepared = prepare_config(provider_config=raw)
    normalized = normalize_credentials("vertex", raw)
    assert set(prepared) == {"project_id", "location", "service_account_json"}
    assert set(normalized) == set(prepared)
    assert prepared["project_id"] == "target-project"
    assert prepared["location"] == "global"
    assert prepared["service_account_json"]["project_id"] == "credential-project"
    assert json.loads(json.dumps(prepared)) == prepared
    assert prepared["service_account_json"] is not raw["service_account_json"]


@pytest.mark.parametrize("field,value", [
    ("project_id", ""),
    ("project_id", 123),
    ("project_id", "projects/project"),
    ("location", ""),
    ("location", "https://untrusted.invalid"),
    ("location", None),
    ("service_account_json", "secret-json-string"),
    ("service_account_json", {}),
])
def test_vertex_invalid_configuration_is_rejected_without_client_creation(monkeypatch, service_account_config, field, value) -> None:
    config = deepcopy(service_account_config)
    config[field] = value

    def unexpected_client(**_kwargs):
        pytest.fail("Invalid credentials must not initialize a client")

    monkeypatch.setattr(vertex_llm.genai, "Client", unexpected_client)
    with pytest.raises(ValueError):
        prepare_config(provider_config=config)
    assert VertexProvider(config).validate_config() is False
    with pytest.raises(ValueError):
        create_llm_provider("vertex", config)


@pytest.mark.parametrize("changes", [
    {"type": "authorized_user"},
    {"token_uri": "https://untrusted.invalid/token"},
    {"token_uri": ["https://oauth2.googleapis.com/token"]},
    {"universe_domain": "untrusted.invalid"},
    {"client_email": None},
    {"client_email": "   "},
    {"private_key": "secret-invalid-private-key"},
])
def test_vertex_service_account_validation_does_not_expose_secrets(service_account_config, changes) -> None:
    config = deepcopy(service_account_config)
    config["service_account_json"].update(changes)
    with pytest.raises(ValueError) as exc:
        prepare_config(provider_config=config)
    assert str(exc.value) == "Vertex requires a valid Google service account JSON object."
    assert "secret-invalid-private-key" not in str(exc.value)
    assert "untrusted.invalid" not in str(exc.value)


def test_vertex_client_uses_only_explicit_user_service_account(monkeypatch, service_account_config) -> None:
    captured: dict[str, Any] = {}
    client = SimpleNamespace()

    def fake_client(**kwargs):
        captured.update(kwargs)
        return client

    monkeypatch.setattr(vertex_llm.genai, "Client", fake_client)
    monkeypatch.setattr(vertex_llm, "get_llm_stream_timeout", lambda: SimpleNamespace(read=3600.0))
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "false")
    monkeypatch.setenv("GOOGLE_API_KEY", "server-api-key-must-not-be-used")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "server-project-must-not-be-used")
    provider = create_llm_provider("vertex", service_account_config)
    assert VertexProvider.__bases__ == (GeminiProvider,)
    assert type(provider).__name__ == "VertexProvider"
    assert provider.name == "vertex"
    assert provider._ensure_client() is client
    assert captured["enterprise"] is True
    assert captured["project"] == "target-project"
    assert captured["location"] == "global"
    assert "api_key" not in captured
    assert captured["credentials"].service_account_email == service_account_config["service_account_json"]["client_email"]
    assert captured["credentials"].scopes == ["https://www.googleapis.com/auth/cloud-platform"]
    assert captured["http_options"].timeout == 3600000
    assert json.loads(json.dumps(provider.config)) == service_account_config


def test_vertex_catalog_uses_async_publisher_models_and_filters_nontext(monkeypatch, service_account_config) -> None:
    listed: dict[str, Any] = {}
    model_names = [
        "publishers/google/models/gemini-2.5-flash",
        "projects/project/locations/global/publishers/google/models/gemini-3-pro-preview",
        "gemini-2.5-flash",
        "publishers/google/models/gemini-embedding-001",
        "publishers/google/models/gemini-3.1-flash-image-preview",
        "publishers/google/models/gemini-2.5-flash-native-audio-preview",
        "publishers/google/models/gemini-2.5-flash-preview-tts",
        "publishers/google/models/gemini-live-2.5-flash",
        "publishers/google/models/imagen-4.0-generate-001",
        "publishers/other/models/gemini-3-pro-preview",
        "projects/project/locations/global/endpoints/123",
    ]

    class Pager:
        def __aiter__(self):
            async def iterate():
                for name in model_names:
                    yield SimpleNamespace(name=name, display_name=None, description="test model")
            return iterate()

    async def list_models(**kwargs):
        listed.update(kwargs)
        return Pager()

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(list=list_models)))
    monkeypatch.setattr(vertex_llm.genai, "Client", lambda **_kwargs: client)
    result = asyncio.run(VertexProvider(service_account_config).get_models())
    assert listed == {"config": {"query_base": True}}
    assert [model["id"] for model in result["data"]] == ["gemini-2.5-flash", "gemini-3-pro-preview"]
    assert result["data"][0] == {
        "id": "gemini-2.5-flash",
        "display_name": "gemini-2.5-flash",
        "description": "test model",
        "input_token_limit": None,
        "output_token_limit": None,
    }


def test_vertex_stream_reuses_gemini_tools_thinking_image_input_without_tier_in_body(monkeypatch, service_account_config) -> None:
    monkeypatch.setattr(vertex_llm.genai, "Client", lambda **_kwargs: SimpleNamespace())
    binary_builder = GeminiProvider._convert_messages.__globals__["build_gemini_binary_parts"]
    monkeypatch.setattr(binary_builder.__globals__["chat_attachment_service"], "load_attachment_bytes", lambda _key: b"image-bytes")
    provider = VertexProvider(service_account_config)

    async def first_request():
        stream = provider.stream_chat(
            messages=[{
                "role": "user",
                "content_parts": [
                    {"type": "content", "text": "Describe the scene"},
                    {"type": "image", "mime_type": "image/png", "storage_key": "test-image", "filename": "scene.png"},
                ],
            }],
            model="gemini-2.5-flash",
            tools=[{"name": "save_scene", "parameters": {"type": "object", "properties": {}}}],
            thinking_mode="model",
            thinking_config={"gemini_budget_tokens": 128},
            provider_settings={"service_tier": "flex"},
        )
        try:
            return await anext(stream)
        finally:
            await stream.aclose()

    event = asyncio.run(first_request())
    assert event.kind == "meta"
    request = event.raw_request
    assert request["model"] == "gemini-2.5-flash"
    assert request["config"]["service_tier"] is None
    assert "http_options" not in request["config"]
    assert request["config"]["thinking_config"]["thinking_budget"] == 128
    assert request["config"]["tools"][0]["function_declarations"][0]["name"] == "save_scene"
    assert request["current_input"]["parts"][1]["inline_data"]["data"] == b"image-bytes"
    assert "service_account_json" not in str(request)


def _run_vertex_mock_requests(monkeypatch, service_account_config, tiers):
    requests: list[httpx.Request] = []

    def mock_response(request):
        requests.append(request)
        response = {
            "candidates": [{
                "index": 0,
                "content": {"role": "model", "parts": [{"text": "Generated scene"}]},
                "finishReason": "STOP",
            }],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 3, "totalTokenCount": 8},
        }
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            text=f"data: {json.dumps(response)}\n\n",
        )

    async def run_requests():
        credentials = AnonymousCredentials()
        credentials.token = "test-token"
        transport = httpx.MockTransport(mock_response)
        client = vertex_llm.genai.Client(
            enterprise=True,
            project="target-project",
            location="global",
            credentials=credentials,
            http_options=types.HttpOptions(
                client_args={"transport": transport},
                async_client_args={"transport": transport},
            ),
        )
        monkeypatch.setattr(VertexProvider, "_build_client", lambda _self: client)
        provider = VertexProvider(service_account_config)
        all_events = []
        try:
            for tier in tiers:
                events = [event async for event in provider.stream_chat(
                    messages=[{"role": "user", "content_parts": [{"type": "content", "text": "Write a scene"}]}],
                    model="gemini-2.5-flash",
                    provider_settings={"service_tier": tier},
                )]
                assert not [event for event in events if event.kind == "error"]
                assert any(event.delta and event.delta.content_delta == "Generated scene" for event in events)
                all_events.append(events)
        finally:
            await provider.aclose()
        return all_events

    return requests, asyncio.run(run_requests())


@pytest.mark.parametrize("tier", ["default", "flex", "priority"])
def test_vertex_service_tier_headers_reach_sdk_transport_and_stay_out_of_body(monkeypatch, service_account_config, tier) -> None:
    requests, all_events = _run_vertex_mock_requests(monkeypatch, service_account_config, [tier])
    assert len(requests) == 1
    request = requests[0]
    assert request.url.path.endswith(":streamGenerateContent")
    if tier == "default":
        assert "X-Vertex-AI-LLM-Request-Type" not in request.headers
        assert "X-Vertex-AI-LLM-Shared-Request-Type" not in request.headers
    else:
        assert request.headers["X-Vertex-AI-LLM-Request-Type"] == "shared"
        assert request.headers["X-Vertex-AI-LLM-Shared-Request-Type"] == tier
    body = json.loads(request.content)
    assert "serviceTier" not in body
    assert "http_options" not in body
    assert "httpOptions" not in body
    raw_request = next(event.raw_request for event in all_events[0] if event.raw_request is not None)
    assert "http_options" not in raw_request["config"]
    assert "X-Vertex-AI-LLM-Request-Type" not in str(raw_request)
    assert "X-Vertex-AI-LLM-Shared-Request-Type" not in str(raw_request)


def test_vertex_service_tier_headers_do_not_leak_between_requests(monkeypatch, service_account_config) -> None:
    tiers = ["flex", "default", "priority", "default"]
    requests, _all_events = _run_vertex_mock_requests(monkeypatch, service_account_config, tiers)
    assert len(requests) == len(tiers)
    for request, tier in zip(requests, tiers, strict=True):
        if tier == "default":
            assert "X-Vertex-AI-LLM-Request-Type" not in request.headers
            assert "X-Vertex-AI-LLM-Shared-Request-Type" not in request.headers
        else:
            assert request.headers["X-Vertex-AI-LLM-Request-Type"] == "shared"
            assert request.headers["X-Vertex-AI-LLM-Shared-Request-Type"] == tier


@pytest.mark.parametrize("existing_handle", [None, "projects/target-project/locations/global/cachedContents/cache-1"])
def test_vertex_cache_stores_system_tools_and_uses_converted_message_boundary(monkeypatch, service_account_config, existing_handle) -> None:
    created: list[dict] = []
    handle = existing_handle or "projects/target-project/locations/global/cachedContents/cache-1"

    async def create_cache(**kwargs):
        created.append(kwargs)
        return SimpleNamespace(name=handle)

    client = SimpleNamespace(aio=SimpleNamespace(caches=SimpleNamespace(create=create_cache)))
    monkeypatch.setattr(vertex_llm.genai, "Client", lambda **_kwargs: client)
    binary_builder = GeminiProvider._convert_messages.__globals__["build_gemini_binary_parts"]
    monkeypatch.setattr(binary_builder.__globals__["chat_attachment_service"], "load_attachment_bytes", lambda _key: b"image-bytes")
    provider = VertexProvider(service_account_config)
    messages = [
        {"role": "system", "content_parts": [{"type": "content", "text": "System instructions"}]},
        {"role": "user", "content_parts": []},
        {"role": "tool_results", "tool_results": [{
            "tool_name": "read_scene", "content": "Scene image", "image_parts": [{
                "type": "image", "mime_type": "image/png", "storage_key": "scene", "filename": "scene.png",
            }],
        }]},
        {"role": "user", "content_parts": [{"type": "content", "text": "Continue the scene"}]},
    ]

    async def first_request():
        stream = provider.stream_chat(
            messages=messages, model="gemini-2.5-flash",
            tools=[{"name": "save_scene", "parameters": {"type": "object", "properties": {}}}],
            tool_choice="required", provider_settings={"cache": {"enabled": True, "explicit": True}},
            cache_plan=SimpleNamespace(
                provider_strategy="gemini_explicit", selected_provider_message_count=2,
                selected_cache_handle=existing_handle, selected_checkpoint_id="cp-1", ttl_label="1h",
            ),
        )
        try:
            return await anext(stream)
        finally:
            await stream.aclose()

    event = asyncio.run(first_request())
    request = event.raw_request
    assert request["config"]["cached_content"] == handle
    assert request["config"]["system_instruction"] is None
    assert request["config"]["tools"] is None
    assert request["config"]["tool_config"] is None
    assert request["history"] == []
    assert request["current_input"]["parts"][0]["text"] == "Continue the scene"
    if existing_handle:
        assert created == []
    else:
        assert len(created) == 1
        config = created[0]["config"]
        assert config["ttl"] == "3600s"
        assert config["system_instruction"]["parts"][0]["text"] == "System instructions"
        assert config["tools"][0]["function_declarations"][0]["name"] == "save_scene"
        assert config["tool_config"]["function_calling_config"]["mode"] == "ANY"
        assert len(config["contents"]) == 2
        assert config["contents"][0]["parts"][0]["function_response"]["name"] == "read_scene"
        assert config["contents"][1]["parts"][0]["inline_data"]["data"] == b"image-bytes"
