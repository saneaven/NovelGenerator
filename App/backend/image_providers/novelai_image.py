"""NovelAI image generation provider"""
import base64
import io
import zipfile
from typing import Dict, List, Optional

import httpx

from .base import BaseImageProvider, ImageGenerationResult, ReferenceImageData
from .registry import ImageProviderRegistry


# Default negative prompt for anime generation
DEFAULT_NEGATIVE_PROMPT = (
    "lowres, {bad}, error, fewer, extra, missing, worst quality, "
    "jpeg artifacts, bad quality, watermark, unfinished, displeasing, "
    "chromatic aberration, signature, extra digits, artistic error, "
    "username, scan, [abstract]"
)


@ImageProviderRegistry.register
class NovelAIImageProvider(BaseImageProvider):
    """NovelAI image generation provider (V4.5)"""

    NOVELAI_API_URL = "https://image.novelai.net/ai/generate-image"

    def __init__(self, config: Dict):
        super().__init__(config)

    @property
    def name(self) -> str:
        return "novelai"

    @property
    def display_name(self) -> str:
        return "NovelAI"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_prompt_type(self) -> str:
        """NovelAI uses tag-based prompting"""
        return "tag_based"

    def get_supported_sizes(self) -> List[str]:
        return [
            "832x1216",   # Portrait (default)
            "1216x832",   # Landscape
            "1024x1024",  # Square
            "1024x1536",  # Tall portrait
            "1536x1024",  # Wide landscape
            "640x1536",   # Very tall
            "1536x640",   # Very wide
        ]

    def get_supported_qualities(self) -> List[str]:
        return ["standard"]

    def get_supported_styles(self) -> List[str]:
        return ["natural"]

    def get_settings_schema(self) -> Optional[Dict]:
        """Return NovelAI-specific settings schema"""
        return {
            "sampler": {
                "type": "select",
                "label": "Sampler",
                "options": [
                    {"value": "k_euler_ancestral", "label": "Euler Ancestral"},
                    {"value": "k_euler", "label": "Euler"},
                    {"value": "k_dpmpp_2m", "label": "DPM++ 2M"},
                    {"value": "k_dpmpp_sde", "label": "DPM++ SDE"},
                ],
                "default": "k_euler_ancestral"
            },
            "steps": {
                "type": "number",
                "label": "Steps",
                "min": 1,
                "max": 50,
                "default": 28
            },
            "scale": {
                "type": "number",
                "label": "CFG Scale",
                "min": 1,
                "max": 20,
                "step": 0.5,
                "default": 6
            },
            "noise_schedule": {
                "type": "select",
                "label": "Noise Schedule",
                "options": [
                    {"value": "karras", "label": "Karras"},
                    {"value": "native", "label": "Native"},
                    {"value": "exponential", "label": "Exponential"},
                ],
                "default": "karras"
            }
        }

    async def get_models(self) -> Dict:
        """Return available NovelAI V4.5 models"""
        return {
            "data": [
                {"id": "nai-diffusion-4-5-full", "name": "NAI Diffusion V4.5 Full"},
                {"id": "nai-diffusion-4-5-curated", "name": "NAI Diffusion V4.5 Curated"},
            ]
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "nai-diffusion-4-5-full",
        size: str = "832x1216",
        quality: str = "standard",
        style: str = "natural",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
    ) -> ImageGenerationResult:
        """Generate image using NovelAI API"""
        if not self.api_key:
            return ImageGenerationResult(
                success=False,
                error="NovelAI access token not configured. Check API key."
            )

        # Use positive_prompt for tag-based, or fall back to prompt
        final_positive = positive_prompt or prompt or ""
        if not final_positive.strip():
            return ImageGenerationResult(
                success=False,
                error="Positive prompt is required for NovelAI image generation."
            )

        # Use provided negative prompt or default
        final_negative = negative_prompt if negative_prompt is not None else DEFAULT_NEGATIVE_PROMPT

        # Parse size
        try:
            width, height = map(int, size.split("x"))
        except ValueError:
            width, height = 832, 1216

        # Get provider settings with defaults
        settings = provider_settings or {}
        sampler = settings.get("sampler", "k_euler_ancestral")
        steps = settings.get("steps", 28)
        scale = settings.get("scale", 6)
        noise_schedule = settings.get("noise_schedule", "karras")

        # Build request payload for V4.5
        payload = {
            "input": final_positive,
            "model": model,
            "action": "generate",
            "parameters": {
                "params_version": 3,
                "width": width,
                "height": height,
                "scale": scale,
                "sampler": sampler,
                "steps": steps,
                "n_samples": 1,
                "negative_prompt": final_negative,
                "qualityToggle": True,
                "ucPreset": 0,
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
                        "char_captions": []
                    },
                    "use_coords": False,
                    "use_order": True
                },
                "v4_negative_prompt": {
                    "caption": {
                        "base_caption": final_negative,
                        "char_captions": []
                    },
                    "use_coords": False,
                    "use_order": True
                }
            }
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    self.NOVELAI_API_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "application/zip",
                    },
                    json=payload,
                )

                if response.status_code == 401:
                    return ImageGenerationResult(
                        success=False,
                        error="NovelAI authentication failed. Check your access token."
                    )

                if response.status_code == 402:
                    return ImageGenerationResult(
                        success=False,
                        error="NovelAI subscription required or Anlas balance insufficient."
                    )

                if response.status_code != 200:
                    error_text = response.text[:500] if response.text else f"Status {response.status_code}"
                    return ImageGenerationResult(
                        success=False,
                        error=f"NovelAI API error: {error_text}"
                    )

                # NovelAI returns a ZIP file containing the image
                zip_data = response.content
                image_b64 = self._extract_image_from_zip(zip_data)

                if not image_b64:
                    return ImageGenerationResult(
                        success=False,
                        error="Failed to extract image from NovelAI response."
                    )

                return ImageGenerationResult(
                    success=True,
                    image_b64=image_b64,
                    width=width,
                    height=height,
                    format="png"
                )

        except httpx.TimeoutException:
            return ImageGenerationResult(
                success=False,
                error="NovelAI request timed out. Please try again."
            )
        except Exception as e:
            return ImageGenerationResult(
                success=False,
                error=f"Unexpected error: {str(e)}"
            )

    def _extract_image_from_zip(self, zip_data: bytes) -> Optional[str]:
        """Extract the first PNG image from a ZIP file and return as base64"""
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data), 'r') as zf:
                # Find the first PNG file
                for name in zf.namelist():
                    if name.lower().endswith('.png'):
                        image_data = zf.read(name)
                        return base64.b64encode(image_data).decode('utf-8')
            return None
        except Exception:
            return None
