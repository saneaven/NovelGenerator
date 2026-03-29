from typing import Dict, List, Type

from .base import BaseProvider


class ProviderRegistry:
    """Compatibility wrapper over provider_engine."""

    @classmethod
    def register(cls, provider_class: Type[BaseProvider]):
        # Legacy decorators stay harmless; canonical registration lives in provider_engine.
        return provider_class

    @classmethod
    def get_provider(cls, name: str, config: Dict, variant_hint: str | None = None) -> BaseProvider:
        from ..provider_engine.runtime_dispatch import create_llm_provider_instance

        resolved_variant_hint = variant_hint if variant_hint is not None else (str(config.get("custom_kind") or "").strip() or None)
        return create_llm_provider_instance(name, config, variant_hint=resolved_variant_hint)

    @classmethod
    def list_providers(cls) -> List[Dict]:
        from ..provider_engine.registry import list_providers

        providers = [spec for spec in list_providers() if spec.llm is not None]
        providers.sort(key=lambda spec: spec.ui.llm_order if spec.ui.llm_order is not None else 999)
        return [
            {
                "name": spec.id,
                "display_name": spec.ui.display_name_key,
            }
            for spec in providers
        ]
