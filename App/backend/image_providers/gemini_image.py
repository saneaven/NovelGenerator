"""Gemini image generation provider"""
import base64
from typing import Dict, List, Optional

from google import genai
from google.genai import types, errors

from .base import BaseImageProvider, ImageGenerationResult, MaskImageData, ReferenceImageData
from .model_capabilities import GEMINI_DEFAULT_MODEL, GEMINI_MODEL_OPTIONS
from .registry import ImageProviderRegistry


@ImageProviderRegistry.register
class GeminiImageProvider(BaseImageProvider):
    """Google Gemini image generation provider"""

    DEFAULT_MODEL = GEMINI_DEFAULT_MODEL

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[genai.Client] = None
        if self.validate_config():
            self._client = self._build_client()

    def _build_client(self) -> genai.Client:
        return genai.Client(api_key=self.api_key)

    def _ensure_client(self) -> genai.Client:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    @property
    def name(self) -> str:
        return "gemini"

    @property
    def display_name(self) -> str:
        return "Gemini Image"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_supported_sizes(self) -> List[str]:
        return []

    def get_supported_qualities(self) -> List[str]:
        return []

    def supports_image_input(self) -> bool:
        """Gemini supports multimodal input including images"""
        return True

    async def get_models(self) -> Dict:
        """Return available Gemini image models"""
        return {
            "data": GEMINI_MODEL_OPTIONS
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = DEFAULT_MODEL,
        size: str = "1024x1024",
        aspect_ratio: str = "1:1",
        image_size: str = "1K",
        resolved_native_size: str = "1K",
        quality: str = "auto",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
        mask_image: Optional[MaskImageData] = None,
    ) -> ImageGenerationResult:
        """Generate image using Gemini API"""
        del size, quality, n, positive_prompt, negative_prompt, resolved_native_size, mask_image
        if not self._client:
            return ImageGenerationResult(
                success=False,
                error="Gemini client not initialized. Check API key."
            )

        if not prompt:
            return ImageGenerationResult(
                success=False,
                error="Prompt is required for Gemini image generation."
            )

        try:
            client = self._ensure_client()

            # Extract Gemini-specific settings from provider_settings
            configured_aspect_ratio = None
            configured_image_resolution = None
            if provider_settings:
                configured_aspect_ratio = provider_settings.get('aspect_ratio')
                configured_image_resolution = provider_settings.get('image_resolution')

            # Build image config if Gemini-specific settings are provided
            image_config = None
            effective_aspect_ratio = str(configured_aspect_ratio or aspect_ratio or "1:1")
            effective_image_size = str(configured_image_resolution or image_size or "1K")
            if effective_aspect_ratio or effective_image_size:
                image_config = types.ImageConfig(
                    aspect_ratio=effective_aspect_ratio,
                    image_size=effective_image_size,
                )

            # Build generation config with image modality
            config = types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
                image_config=image_config,
            )

            # Build content - either multimodal with reference images or text-only
            if reference_images and len(reference_images) > 0:
                # Build multimodal content with reference images first, then prompt
                content_parts: List[types.Part] = []

                for ref_image in reference_images:
                    # Detect mime type from image data (default to png)
                    mime_type = "image/png"
                    if ref_image.image_data[:3] == b'\xff\xd8\xff':
                        mime_type = "image/jpeg"
                    elif ref_image.image_data[:4] == b'RIFF' and ref_image.image_data[8:12] == b'WEBP':
                        mime_type = "image/webp"

                    # Add image part
                    content_parts.append(
                        types.Part.from_bytes(
                            data=ref_image.image_data,
                            mime_type=mime_type
                        )
                    )

                # Add text prompt at the end
                content_parts.append(types.Part.from_text(text=prompt))
                contents = content_parts
            else:
                # Text-only prompt
                contents = prompt

            # Generate content with image modality
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )

            # Extract image from response
            for part in list(getattr(response, "parts", []) or []):
                if getattr(part, "inline_data", None):
                    inline_data = part.inline_data
                    image_data = inline_data.data
                    mime_type = inline_data.mime_type or "image/png"

                    if isinstance(image_data, bytes):
                        image_b64 = base64.b64encode(image_data).decode('utf-8')
                    else:
                        image_b64 = image_data

                    format_map = {
                        "image/png": "png",
                        "image/jpeg": "jpeg",
                        "image/webp": "webp",
                    }
                    img_format = format_map.get(mime_type, "png")

                    return ImageGenerationResult(
                        success=True,
                        image_b64=image_b64,
                        width=1024,
                        height=1024,
                        format=img_format
                    )

            text_content = "".join(
                part.text for part in list(getattr(response, "parts", []) or [])
                if getattr(part, "text", None)
            )
            if text_content:
                return ImageGenerationResult(
                    success=False,
                    error=f"No image generated. Model response: {text_content[:500]}"
                )

            return ImageGenerationResult(
                success=False,
                error="No image data in response"
            )

        except errors.APIError as e:
            return ImageGenerationResult(
                success=False,
                error=f"Gemini API error: {str(e)}"
            )
        except Exception as e:
            return ImageGenerationResult(
                success=False,
                error=f"Unexpected error: {str(e)}"
            )
