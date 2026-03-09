"""Registry for image generation providers"""
from typing import Dict, Type, List
from .base import BaseImageProvider


class ImageProviderRegistry:
    """Registry for managing image generation providers"""

    _providers: Dict[str, Type[BaseImageProvider]] = {}

    @classmethod
    def register(cls, provider_class: Type[BaseImageProvider]):
        """Register a provider class"""
        instance = provider_class({})
        cls._providers[instance.name] = provider_class
        return provider_class

    @classmethod
    def get_provider(cls, name: str, config: Dict) -> BaseImageProvider:
        """
        Get a provider instance by name

        Args:
            name: Provider identifier
            config: Provider configuration dict

        Returns:
            Provider instance

        Raises:
            ValueError: If provider not found
        """
        provider_class = cls._providers.get(name)
        if not provider_class:
            available = ", ".join(cls._providers.keys())
            raise ValueError(f"Unknown image provider '{name}'. Available: {available}")
        return provider_class(config)

    @classmethod
    def list_providers(cls) -> List[Dict]:
        """
        List all registered providers with metadata

        Returns:
            List of provider info dicts
        """
        providers = []
        for provider_class in cls._providers.values():
            instance = provider_class({})
            providers.append({
                "name": instance.name,
                "display_name": instance.display_name,
                "prompt_type": instance.get_prompt_type(),
                "supported_sizes": instance.get_supported_sizes(),
                "supported_qualities": instance.get_supported_qualities(),
                "settings_schema": instance.get_settings_schema(),
                "supports_image_input": instance.supports_image_input(),
            })
        return providers

    @classmethod
    def has_provider(cls, name: str) -> bool:
        """Check if a provider is registered"""
        return name in cls._providers
