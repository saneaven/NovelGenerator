from __future__ import annotations

import base64
import io
import zipfile
from typing import Any

import httpx

from ..shared.image.contracts import ImageGenerationOutput, PreparedImageRequest


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

        positive_prompt = request.prompt_payload.positive_prompt
        if positive_prompt is None:
            return ImageGenerationOutput(
                success=False,
                error="Positive prompt is required for NovelAI image generation.",
            )

        negative_prompt = request.prompt_payload.negative_prompt
        final_positive = (
            f"{positive_prompt.prefix}{positive_prompt.content}{positive_prompt.postfix}"
        )
        final_negative = (
            f"{negative_prompt.prefix}{negative_prompt.content}{negative_prompt.postfix}"
            if negative_prompt is not None
            else ""
        )

        try:
            width_text, height_text = request.resolved_geometry.resolved_native_size.split("x", 1)
            width, height = int(width_text), int(height_text)
        except ValueError:
            width, height = 832, 1216

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
            "v4_prompt": {
                "caption": {
                    "base_caption": final_positive,
                    "char_captions": [],
                },
                "use_coords": False,
                "use_order": True,
            },
            "negative_prompt": final_negative,
            "v4_negative_prompt": {
                "caption": {
                    "base_caption": final_negative,
                    "char_captions": [],
                },
                "use_coords": False,
                "use_order": True,
            },
        }
        payload = {
            "input": final_positive,
            "model": request.model_descriptor.id,
            "action": action,
            "parameters": parameters,
        }

        if request.reference_images:
            if reference_mode == "i2i":
                payload["parameters"]["image"] = base64.b64encode(
                    request.reference_images[0].image_data
                ).decode("utf-8")
                payload["parameters"]["strength"] = settings.get("strength", 0.7)
                payload["parameters"]["noise"] = settings.get("i2iNoise", 0.0)
            else:
                vibe_strength = settings.get("vibeStrength", 0.6)
                vibe_info = settings.get("vibeInfoExtracted", 1.0)
                payload["parameters"]["reference_image_multiple"] = [
                    base64.b64encode(ref.image_data).decode("utf-8")
                    for ref in request.reference_images
                ]
                payload["parameters"]["reference_strength_multiple"] = [
                    ref.strength if ref.strength else vibe_strength
                    for ref in request.reference_images
                ]
                payload["parameters"]["reference_information_extracted_multiple"] = [
                    vibe_info for _ in request.reference_images
                ]

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
                error="NovelAI subscription required or Anlas balance insufficient.",
            )
        if response.status_code != 200:
            error_text = response.text[:500] if response.text else f"Status {response.status_code}"
            return ImageGenerationOutput(
                success=False,
                error=f"NovelAI API error: {error_text}",
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

    def _extract_image_from_zip(self, zip_data: bytes) -> str | None:
        buffer = io.BytesIO(zip_data)
        with zipfile.ZipFile(buffer, "r") as archive:
            for file_name in archive.namelist():
                if file_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    return base64.b64encode(archive.read(file_name)).decode("utf-8")
        return None


def create_adapter(*, provider_config: dict[str, Any], runtime_spec: Any):
    del runtime_spec
    return NovelAIImageAdapter(provider_config)
