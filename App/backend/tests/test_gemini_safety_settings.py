from __future__ import annotations

import asyncio
import json

from google import genai
from google.auth.credentials import AnonymousCredentials
from google.genai import types
import httpx
import pytest

from App.backend.providers.gemini.llm import GeminiProvider
from App.backend.providers.registry import normalize_task_config
from App.backend.providers.vertex.llm import VertexProvider


@pytest.fixture(params=[GeminiProvider, VertexProvider], ids=["gemini", "vertex"])
def mock_provider(request, monkeypatch):
    requests: list[httpx.Request] = []

    def respond(outbound):
        requests.append(outbound)
        response = {
            "candidates": [{
                "index": 0,
                "content": {"role": "model", "parts": [{"text": "Generated scene"}]},
                "finishReason": "STOP",
            }],
        }
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            text=f"data: {json.dumps(response)}\n\n",
        )

    transport = httpx.MockTransport(respond)
    options = types.HttpOptions(
        client_args={"transport": transport},
        async_client_args={"transport": transport},
    )
    if request.param is VertexProvider:
        credentials = AnonymousCredentials()
        credentials.token = "test-token"
        client = genai.Client(
            enterprise=True,
            project="test-project",
            location="global",
            credentials=credentials,
            http_options=options,
        )
    else:
        client = genai.Client(enterprise=False, api_key="test-key", http_options=options)

    # Authentication is covered separately; exercise the real SDK request serialization here.
    monkeypatch.setattr(request.param, "validate_config", lambda _self: True)
    monkeypatch.setattr(request.param, "_build_client", lambda _self: client)
    return request.param({}), requests


def test_saved_safety_settings_reach_sdk_and_defaults_do_not_leak(mock_provider):
    provider, requests = mock_provider
    categories = {
        "harassment": "HARM_CATEGORY_HARASSMENT",
        "hate_speech": "HARM_CATEGORY_HATE_SPEECH",
        "sexually_explicit": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "dangerous_content": "HARM_CATEGORY_DANGEROUS_CONTENT",
    }
    thresholds = ["OFF", "BLOCK_NONE", "BLOCK_ONLY_HIGH", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_LOW_AND_ABOVE"]
    cases = [
        {},
        {"harassment": "OFF", "hate_speech": "BLOCK_NONE", "sexually_explicit": "BLOCK_ONLY_HIGH"},
        {},
        *[dict.fromkeys(categories, threshold) for threshold in thresholds],
        {},
    ]

    async def run():
        try:
            for safety in cases:
                saved = normalize_task_config(provider.name, {
                    "model": "gemini-2.5-flash",
                    "advanced": {"provider_settings": {"safety": safety}},
                })
                settings = saved["advanced"]["provider_settings"]
                assert settings.get("safety", {}) == safety
                events = [event async for event in provider.stream_chat(
                    messages=[{"role": "user", "content_parts": [{"type": "content", "text": "Write a scene"}]}],
                    model=saved["model"],
                    provider_settings=settings,
                )]
                assert not [event for event in events if event.kind == "error"]
                assert any(event.delta and event.delta.content_delta == "Generated scene" for event in events)
        finally:
            await provider.aclose()

    asyncio.run(run())
    assert len(requests) == len(cases)
    for outbound, safety in zip(requests, cases, strict=True):
        body = json.loads(outbound.content)
        if not safety:
            assert "safetySettings" not in body
        else:
            assert body["safetySettings"] == [
                {"category": category, "threshold": safety[key]}
                for key, category in categories.items()
                if key in safety
            ]


@pytest.mark.parametrize("safety", ["OFF", {"harassment": "invalid"}, {"harassment": ["OFF"]}])
def test_invalid_safety_settings_fail_before_sending_request(mock_provider, safety):
    provider, requests = mock_provider

    async def run():
        try:
            return [event async for event in provider.stream_chat(
                messages=[{"role": "user", "content_parts": [{"type": "content", "text": "Write a scene"}]}],
                model="gemini-2.5-flash",
                provider_settings={"safety": safety},
            )]
        finally:
            await provider.aclose()

    events = asyncio.run(run())
    assert len(events) == 1
    assert events[0].kind == "error"
    assert events[0].error.status == 400
    assert requests == []
