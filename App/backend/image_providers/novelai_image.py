"""NovelAI image generation provider"""
import base64
import io
import zipfile
from typing import Any, Dict, List, Optional

import httpx

from .base import BaseImageProvider, ImageGenerationResult, ReferenceImageData
from .registry import ImageProviderRegistry


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

    def supports_image_input(self) -> bool:
        """NovelAI supports both i2i and Vibe Transfer"""
        return True

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
            },
            # Reference image settings (i2i / Vibe Transfer)
            "referenceMode": {
                "type": "select",
                "label": "Reference Mode",
                "options": [
                    {"value": "auto", "label": "Auto (1 img = Transform, 2+ = Vibe)"},
                    {"value": "i2i", "label": "Image-to-Image (transform)"},
                    {"value": "vibe", "label": "Vibe Transfer (style inspiration)"},
                ],
                "default": "auto",
                "showWhen": "hasReferenceImages"
            },
            "strength": {
                "type": "number",
                "label": "Transformation Strength",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.7,
                "showWhen": "i2iMode"
            },
            "i2iNoise": {
                "type": "number",
                "label": "Detail Addition",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.0,
                "showWhen": "i2iMode"
            },
            "vibeStrength": {
                "type": "number",
                "label": "Style Influence",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 0.6,
                "showWhen": "vibeMode"
            },
            "vibeInfoExtracted": {
                "type": "number",
                "label": "Info Extraction",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": 1.0,
                "showWhen": "vibeMode"
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
        aspect_ratio: str = "13:19",
        image_size: str = "1K",
        resolved_native_size: str = "832x1216",
        quality: str = "standard",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
    ) -> ImageGenerationResult:
        """Generate image using NovelAI API"""
        del aspect_ratio, image_size, resolved_native_size, quality, n
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

        final_negative = negative_prompt or ""

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

        # Determine reference image mode
        has_reference = reference_images is not None and len(reference_images) > 0
        reference_mode = settings.get("referenceMode", "auto")

        # Auto mode: 1 image = i2i, 2+ images = vibe
        if has_reference and reference_mode == "auto":
            reference_mode = "i2i" if len(reference_images) == 1 else "vibe"

        # Build request payload for V4.5
        action = "generate"
        if has_reference and reference_mode == "i2i":
            action = "img2img"

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
                    "char_captions": []
                },
                "use_coords": False,
                "use_order": True
            },
        }
        if final_negative.strip():
            parameters["negative_prompt"] = final_negative
            parameters["v4_negative_prompt"] = {
                "caption": {
                    "base_caption": final_negative,
                    "char_captions": []
                },
                "use_coords": False,
                "use_order": True
            }

        payload = {
            "input": final_positive,
            "model": model,
            "action": action,
            "parameters": parameters,
        }

        # Add reference image parameters based on mode
        if reference_images is not None and len(reference_images) > 0:
            if reference_mode == "i2i":
                # Image-to-Image: Use first image as base to transform
                ref_image = reference_images[0]
                image_b64 = base64.b64encode(ref_image.image_data).decode('utf-8')

                payload["parameters"]["image"] = image_b64
                payload["parameters"]["strength"] = settings.get("strength", 0.7)
                payload["parameters"]["noise"] = settings.get("i2iNoise", 0.0)

            else:  # vibe transfer
                # Vibe Transfer: Use all images as style inspiration
                vibe_strength = settings.get("vibeStrength", 0.6)
                vibe_info = settings.get("vibeInfoExtracted", 1.0)

                payload["parameters"]["reference_image_multiple"] = [
                    base64.b64encode(ref.image_data).decode('utf-8')
                    for ref in reference_images
                ]
                payload["parameters"]["reference_strength_multiple"] = [
                    ref.strength if ref.strength else vibe_strength
                    for ref in reference_images
                ]
                payload["parameters"]["reference_information_extracted_multiple"] = [
                    vibe_info for _ in reference_images
                ]

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
