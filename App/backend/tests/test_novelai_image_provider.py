from __future__ import annotations

import asyncio
import io
import zipfile

import httpx

from App.backend.providers.shared.image.contracts import (
    ImagePromptPayload,
    PreparedImageRequest,
    PreparedReferenceImage,
    ResolvedGeometry,
)
from App.backend.providers.shared.contracts import ImageModelDescriptor, ImageModelGeometrySpec
from App.backend.providers.novelai import image as novelai_image_module
from App.backend.schemas.assets import NovelAICharacterPrompt, NovelAIPromptData, StyledPrompt


NovelAIImageAdapter = novelai_image_module.NovelAIImageAdapter


def _build_zip_image() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("image_0.png", b"fake-png-data")
    return buffer.getvalue()


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        content: bytes | None = None,
        text: str = "",
        json_body: object | None = None,
    ) -> None:
        self.status_code = status_code
        self.content = content or b""
        self.text = text
        self._json_body = json_body

    def json(self) -> object:
        if self._json_body is None:
            raise ValueError("No JSON body")
        return self._json_body


class _RecordingAsyncClient:
    def __init__(
        self,
        *,
        response: _FakeResponse | None = None,
        error: Exception | None = None,
    ) -> None:
        self.payloads: list[dict] = []
        self.response = response or _FakeResponse(content=_build_zip_image())
        self.error = error

    async def __aenter__(self) -> "_RecordingAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def post(self, url: str, *, headers: dict, json: dict) -> _FakeResponse:
        self.payloads.append(json)
        if self.error is not None:
            raise self.error
        return self.response


