"""xAI Grok image generation provider (OpenAI-compatible)"""
from typing import Dict, List, Optional
from openai import AsyncOpenAI, OpenAIError

from .base import BaseImageProvider, ImageGenerationResult, ReferenceImageData
from .registry import ImageProviderRegistry


@ImageProviderRegistry.register
class XAIImageProvider(BaseImageProvider):
    """xAI Grok image generation provider using OpenAI-compatible API"""

    XAI_BASE_URL = "https://api.x.ai/v1"

    def __init__(self, config: Dict):
        super().__init__(config)
        self._client: Optional[AsyncOpenAI] = None
        if self.validate_config():
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.XAI_BASE_URL
            )

    @property
    def name(self) -> str:
        return "xai"

    @property
    def display_name(self) -> str:
        return "xAI (Grok Image)"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_supported_sizes(self) -> List[str]:
        return ["1024x1024"]

    def get_supported_qualities(self) -> List[str]:
        return ["standard"]

    async def get_models(self) -> Dict:
        """Return available Grok image models"""
        return {
            "data": [
                {"id": "grok-2-image", "name": "Grok 2 Image"},
                {"id": "grok-2-image-1212", "name": "Grok 2 Image 1212"},
            ]
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "grok-2-image",
        size: str = "1024x1024",
        quality: str = "standard",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
    ) -> ImageGenerationResult:
        """Generate image using xAI Grok API (OpenAI-compatible)"""
        if not self._client:
            return ImageGenerationResult(
                success=False,
                error="xAI client not initialized. Check API key."
            )

        if not prompt:
            return ImageGenerationResult(
                success=False,
                error="Prompt is required for xAI image generation."
            )

        try:
            # xAI uses OpenAI-compatible images endpoint
            params = {
                "model": model,
                "prompt": prompt,
                "n": n,
                "response_format": "b64_json",
            }

            response = await self._client.images.generate(**params)

            if response.data and len(response.data) > 0:
                image_data = response.data[0]

                return ImageGenerationResult(
                    success=True,
                    image_b64=image_data.b64_json,
                    revised_prompt=getattr(image_data, "revised_prompt", None),
                    width=1024,
                    height=1024,
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
                error=f"xAI API error: {str(e)}"
            )
        except Exception as e:
            return ImageGenerationResult(
                success=False,
                error=f"Unexpected error: {str(e)}"
            )
