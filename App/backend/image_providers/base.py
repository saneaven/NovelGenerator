"""Base class for image generation providers"""
from abc import ABC, abstractmethod
from typing import Dict, List, Optional
from dataclasses import dataclass


@dataclass
class ReferenceImageData:
    """Reference image for image-to-image generation"""
    image_data: bytes  # Raw image bytes
    strength: float = 0.7  # How much to use this reference (0-1)


@dataclass
class ImageGenerationResult:
    """Result of an image generation request"""
    success: bool
    image_data: Optional[bytes] = None  # Raw image bytes
    image_b64: Optional[str] = None  # Base64 encoded image
    image_url: Optional[str] = None  # URL to download from (temporary)
    revised_prompt: Optional[str] = None  # Provider's revised prompt
    error: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format: str = "png"


@dataclass
class ImageGenerationConfig:
    """Configuration for image generation"""
    prompt: str
    size: str = "1024x1024"  # Common sizes: 1024x1024, 1792x1024, 1024x1792
    quality: str = "standard"  # standard, hd
    style: str = "natural"  # natural, vivid
    n: int = 1  # Number of images to generate


class BaseImageProvider(ABC):
    """Base class for all image generation providers"""

    def __init__(self, config: Dict):
        self.config = config

    @abstractmethod
    async def generate_image(
        self,
        prompt: Optional[str] = None,
        model: str = "",
        size: str = "1024x1024",
        quality: str = "standard",
        style: str = "natural",
        n: int = 1,
        positive_prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        provider_settings: Optional[Dict] = None,
        reference_images: Optional[List['ReferenceImageData']] = None,
    ) -> ImageGenerationResult:
        """
        Generate an image from a text prompt

        Args:
            prompt: Text description for natural language providers
            model: Model identifier
            size: Image size (e.g., "1024x1024", "1792x1024")
            quality: Quality level ("standard", "hd")
            style: Style preset ("natural", "vivid")
            n: Number of images to generate
            positive_prompt: Positive tags for tag-based providers
            negative_prompt: Negative tags for tag-based providers
            provider_settings: Provider-specific settings (e.g., sampler, steps)
            reference_images: List of reference images for image-to-image generation

        Returns:
            ImageGenerationResult with image data or error
        """
        pass

    @abstractmethod
    async def get_models(self) -> Dict:
        """
        Get available image generation models

        Returns:
            Dict with model information
        """
        pass

    @abstractmethod
    def validate_config(self) -> bool:
        """
        Validate provider configuration

        Returns:
            True if configuration is valid
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identifier"""
        pass

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable provider name"""
        pass

    @property
    def api_key(self) -> Optional[str]:
        """Get API key from config"""
        return self.config.get("api_key")

    def get_supported_sizes(self) -> List[str]:
        """Get list of supported image sizes"""
        return ["1024x1024"]

    def get_supported_qualities(self) -> List[str]:
        """Get list of supported quality options"""
        return ["standard"]

    def get_supported_styles(self) -> List[str]:
        """Get list of supported style options"""
        return ["natural"]

    def get_prompt_type(self) -> str:
        """
        Return the prompt type for this provider.
        - 'natural': Single natural language prompt (OpenAI, Gemini, xAI)
        - 'tag_based': Positive/negative tag-based prompts (NovelAI)
        """
        return "natural"

    def get_settings_schema(self) -> Optional[Dict]:
        """
        Return JSON schema for provider-specific settings.
        Returns None if no additional settings are needed.
        """
        return None

    def supports_image_input(self) -> bool:
        """
        Return True if this provider supports image-to-image generation.
        Override in subclasses that support reference images.
        """
        return False