def _build_request(
    *,
    positive_prompt: str,
    negative_prompt: str | None = None,
    native_size: str = "1024x1024",
    provider_settings: dict | None = None,
    reference_images: tuple[PreparedReferenceImage, ...] = (),
    model_id: str = "nai-diffusion-4-5-full",
    characters: list[dict[str, str]] | None = None,
) -> PreparedImageRequest:
    return PreparedImageRequest(
        provider="novelai",
        model_descriptor=ImageModelDescriptor(
            id=model_id,
            name=model_id,
            prompt_format="novelai",
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
            prompt_format="novelai",
            prompt_data=NovelAIPromptData(
                positive=StyledPrompt(prefix="", content=positive_prompt, postfix=""),
                negative=StyledPrompt(
                    prefix="",
                    content=negative_prompt or "",
                    postfix="",
                ),
                characters=[
                    NovelAICharacterPrompt.model_validate(character)
                    for character in characters or []
                ],
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


def test_v4_and_v5_preserve_paired_character_caption_order(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)
    adapter = NovelAIImageAdapter({"api_key": "test-token"})
    characters = [
        {"positive": "1girl, red hair", "negative": "red hair, bad hands"},
        {"positive": "1boy, blue coat", "negative": "blue coat, blurry"},
    ]

    for model_id in ("nai-diffusion-4-5-full", "nai-diffusion-5-curated"):
        result = asyncio.run(
            adapter.generate(
                _build_request(
                    positive_prompt="city street",
                    negative_prompt="lowres",
                    model_id=model_id,
                    characters=characters,
                )
            )
        )
        assert result.success is True

    expected_positive = [
        {"char_caption": "1girl, red hair", "centers": []},
        {"char_caption": "1boy, blue coat", "centers": []},
    ]
    expected_negative = [
        {"char_caption": "red hair, bad hands", "centers": []},
        {"char_caption": "blue coat, blurry", "centers": []},
    ]
    for payload in client.payloads:
        positive = payload["parameters"]["v4_prompt"]
        negative = payload["parameters"]["v4_negative_prompt"]
        assert positive["caption"]["char_captions"] == expected_positive
        assert negative["caption"]["char_captions"] == expected_negative
        assert positive["use_coords"] is False
        assert negative["use_coords"] is False
        assert positive["use_order"] is True
        assert negative["use_order"] is True


def test_v4_payload_regression_is_unchanged(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    result = asyncio.run(
        NovelAIImageAdapter({"api_key": "test-token"}).generate(
            _build_request(
                positive_prompt="1girl",
                negative_prompt="lowres",
                provider_settings={
                    "sampler": "k_dpmpp_2m",
                    "steps": 31,
                    "scale": 5.5,
                    "noise_schedule": "exponential",
                },
            )
        )
    )

    assert result.success is True
    assert client.payloads == [{
        "input": "1girl",
        "model": "nai-diffusion-4-5-full",
        "action": "generate",
        "parameters": {
            "params_version": 3,
            "width": 1024,
            "height": 1024,
            "scale": 5.5,
            "sampler": "k_dpmpp_2m",
            "steps": 31,
            "n_samples": 1,
            "noise_schedule": "exponential",
            "legacy": False,
            "add_original_image": True,
            "cfg_rescale": 0,
            "dynamic_thresholding": False,
            "sm": False,
            "sm_dyn": False,
            "v4_prompt": {
                "caption": {"base_caption": "1girl", "char_captions": []},
                "use_coords": False,
                "use_order": True,
            },
            "negative_prompt": "lowres",
            "v4_negative_prompt": {
                "caption": {"base_caption": "lowres", "char_captions": []},
                "use_coords": False,
                "use_order": True,
            },
        },
    }]


def test_v5_curated_and_full_use_v5_defaults_without_hidden_prompt_mutation(monkeypatch) -> None:
    client = _RecordingAsyncClient(response=_FakeResponse(status_code=201, content=_build_zip_image()))
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)
    adapter = NovelAIImageAdapter({"api_key": "test-token"})

    for model_id in ("nai-diffusion-5-curated", "nai-diffusion-5-full"):
        result = asyncio.run(
            adapter.generate(
                _build_request(
                    positive_prompt="1girl, city lights",
                    negative_prompt="lowres",
                    native_size="832x1216",
                    model_id=model_id,
                )
            )
        )
        assert result.success is True

    for model_id, payload in zip(
        ("nai-diffusion-5-curated", "nai-diffusion-5-full"),
        client.payloads,
        strict=True,
    ):
        parameters = payload["parameters"]
        assert payload["model"] == model_id
        assert payload["action"] == "generate"
        assert payload["input"] == "1girl, city lights"
        assert parameters["params_version"] == 4
        assert parameters["width"] == 832
        assert parameters["height"] == 1216
        assert parameters["sampler"] == "k_euler_ancestral"
        assert parameters["steps"] == 23
        assert parameters["scale"] == 7
        assert parameters["noise_schedule"] == "karras"
        assert parameters["sm"] is False
        assert parameters["sm_dyn"] is False
        assert parameters["cfg_rescale"] == 0
        assert parameters["image_format"] == "png"
        assert parameters["straight_alpha"] is True
        assert parameters["deliberate_euler_ancestral_bug"] is False
        assert parameters["prefer_brownian"] is True
        assert parameters["v4_prompt"]["caption"] == {
            "base_caption": "1girl, city lights",
            "char_captions": [],
        }
        assert parameters["v4_negative_prompt"]["caption"] == {
            "base_caption": "lowres",
            "char_captions": [],
        }
        assert parameters["v4_negative_prompt"]["legacy_uc"] is False
        assert "tag_hint_qt" not in parameters
        assert "tag_hint_uc_preset" not in parameters
        assert "qualityToggle" not in parameters
        assert "ucPreset" not in parameters


def test_v5_explicit_quality_and_uc_presets_compose_prompts_and_hints(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    result = asyncio.run(
        NovelAIImageAdapter({"api_key": "test-token"}).generate(
            _build_request(
                positive_prompt="1girl",
                negative_prompt="bad hands",
                model_id="nai-diffusion-5-curated",
                provider_settings={
                    "qualityPreset": "standard",
                    "ucPreset": "heavy",
                },
            )
        )
    )

    assert result.success is True
    payload = client.payloads[0]
    parameters = payload["parameters"]
    assert payload["input"] == "1girl, very aesthetic, masterpiece, no text"
    assert parameters["v4_prompt"]["caption"]["base_caption"] == payload["input"]
    assert parameters["negative_prompt"] == f"{novelai_image_module.V5_HEAVY_UC}, bad hands"
    assert parameters["v4_negative_prompt"]["caption"]["base_caption"] == (
        parameters["negative_prompt"]
    )
    assert parameters["tag_hint_qt"] == 1
    assert parameters["tag_hint_uc_preset"] == 2
    assert "qualityToggle" not in parameters
    assert "ucPreset" not in parameters


def test_v5_light_quality_uses_light_hint(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    result = asyncio.run(
        NovelAIImageAdapter({"api_key": "test-token"}).generate(
            _build_request(
                positive_prompt="landscape",
                model_id="nai-diffusion-5-full",
                provider_settings={"qualityPreset": "light"},
            )
        )
    )

    assert result.success is True
    parameters = client.payloads[0]["parameters"]
    assert parameters["tag_hint_qt"] == 3
    assert parameters["v4_prompt"]["caption"]["base_caption"] == (
        "landscape, very aesthetic, amazing quality, no text"
    )


def test_v5_single_img2img_preserves_zero_strength_and_noise(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)

    result = asyncio.run(
        NovelAIImageAdapter({"api_key": "test-token"}).generate(
            _build_request(
                positive_prompt="1girl",
                model_id="nai-diffusion-5-curated",
                provider_settings={"strength": 0, "i2iNoise": 0},
                reference_images=(PreparedReferenceImage(image_data=b"reference"),),
            )
        )
    )

    assert result.success is True
    payload = client.payloads[0]
    parameters = payload["parameters"]
    assert payload["action"] == "img2img"
    assert parameters["image"] == "cmVmZXJlbmNl"
    assert parameters["strength"] == 0
    assert parameters["noise"] == 0
    assert parameters["color_correct"] is False
    assert "reference_image_multiple" not in parameters


def test_v5_rejects_multiple_references_and_vibe_without_http_request(monkeypatch) -> None:
    client = _RecordingAsyncClient()
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)
    adapter = NovelAIImageAdapter({"api_key": "test-token"})

    multi_result = asyncio.run(
        adapter.generate(
            _build_request(
                positive_prompt="1girl",
                model_id="nai-diffusion-5-curated",
                reference_images=(
                    PreparedReferenceImage(image_data=b"one"),
                    PreparedReferenceImage(image_data=b"two"),
                ),
            )
        )
    )
    vibe_result = asyncio.run(
        adapter.generate(
            _build_request(
                positive_prompt="1girl",
                model_id="nai-diffusion-5-curated",
                provider_settings={"referenceMode": "vibe"},
                reference_images=(PreparedReferenceImage(image_data=b"one"),),
            )
        )
    )

    assert multi_result.success is False
    assert "only one" in str(multi_result.error)
    assert vibe_result.success is False
    assert "Vibe Transfer" in str(vibe_result.error)
    assert client.payloads == []


def test_novelai_error_responses_preserve_actionable_details(monkeypatch) -> None:
    adapter = NovelAIImageAdapter({"api_key": "test-token"})
    request = _build_request(positive_prompt="1girl", model_id="nai-diffusion-5-curated")

    for status_code, expected in ((401, "authentication"), (402, "Anlas")):
        client = _RecordingAsyncClient(response=_FakeResponse(status_code=status_code))
        monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)
        result = asyncio.run(adapter.generate(request))
        assert result.success is False
        assert expected in str(result.error)

    client = _RecordingAsyncClient(response=_FakeResponse(
        status_code=422,
        json_body={"message": "invalid request", "details": "bad sampler"},
    ))
    monkeypatch.setattr(novelai_image_module.httpx, "AsyncClient", lambda *args, **kwargs: client)
    result = asyncio.run(adapter.generate(request))
    assert result.success is False
    assert result.error == "NovelAI API error (422): invalid request: bad sampler"


def test_novelai_timeout_and_malformed_zip_return_failures(monkeypatch) -> None:
    adapter = NovelAIImageAdapter({"api_key": "test-token"})
    request = _build_request(positive_prompt="1girl", model_id="nai-diffusion-5-curated")

    timeout_client = _RecordingAsyncClient(error=httpx.TimeoutException("timed out"))
    monkeypatch.setattr(
        novelai_image_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: timeout_client,
    )
    timeout_result = asyncio.run(adapter.generate(request))
    assert timeout_result.success is False
    assert "timed out" in str(timeout_result.error)

    invalid_zip_client = _RecordingAsyncClient(
        response=_FakeResponse(status_code=201, content=b"not-a-zip"),
    )
    monkeypatch.setattr(
        novelai_image_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: invalid_zip_client,
    )
    zip_result = asyncio.run(adapter.generate(request))
    assert zip_result.success is False
    assert zip_result.error == "Failed to extract image from NovelAI response."

    empty_zip = io.BytesIO()
    with zipfile.ZipFile(empty_zip, "w"):
        pass
    empty_zip_client = _RecordingAsyncClient(
        response=_FakeResponse(status_code=200, content=empty_zip.getvalue()),
    )
    monkeypatch.setattr(
        novelai_image_module.httpx,
        "AsyncClient",
        lambda *args, **kwargs: empty_zip_client,
    )
    empty_result = asyncio.run(adapter.generate(request))
    assert empty_result.success is False
    assert empty_result.error == "Failed to extract image from NovelAI response."
