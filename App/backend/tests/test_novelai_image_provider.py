from __future__ import annotations

import asyncio
import importlib
import io
import sys
import types
import zipfile

from App.backend.image_providers.base import ReferenceImageData


fake_httpx = types.ModuleType("httpx")


class _PlaceholderAsyncClient:
    def __init__(self, *args, **kwargs) -> None:
        raise AssertionError("AsyncClient should be monkeypatched in tests")


class _FakeTimeoutException(Exception):
    pass


fake_httpx.AsyncClient = _PlaceholderAsyncClient
fake_httpx.TimeoutException = _FakeTimeoutException
sys.modules.setdefault("httpx", fake_httpx)

novelai_image_module = importlib.import_module("App.backend.image_providers.novelai_image")


NovelAIImageProvider = novelai_image_module.NovelAIImageProvider


def _build_zip_image() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("image_0.png", b"fake-png-data")
    return buffer.getvalue()


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, content: bytes | None = None) -> None:
        self.status_code = status_code
        self.content = content or b""
        self.text = ""


class _RecordingAsyncClient:
    def __init__(self, *args, **kwargs) -> None:
        self.payloads: list[dict] = []

    async def __aenter__(self) -> "_RecordingAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def post(self, url: str, *, headers: dict, json: dict) -> _FakeResponse:
        self.payloads.append(json)
        return _FakeResponse(content=_build_zip_image())


def test_generate_image_omits_hidden_quality_uc_and_negative_when_negative_missing(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    provider = NovelAIImageProvider({"api_key": "test-token"})
    result = asyncio.run(
        provider.generate_image(
            positive_prompt="1girl, city lights",
            model="nai-diffusion-4-5-full",
            size="1024x1024",
        )
    )

    assert result.success is True
    payload = client.payloads[0]
    parameters = payload["parameters"]

    assert "qualityToggle" not in parameters
    assert "ucPreset" not in parameters
    assert parameters["negative_prompt"] == ""
    assert parameters["v4_negative_prompt"]["caption"]["base_caption"] == ""
    assert parameters["v4_prompt"]["caption"]["base_caption"] == "1girl, city lights"


def test_generate_image_uses_only_explicit_negative_prompt(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    provider = NovelAIImageProvider({"api_key": "test-token"})
    result = asyncio.run(
        provider.generate_image(
            positive_prompt="1girl, city lights",
            negative_prompt="lowres, blurry",
            model="nai-diffusion-4-5-full",
            size="1024x1024",
        )
    )

    assert result.success is True
    payload = client.payloads[0]
    parameters = payload["parameters"]

    assert parameters["negative_prompt"] == "lowres, blurry"
    assert parameters["v4_negative_prompt"]["caption"]["base_caption"] == "lowres, blurry"


def test_generate_image_preserves_style_composed_prompts_and_reference_settings(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    provider = NovelAIImageProvider({"api_key": "test-token"})
    result = asyncio.run(
        provider.generate_image(
            positive_prompt="masterpiece, 1girl, detailed eyes",
            negative_prompt="lowres, blurry, bad hands",
            model="nai-diffusion-4-5-full",
            size="832x1216",
            provider_settings={
                "referenceMode": "i2i",
                "strength": 0.45,
                "i2iNoise": 0.2,
            },
            reference_images=[ReferenceImageData(image_data=b"ref-image", strength=0.7)],
        )
    )

    assert result.success is True
    payload = client.payloads[0]
    parameters = payload["parameters"]

    assert payload["input"] == "masterpiece, 1girl, detailed eyes"
    assert parameters["negative_prompt"] == "lowres, blurry, bad hands"
    assert parameters["image"] == "cmVmLWltYWdl"
    assert parameters["strength"] == 0.45
    assert parameters["noise"] == 0.2
