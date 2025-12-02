"""OpenAI image generation provider (DALL-E / GPT-Image)"""
from typing import Dict, List, Optional
from openai import AsyncOpenAI, OpenAIError

from .base import BaseImageProvider, ImageGenerationResult
from .registry import ImageProviderRegistry


@ImageProviderRegistry.register
class OpenAIImageProvider(BaseImageProvider):
    """OpenAI DALL-E / GPT-Image image generation provider"""

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[AsyncOpenAI] = None
        if self.validate_config():
            self._client = AsyncOpenAI(api_key=self.api_key)

    @property
    def name(self) -> str:
        return "openai"

    @property
    def display_name(self) -> str:
        return "OpenAI (DALL-E / GPT-Image)"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_supported_sizes(self) -> List[str]:
        return ["1024x1024", "1792x1024", "1024x1792"]

    def get_supported_qualities(self) -> List[str]:
        return ["standard", "hd"]

    def get_supported_styles(self) -> List[str]:
        return ["natural", "vivid"]

    async def get_models(self) -> Dict:
        """Return available OpenAI image models"""
        return {
            "data": [
                {"id": "gpt-image-1", "name": "GPT Image 1"},
                {"id": "dall-e-3", "name": "DALL-E 3"},
                {"id": "dall-e-2", "name": "DALL-E 2"},
            ]
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "gpt-image-1",
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "natural",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
    ) -> ImageGenerationResult:
        """Generate image using OpenAI API"""
        if not self._client:
            return ImageGenerationResult(
                success=False,
                error="OpenAI client not initialized. Check API key."
            )

        if not prompt:
            return ImageGenerationResult(
                success=False,
                error="Prompt is required for OpenAI image generation."
            )

        try:
            # Build request parameters
            params = {
                "model": model,
                "prompt": prompt,
                "n": n,
                "size": size,
            }

            # DALL-E 3 and GPT-Image-1 support quality and style
            if model in ["dall-e-3", "gpt-image-1"]:
                params["quality"] = quality
                params["style"] = style

            # Request base64 response for direct storage
            params["response_format"] = "b64_json"

            response = await self._client.images.generate(**params)

            if response.data and len(response.data) > 0:
                image_data = response.data[0]

                # Parse size
                width, height = 1024, 1024
                if size:
                    try:
                        w, h = size.split("x")
                        width, height = int(w), int(h)
                    except ValueError:
                        pass

                return ImageGenerationResult(
                    success=True,
                    image_b64=image_data.b64_json,
                    revised_prompt=getattr(image_data, "revised_prompt", None),
                    width=width,
                    height=height,
                    format="png"
                )
            else:
                return ImageGenerationResult(
                    success=False,
                    error="No image data in response"
                )

        except OpenAIError as e:
            return ImageGenerationResult(
                success=False,
                error=f"OpenAI API error: {str(e)}"
            )
        except Exception as e:
            return ImageGenerationResult(
                success=False,
                error=f"Unexpected error: {str(e)}"
            )
