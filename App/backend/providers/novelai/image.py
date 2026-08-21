from __future__ import annotations

import base64
import io
import json
import zipfile
from typing import Any

import httpx

from ..shared.image.contracts import ImageGenerationOutput, PreparedImageRequest
from ...schemas.assets import NovelAICharacterPrompt, NovelAIPromptData
from .spec import V5_SUPPORTED_SAMPLERS


V5_MODEL_IDS = frozenset({"nai-diffusion-5-curated", "nai-diffusion-5-full"})

V5_QUALITY_PRESETS: dict[str, tuple[str, int]] = {
    "standard": ("very aesthetic, masterpiece, no text", 1),
    "light": ("very aesthetic, amazing quality, no text", 3),
}

V5_HEAVY_UC = (
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, "
    "jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, "
    "screentone, multiple views, logo, too many watermarks, negative space, blank page"
)

class NovelAIImageAdapter:
    NOVELAI_API_URL = "https://image.novelai.net/ai/generate-image"

    def __init__(self, provider_config: dict[str, Any]):
        self._api_key = str(provider_config.get("api_key") or "").strip()

    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        if not self._api_key:
            return ImageGenerationOutput(
                success=False,
                error="NovelAI access token not configured. Check API key.",
            )

        prompt_data = request.prompt_payload.prompt_data
        if not isinstance(prompt_data, NovelAIPromptData):
            return ImageGenerationOutput(
                success=False,
                error="NovelAI prompt data is required for NovelAI image generation.",
            )

        positive_prompt = prompt_data.positive
        negative_prompt = prompt_data.negative
        characters = prompt_data.characters
        final_positive = (
            f"{positive_prompt.prefix}{positive_prompt.content}{positive_prompt.postfix}"
        )
        final_negative = (
            f"{negative_prompt.prefix}{negative_prompt.content}{negative_prompt.postfix}"
        )

        try:
            width_text, height_text = request.resolved_geometry.resolved_native_size.split("x", 1)
            width, height = int(width_text), int(height_text)
        except (AttributeError, TypeError, ValueError):
            width, height = 832, 1216

        if request.model_descriptor.id in V5_MODEL_IDS:
            validation_error = self._validate_v5_request(request)
            if validation_error is not None:
                return ImageGenerationOutput(success=False, error=validation_error)
            payload = self._build_v5_payload(
                request=request,
                positive_prompt=final_positive,
                negative_prompt=final_negative,
                characters=characters,
                width=width,
                height=height,
            )
        else:
            payload = self._build_v4_payload(
                request=request,
                positive_prompt=final_positive,
                negative_prompt=final_negative,
                characters=characters,
                width=width,
                height=height,
            )

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    self.NOVELAI_API_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                        "Accept": "application/zip",
                    },
                    json=payload,
                )
        except httpx.TimeoutException:
            return ImageGenerationOutput(
                success=False,
                error="NovelAI request timed out. Please try again.",
            )
        except Exception as exc:  # noqa: BLE001
            return ImageGenerationOutput(success=False, error=f"Unexpected error: {exc}")

        if response.status_code == 401:
            return ImageGenerationOutput(
                success=False,
                error="NovelAI authentication failed. Check your access token.",
            )
        if response.status_code == 402:
            return ImageGenerationOutput(
                success=False,
                error="NovelAI image allowance or Anlas balance is insufficient.",
            )
        if not 200 <= response.status_code < 300:
            return ImageGenerationOutput(
                success=False,
                error=(
                    f"NovelAI API error ({response.status_code}): "
                    f"{self._response_error_detail(response)}"
                ),
            )

        image_b64 = self._extract_image_from_zip(response.content)
        if not image_b64:
            return ImageGenerationOutput(
                success=False,
                error="Failed to extract image from NovelAI response.",
            )
        return ImageGenerationOutput(
            success=True,
            image_b64=image_b64,
            width=width,
            height=height,
            format="png",
        )

    @staticmethod
    def _validate_v5_request(request: PreparedImageRequest) -> str | None:
        if request.mask_image is not None:
            return "NovelAI V5 masking is not supported in this release."
        if len(request.reference_images) > 1:
            return "NovelAI V5 supports only one img2img reference image."
        if request.provider_settings.get("referenceMode") == "vibe":
            return "NovelAI V5 Vibe Transfer is not supported."
        return None

    @staticmethod
    def _structured_prompt(
        caption: str,
        character_captions: list[str],
        *,
        legacy_uc: bool | None = None,
    ) -> dict[str, Any]:
        prompt: dict[str, Any] = {
            "caption": {
                "base_caption": caption,
                "char_captions": [
                    {
                        "char_caption": character_caption,
                        "centers": [{"x": 0.5, "y": 0.5}],
                    }
                    for character_caption in character_captions
                ],
            },
            "use_coords": False,
            "use_order": True,
        }
        if legacy_uc is not None:
            prompt["legacy_uc"] = legacy_uc
        return prompt

    def _build_v4_payload(
        self,
        *,
        request: PreparedImageRequest,
        positive_prompt: str,
        negative_prompt: str,
        characters: list[NovelAICharacterPrompt],
        width: int,
        height: int,
    ) -> dict[str, Any]:
        settings = request.provider_settings
        sampler = settings.get("sampler", "k_euler_ancestral")
        steps = settings.get("steps", 28)
        scale = settings.get("scale", 6)
        noise_schedule = settings.get("noise_schedule", "karras")

        has_reference = bool(request.reference_images)
        reference_mode = settings.get("referenceMode", "auto")
        if has_reference and reference_mode == "auto":
            reference_mode = "i2i" if len(request.reference_images) == 1 else "vibe"

        action = "img2img" if has_reference and reference_mode == "i2i" else "generate"
        parameters: dict[str, Any] = {
            "params_version": 3,
            "width": width,
            "height": height,
            "scale": scale,
            "sampler": sampler,
            "steps": steps,
            "n_samples": 1,
            "noise_schedule": noise_schedule,
            "legacy": False,
            "add_original_image": True,
            "cfg_rescale": 0,
            "dynamic_thresholding": False,
            "sm": False,
            "sm_dyn": False,
            "v4_prompt": self._structured_prompt(
                positive_prompt,
                [character.positive for character in characters],
            ),
            "negative_prompt": negative_prompt,
            "v4_negative_prompt": self._structured_prompt(
                negative_prompt,
                [character.negative for character in characters],
            ),
        }
        payload = {
            "input": positive_prompt,
            "model": request.model_descriptor.id,
            "action": action,
            "parameters": parameters,
        }

        if request.reference_images:
            if reference_mode == "i2i":
                parameters["image"] = base64.b64encode(
                    request.reference_images[0].image_data
                ).decode("utf-8")
                parameters["strength"] = settings.get("strength", 0.7)
                parameters["noise"] = settings.get("i2iNoise", 0.0)
            else:
                vibe_strength = settings.get("vibeStrength", 0.6)
                vibe_info = settings.get("vibeInfoExtracted", 1.0)
                parameters["reference_image_multiple"] = [
                    base64.b64encode(ref.image_data).decode("utf-8")
                    for ref in request.reference_images
                ]
                parameters["reference_strength_multiple"] = [
                    ref.strength if ref.strength is not None else vibe_strength
                    for ref in request.reference_images
                ]
                parameters["reference_information_extracted_multiple"] = [
                    vibe_info for _ in request.reference_images
                ]

        return payload

    def _build_v5_payload(
        self,
        *,
        request: PreparedImageRequest,
        positive_prompt: str,
        negative_prompt: str,
        characters: list[NovelAICharacterPrompt],
        width: int,
        height: int,
    ) -> dict[str, Any]:
        settings = request.provider_settings
        sampler = settings.get("sampler", "k_euler_ancestral")
        if sampler not in V5_SUPPORTED_SAMPLERS:
            sampler = "k_euler_ancestral"

        quality_preset = str(settings.get("qualityPreset", "off") or "off").lower()
        quality = V5_QUALITY_PRESETS.get(quality_preset)
        if quality is not None:
            suffix, _ = quality
            positive_prompt = f"{positive_prompt}, {suffix}" if positive_prompt else suffix

        uc_preset = str(settings.get("ucPreset", "off") or "off").lower()
        if uc_preset == "heavy":
            negative_prompt = (
                f"{V5_HEAVY_UC}, {negative_prompt}"
                if negative_prompt
                else V5_HEAVY_UC
            )

        parameters: dict[str, Any] = {
            "params_version": 4,
            "width": width,
            "height": height,
            "scale": settings.get("scale", 7),
            "sampler": sampler,
            "steps": settings.get("steps", 23),
            "n_samples": 1,
            "noise_schedule": "karras",
            "legacy": False,
            "add_original_image": True,
            "cfg_rescale": 0,
            "dynamic_thresholding": False,
            "sm": False,
            "sm_dyn": False,
            "image_format": "png",
            "straight_alpha": True,
            "v4_prompt": self._structured_prompt(
                positive_prompt,
                [character.positive for character in characters],
            ),
            "negative_prompt": negative_prompt,
            "v4_negative_prompt": self._structured_prompt(
                negative_prompt,
                [character.negative for character in characters],
                legacy_uc=False,
            ),
        }
        if sampler == "k_euler_ancestral":
            parameters["deliberate_euler_ancestral_bug"] = False
            parameters["prefer_brownian"] = True
        if quality is not None:
            parameters["tag_hint_qt"] = quality[1]
        if uc_preset == "heavy":
            parameters["tag_hint_uc_preset"] = 2

        action = "generate"
        if request.reference_images:
            action = "img2img"
            reference = request.reference_images[0]
            parameters["image"] = base64.b64encode(reference.image_data).decode("utf-8")
            parameters["strength"] = settings.get("strength", 0.7)
            parameters["noise"] = settings.get("i2iNoise", 0.0)
            parameters["color_correct"] = False

        return {
            "input": positive_prompt,
            "model": request.model_descriptor.id,
            "action": action,
            "parameters": parameters,
        }

    @staticmethod
    def _response_error_detail(response: httpx.Response) -> str:
        try:
            body = response.json()
        except Exception:  # noqa: BLE001
            body = None

        if isinstance(body, dict):
            message = body.get("message")
            details = body.get("details")
            parts = [str(value) for value in (message, details) if value not in (None, "")]
            if parts:
                return ": ".join(parts)[:500]
            return json.dumps(body, ensure_ascii=False)[:500]

        error_text = str(getattr(response, "text", "") or "").strip()
        return error_text[:500] if error_text else f"Status {response.status_code}"

    @staticmethod
    def _extract_image_from_zip(zip_data: bytes) -> str | None:
        try:
            buffer = io.BytesIO(zip_data)
            with zipfile.ZipFile(buffer, "r") as archive:
                for file_name in archive.namelist():
                    if file_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                        return base64.b64encode(archive.read(file_name)).decode("utf-8")
        except (KeyError, OSError, RuntimeError, zipfile.BadZipFile):
            return None
        return None


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return NovelAIImageAdapter(provider_config)
