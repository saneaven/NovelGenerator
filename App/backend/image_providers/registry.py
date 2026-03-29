"""Compatibility wrapper over provider_engine for image providers."""
from typing import Dict, List, Type

from .base import BaseImageProvider


class ImageProviderRegistry:
    @classmethod
    def register(cls, provider_class: Type[BaseImageProvider]):
        return provider_class

    @classmethod
    def get_provider(cls, name: str, config: Dict) -> BaseImageProvider:
        from ..provider_engine.runtime_dispatch import create_image_provider_instance

        return create_image_provider_instance(name, config)

    @classmethod
    def list_providers(cls) -> List[Dict]:
        from ..provider_engine.project import project_object_spec
        from ..provider_engine.registry import list_providers

        providers = [spec for spec in list_providers() if spec.image is not None]
        providers.sort(key=lambda spec: spec.ui.image_order if spec.ui.image_order is not None else 999)
        return [
            {
                "name": spec.id,
                "display_name": spec.ui.display_name_key,
                "prompt_type": spec.image.prompt_type,
                "settings_schema": project_object_spec(spec.image.provider_settings) if spec.image.provider_settings else None,
                "supports_image_input": spec.image.supports_image_input,
            }
            for spec in providers
        ]

    @classmethod
    def has_provider(cls, name: str) -> bool:
        from ..provider_engine.registry import require_provider

        try:
            return require_provider(name).image is not None
        except ValueError:
            return False
