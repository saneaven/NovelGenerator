"""Gemini image generation provider"""
import base64
from typing import Dict, List, Optional

from google import genai
from google.genai import types, errors

from .base import BaseImageProvider, ImageGenerationResult
from .registry import ImageProviderRegistry


@ImageProviderRegistry.register
class GeminiImageProvider(BaseImageProvider):
    """Google Gemini image generation provider (gemini-3-pro-image-preview)"""

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
        return "Gemini (Image Generation)"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_supported_sizes(self) -> List[str]:
        # Gemini doesn't specify exact sizes in the same way
        return ["1024x1024"]

    def get_supported_qualities(self) -> List[str]:
        return ["standard"]

    def get_supported_styles(self) -> List[str]:
        return ["natural"]

    async def get_models(self) -> Dict:
        """Return available Gemini image models"""
        return {
            "data": [
                {"id": "gemini-3-pro-image-preview", "name": "Gemini 3 Pro Image Preview"},
                {"id": "gemini-2.0-flash-preview-image-generation", "name": "Gemini 2.0 Flash Image Generation"},
            ]
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "gemini-3-pro-image-preview",
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "natural",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
    ) -> ImageGenerationResult:
        """Generate image using Gemini API"""
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
            aspect_ratio = None
            image_resolution = None
            if provider_settings:
                aspect_ratio = provider_settings.get('aspect_ratio')
                image_resolution = provider_settings.get('image_resolution')

            # Build image config if Gemini-specific settings are provided
            image_config = None
            if aspect_ratio or image_resolution:
                image_config = types.ImageConfig(
                    aspect_ratio=aspect_ratio or "1:1",
                    image_size=image_resolution or "2K",
                )

            # Build generation config with image modality
            config = types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
                image_config=image_config,
            )

            # Generate content with image modality
            response = await client.aio.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )

            # Extract image from response
            if response.candidates and len(response.candidates) > 0:
                candidate = response.candidates[0]
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        # Check if this part contains inline data (image)
                        if hasattr(part, 'inline_data') and part.inline_data:
                            inline_data = part.inline_data
                            image_data = inline_data.data
                            mime_type = inline_data.mime_type or "image/png"

                            # Convert to base64 if bytes
                            if isinstance(image_data, bytes):
                                image_b64 = base64.b64encode(image_data).decode('utf-8')
                            else:
                                image_b64 = image_data

                            # Determine format from mime type
                            format_map = {
                                "image/png": "png",
                                "image/jpeg": "jpeg",
                                "image/webp": "webp",
                            }
                            img_format = format_map.get(mime_type, "png")

                            return ImageGenerationResult(
                                success=True,
                                image_b64=image_b64,
                                width=1024,  # Default size
                                height=1024,
                                format=img_format
                            )

                # No image found, check for text response (might be a rejection)
                text_content = ""
                for part in candidate.content.parts if candidate.content else []:
                    if hasattr(part, 'text') and part.text:
                        text_content += part.text

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
