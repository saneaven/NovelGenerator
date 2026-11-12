from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from App.backend.providers.openai import image as image_module
from App.backend.providers.registry import require_spec
from App.backend.providers.shared.image.contracts import (
    ImagePromptPayload,
    PreparedImageRequest,
    ResolvedGeometry,
)
from App.backend.schemas.assets import NaturalPromptData, StyledPrompt
from App.backend.services import image_model_catalog_service as catalog_module


def _mock_catalog(monkeypatch, payload, *, status_code: int = 200) -> list[httpx.Request]:
    requests: list[httpx.Request] = []
    original_client = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code, json=payload)

    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(
        image_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: original_client(*args, transport=transport, **kwargs),
    )
    return requests


def _list_models():
    return asyncio.run(image_module.list_models(
        provider_config={"api_key": "catalog-test-key"},
        runtime_spec=SimpleNamespace(),
        models_adapter="dynamic",
    ))


def test_openai_catalog_lists_api_image_families_without_a_model_whitelist(monkeypatch) -> None:
    requests = _mock_catalog(monkeypatch, {"data": [
        {"id": "gpt-image-2030-preview-2030-01-01", "owned_by": "openai"},
        {"id": "chatgpt-image-latest", "owned_by": "openai"},
        {"id": "gpt-2030", "owned_by": "openai"},
        {"id": "text-embedding-2030", "owned_by": "openai"},
        {"id": "gpt-image-1.5", "owned_by": "openai"},
        {"id": "gpt-image-2030-preview-2030-01-01", "owned_by": "openai"},
    ]})

    models = _list_models()

    assert [model.id for model in models] == [
        "chatgpt-image-latest", "gpt-image-1.5", "gpt-image-2030-preview-2030-01-01",
    ]
    assert all(model.name == model.id for model in models)
    assert all(model.owned_by == "openai" for model in models)
    assert "gpt-image-2" not in {model.id for model in models}
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert str(requests[0].url) == "https://api.openai.com/v1/models"
    assert requests[0].headers["authorization"] == "Bearer catalog-test-key"


@pytest.mark.parametrize("payload", [{"data": []}, {"data": [{"id": "gpt-text-only"}]}])
def test_openai_catalog_does_not_replace_empty_results_with_static_models(monkeypatch, payload) -> None:
    _mock_catalog(monkeypatch, payload)

    assert _list_models() == []


@pytest.mark.parametrize("status_code", [401, 429, 500])
def test_openai_catalog_propagates_api_failure_instead_of_static_models(monkeypatch, status_code: int) -> None:
    _mock_catalog(monkeypatch, {"error": {"message": "Catalog unavailable"}}, status_code=status_code)

    with pytest.raises(httpx.HTTPStatusError):
        _list_models()


def test_openai_catalog_does_not_advertise_flexible_sizes_for_older_models_or_aliases(monkeypatch) -> None:
    _mock_catalog(monkeypatch, {"data": [
        {"id": "gpt-image-1.5"},
        {"id": "chatgpt-image-latest"},
        {"id": "gpt-image-2.5-flare-2026-09-08"},
    ]})

    models = {model.id: model for model in _list_models()}

    for model_id in ("gpt-image-1.5", "chatgpt-image-latest"):
        geometry = models[model_id].geometry
        assert geometry.resolution_mode == "native_exact"
        assert set(geometry.supported_resolutions) == {"1024x1024", "1536x1024", "1024x1536"}
    flexible = models["gpt-image-2.5-flare-2026-09-08"].geometry
    assert flexible.resolution_mode == "native_tier"
    assert flexible.supported_resolutions == ("1K", "2K", "4K")
    assert "21:9" in flexible.supported_aspect_ratios


def test_openai_generation_uses_the_selected_model_id_without_a_catalog_request(monkeypatch) -> None:
    selected_id = "gpt-image-2030-preview-2030-01-01"

    async def unexpected_catalog_request(*_args, **_kwargs):
        raise AssertionError("Generation must not depend on model-list availability")

    monkeypatch.setattr(catalog_module, "_list_image_models", unexpected_catalog_request)
    descriptor = asyncio.run(catalog_module.image_model_catalog_service.get_descriptor(
        provider="openai", model=selected_id, provider_config={},
    ))
    requests = []

    async def generate(**kwargs):
        requests.append(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(b64_json="image-data")])

    monkeypatch.setattr(image_module, "AsyncOpenAI", lambda **_kwargs: SimpleNamespace(
        images=SimpleNamespace(generate=generate),
    ))
    adapter = image_module.OpenAIImageAdapter({"api_key": "generation-test-key"})
    request = PreparedImageRequest(
        provider="openai",
        model_descriptor=descriptor,
        prompt_payload=ImagePromptPayload(
            prompt_format="natural",
            prompt_data=NaturalPromptData(prompt=StyledPrompt(content="A castle gate")),
        ),
        resolved_geometry=ResolvedGeometry(
            requested_aspect_ratio="1:1", requested_image_size="1K",
            resolved_aspect_ratio="1:1", resolved_image_size="1K", resolved_native_size="1024x1024",
        ),
    )

    result = asyncio.run(adapter.generate(request))

    assert result.success is True
    assert result.image_b64 == "image-data"
    assert requests[0]["model"] == selected_id


def test_openai_catalog_spec_has_no_static_or_session_model_list() -> None:
    image_spec = require_spec("openai").image

    assert image_spec is not None
    assert image_spec.models == ()
    assert image_spec.models_adapter == "dynamic"
    assert image_spec.catalog_cache_policy == "none"
