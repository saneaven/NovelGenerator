from typing import Dict, Type, List
from .base import BaseProvider

class ProviderRegistry:
    """Registry for managing LLM providers"""

    _providers: Dict[str, Type[BaseProvider]] = {}

    @classmethod
    def register(cls, provider_class: Type[BaseProvider]):
        """Register a provider class"""
        instance = provider_class({})
        cls._providers[instance.name] = provider_class
        return provider_class

    @classmethod
    def get_provider(cls, name: str, config: Dict) -> BaseProvider:
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
            raise ValueError(f"Unknown provider '{name}'. Available: {available}")
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
                "display_name": instance.display_name
            })
        return providers
