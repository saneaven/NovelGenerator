from __future__ import annotations

import asyncio
import io
import zipfile

from App.backend.image_engine.contracts import (
    ImagePromptPayload,
    PreparedImageRequest,
    PreparedReferenceImage,
    ResolvedGeometry,
)
from App.backend.provider_engine.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from App.backend.provider_engine.provider_plugins.novelai import image_adapter as novelai_image_module
from App.backend.schemas.assets import StyledPrompt


NovelAIImageAdapter = novelai_image_module.NovelAIImageAdapter


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


def _build_request(
    *,
    positive_prompt: str,
    negative_prompt: str | None = None,
    native_size: str = "1024x1024",
    provider_settings: dict | None = None,
    reference_images: tuple[PreparedReferenceImage, ...] = (),
) -> PreparedImageRequest:
    return PreparedImageRequest(
        provider="novelai",
        model_descriptor=ImageModelDescriptor(
            id="nai-diffusion-4-5-full",
            name="NovelAI Diffusion V4.5 Full",
            prompt_type="tag_based",
            supports_image_input=True,
            geometry=ImageModelGeometrySpec(
                supported_aspect_ratios=("1:1",),
                supported_resolutions=("1024x1024",),
                default_aspect_ratio="1:1",
                default_resolution="1024x1024",
                resolution_mode="translated_fixed",
                native_size_by_ratio={"1:1": "1024x1024"},
            ),
        ),
        prompt_payload=ImagePromptPayload(
            prompt_type="tag_based",
            positive_prompt=StyledPrompt(prefix="", content=positive_prompt, postfix=""),
            negative_prompt=(
                StyledPrompt(prefix="", content=negative_prompt, postfix="")
                if negative_prompt is not None
                else None
            ),
        ),
        resolved_geometry=ResolvedGeometry(
            requested_aspect_ratio="1:1",
            requested_image_size="1K",
            resolved_aspect_ratio="1:1",
            resolved_image_size="1K",
            resolved_native_size=native_size,
        ),
        reference_images=reference_images,
        provider_settings=provider_settings or {},
    )


def test_generate_image_omits_hidden_quality_uc_and_negative_when_negative_missing(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    adapter = NovelAIImageAdapter({"api_key": "test-token"})
    result = asyncio.run(
        adapter.generate(
            _build_request(
                positive_prompt="1girl, city lights",
            )
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

    adapter = NovelAIImageAdapter({"api_key": "test-token"})
    result = asyncio.run(
        adapter.generate(
            _build_request(
                positive_prompt="1girl, city lights",
                negative_prompt="lowres, blurry",
            )
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

    adapter = NovelAIImageAdapter({"api_key": "test-token"})
    result = asyncio.run(
        adapter.generate(
            _build_request(
                positive_prompt="masterpiece, 1girl, detailed eyes",
                negative_prompt="lowres, blurry, bad hands",
                native_size="832x1216",
                provider_settings={
                    "referenceMode": "i2i",
                    "strength": 0.45,
                    "i2iNoise": 0.2,
                },
                reference_images=(PreparedReferenceImage(image_data=b"ref-image", strength=0.7),),
            )
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
