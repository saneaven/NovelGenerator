"""OpenAI image generation provider"""
import io
from typing import Dict, List, Optional
from openai import AsyncOpenAI, OpenAIError

from .base import BaseImageProvider, ImageGenerationResult, MaskImageData, ReferenceImageData
from .model_capabilities import OPENAI_DEFAULT_MODEL, OPENAI_MODEL_OPTIONS, get_openai_supported_sizes
from .registry import ImageProviderRegistry


@ImageProviderRegistry.register
class OpenAIImageProvider(BaseImageProvider):
    """OpenAI GPT Image provider"""

    DEFAULT_MODEL = OPENAI_DEFAULT_MODEL
    SUPPORTED_MODELS = tuple(option["id"] for option in OPENAI_MODEL_OPTIONS)

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
        return "OpenAI Image"

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_supported_sizes(self) -> List[str]:
        return get_openai_supported_sizes(self.DEFAULT_MODEL)

    def get_supported_qualities(self) -> List[str]:
        return ["auto", "low", "medium", "high"]

    def supports_image_input(self) -> bool:
        """GPT Image models support image-to-image generation"""
        return True

    async def get_models(self) -> Dict:
        """Return available OpenAI GPT Image models"""
        return {
            "data": OPENAI_MODEL_OPTIONS
        }

    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = DEFAULT_MODEL,
        size: str = "1024x1024",
        aspect_ratio: str = "1:1",
        image_size: str = "1K",
        resolved_native_size: str = "1024x1024",
        quality: str = "auto",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
        reference_images: Optional[List[ReferenceImageData]] = None,
        mask_image: Optional[MaskImageData] = None,
    ) -> ImageGenerationResult:
        """Generate image using OpenAI API"""
        del aspect_ratio, image_size, resolved_native_size
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
            effective_model = model if model in self.SUPPORTED_MODELS else self.DEFAULT_MODEL
            if provider_settings:
                quality = provider_settings.get("quality", quality)

            # Parse size for later use
            width, height = 1024, 1024
            if size:
                try:
                    w, h = size.split("x")
                    width, height = int(w), int(h)
                except ValueError:
                    pass

            # Check if we have reference images for image-to-image generation
            if reference_images and len(reference_images) > 0:
                return await self._generate_with_reference(
                    prompt=prompt,
                    model=effective_model,
                    size=size,
                    reference_images=reference_images,
                    width=width,
                    height=height,
                    quality=quality,
                    n=n,
                    provider_settings=provider_settings,
                    mask_image=mask_image,
                )

            return await self._generate_text_to_image(
                prompt=prompt,
                model=effective_model,
                size=size,
                quality=quality,
                n=n,
                width=width,
                height=height,
                provider_settings=provider_settings,
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

    async def _generate_text_to_image(
        self,
        prompt: str,
        model: str,
        size: str,
        quality: str,
        n: int,
        width: int,
        height: int,
        provider_settings: Optional[Dict],
    ) -> ImageGenerationResult:
        """Standard text-to-image generation for GPT Image models"""
        output_format = str((provider_settings or {}).get("output_format") or "png")
        params = {
            "model": model,
            "prompt": prompt,
            "n": n,
            "size": size,
            "quality": quality,
            "background": (provider_settings or {}).get("background", "auto"),
            "output_format": output_format,
        }

        if output_format in {"jpeg", "webp"}:
            params["output_compression"] = (provider_settings or {}).get("output_compression", 90)

        response = await self._client.images.generate(**params)

        if response.data and len(response.data) > 0:
            image_data = response.data[0]

            return ImageGenerationResult(
                success=True,
                image_b64=image_data.b64_json,
                revised_prompt=getattr(image_data, "revised_prompt", None),
                width=width,
                height=height,
                format=output_format
            )
        else:
            return ImageGenerationResult(
                success=False,
                error="No image data in response"
            )

    async def _generate_with_reference(
        self,
        prompt: str,
        model: str,
        size: str,
        reference_images: List[ReferenceImageData],
        width: int,
        height: int,
        quality: str,
        n: int,
        provider_settings: Optional[Dict],
        mask_image: Optional[MaskImageData],
    ) -> ImageGenerationResult:
        """Image-to-image generation using one or more reference images."""
        supported_sizes = get_openai_supported_sizes(model)
        edit_size = size if size in supported_sizes else supported_sizes[0]
        output_format = str((provider_settings or {}).get("output_format") or "png")
        images = [self._build_upload_image(ref.image_data, index) for index, ref in enumerate(reference_images)]

        params = {
            "model": model,
            "image": images if len(images) > 1 else images[0],
            "prompt": prompt,
            "size": edit_size,
            "quality": quality,
            "n": n,
            "background": (provider_settings or {}).get("background", "auto"),
            "output_format": output_format,
            "input_fidelity": (provider_settings or {}).get("input_fidelity", "high"),
        }
        if mask_image is not None:
            params["mask"] = self._build_upload_image(mask_image.image_data, "mask")

        if output_format in {"jpeg", "webp"}:
            params["output_compression"] = (provider_settings or {}).get("output_compression", 90)

        response = await self._client.images.edit(**params)  # type: ignore[arg-type]

        if response.data and len(response.data) > 0:
            result_data = response.data[0]

            return ImageGenerationResult(
                success=True,
                image_b64=result_data.b64_json,
                revised_prompt=getattr(result_data, "revised_prompt", None),
                width=width,
                height=height,
                format=output_format
            )
        else:
            return ImageGenerationResult(
                success=False,
                error="No image data in response"
            )

    def _build_upload_image(self, image_data: bytes, index: int | str) -> io.BytesIO:
        file_like = io.BytesIO(image_data)
        file_like.name = f"reference_{index}.png"
        return file_like
