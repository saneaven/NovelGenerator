from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


ProviderId = str
CapabilityName = Literal["llm", "embedding", "image"]


class _Missing:
    pass


MISSING = _Missing()


@dataclass(frozen=True)
class Condition:
    op: Literal["eq", "neq", "in", "not_in", "truthy", "falsy", "regex", "not_regex", "flag"]
    path: str | None = None
    value: Any = None
    flag: str | None = None
    pattern: str | None = None


@dataclass(frozen=True)
class UIHint:
    widget: Literal[
        "text",
        "password",
        "number",
        "select",
        "json",
        "toggle",
        "hidden",
        "template_select",
        "radio_cards",
        "slider",
    ] | None = None
    label_key: str | None = None
    placeholder_key: str | None = None
    help_key: str | None = None
    section: str | None = None
    order: int | None = None
    link_url: str | None = None
    link_label: str | None = None
    option_label_prefix: str | None = None


@dataclass(frozen=True)
class FieldSpec:
    kind: Literal["string", "number", "int", "bool", "enum", "object", "array", "literal"]
    required: bool = False
    default: Any = MISSING
    const: Any = MISSING
    options: tuple[Any, ...] | None = None
    disabled_options: tuple[Any, ...] | None = None
    when: tuple[Condition, ...] = ()
    disabled_when: tuple[Condition, ...] = ()
    ui: UIHint | None = None
    expose: bool = True
    min_value: float | None = None
    max_value: float | None = None
    step: float | None = None


@dataclass(frozen=True)
class ObjectSpec:
    fields: dict[str, "SchemaNode"]
    when: tuple[Condition, ...] = ()
    expose: bool = True
    group_toggle: str | None = None


SchemaNode = FieldSpec | ObjectSpec


@dataclass(frozen=True)
class DerivedFlag:
    name: str
    source_path: str
    resolver: Literal["regex", "presence", "bool"]
    pattern: str | None = None


@dataclass(frozen=True)
class RuntimeSpec:
    adapter: str
    server_only: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LLMVariantSpec:
    id: str
    runtime: RuntimeSpec
    task_config: ObjectSpec


@dataclass(frozen=True)
class LLMSpec:
    common_task_config: ObjectSpec
    variants: dict[str, LLMVariantSpec]
    variant_path: str | None = None
    default_variant: str | None = None
    derived_flags: tuple[DerivedFlag, ...] = ()
    supports_tools: bool = False
    supports_thinking: bool = False


@dataclass(frozen=True)
class EmbeddingSpec:
    config: ObjectSpec
    runtime: RuntimeSpec


@dataclass(frozen=True)
class ImageModelGeometrySpec:
    supported_aspect_ratios: tuple[str, ...]
    supported_resolutions: tuple[str, ...]
    default_aspect_ratio: str
    default_resolution: str
    resolution_mode: Literal["native_exact", "native_tier", "translated_fixed"]
    native_size_by_ratio: dict[str, str] | None = None
    supported_geometry_pairs: dict[str, tuple[str, ...]] | None = None


@dataclass(frozen=True)
class ImageModelDescriptor:
    id: str
    name: str
    prompt_type: Literal["natural", "tag_based"]
    supports_image_input: bool
    geometry: ImageModelGeometrySpec
    description: str | None = None
    canonical_slug: str | None = None
    owned_by: str | None = None
    icon_url: str | None = None
    tags: tuple[str, ...] | None = None
    category: str | None = None
    architecture: dict[str, Any] | None = None
    pricing: dict[str, Any] | None = None
    capabilities: dict[str, Any] | None = None
    supported_parameters: dict[str, Any] | None = None
    supports_mask_input: bool = False
    supports_multi_image_input: bool = False


@dataclass(frozen=True)
class ResolvedImageGeometry:
    model: str
    prompt_type: str
    supports_image_input: bool
    requested_aspect_ratio: str
    requested_image_size: str
    resolved_aspect_ratio: str
    resolved_image_size: str
    resolved_native_size: str


@dataclass(frozen=True)
class ImageSpec:
    runtime: RuntimeSpec
    prompt_type: Literal["natural", "tag_based"]
    supports_image_input: bool
    provider_settings: ObjectSpec | None = None
    settings_title_key: str | None = None
    settings_description_key: str | None = None
    models: tuple[ImageModelDescriptor, ...] = ()
    models_adapter: str | None = None


@dataclass(frozen=True)
class ProviderUI:
    display_name_key: str
    icon_key: str
    description_key: str | None = None
    llm_order: int | None = None
    embedding_order: int | None = None
    image_order: int | None = None
    model_browser_grouping_llm: Literal["flat", "openai_series", "gemini_family", "provider_family"] = "flat"
    model_browser_grouping_embedding: Literal["flat", "provider_family"] = "flat"
    llm_show_architecture: bool = False
    llm_show_pricing: bool = False
    llm_show_endpoints: bool = False
    embedding_show_architecture: bool = False
    embedding_show_pricing: bool = False
    embedding_show_endpoints: bool = False


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    ui: ProviderUI
    credentials: ObjectSpec
    llm: LLMSpec | None = None
    embedding: EmbeddingSpec | None = None
    image: ImageSpec | None = None
