from __future__ import annotations

from typing import Any

from .contracts import (
    Condition,
    FieldSpec,
    MISSING,
    ObjectSpec,
    ProviderSpec,
    UIHint,
)


def _condition_to_json(cond: Condition) -> dict[str, Any]:
    return {
        "op": cond.op,
        "path": cond.path,
        "value": cond.value,
        "flag": cond.flag,
        "pattern": cond.pattern,
    }


def _ui_hint_to_json(hint: UIHint | None) -> dict[str, Any] | None:
    if hint is None:
        return None
    return {
        "widget": hint.widget,
        "label_key": hint.label_key,
        "placeholder_key": hint.placeholder_key,
        "help_key": hint.help_key,
        "section": hint.section,
        "order": hint.order,
        "link_url": hint.link_url,
        "link_label": hint.link_label,
        "option_label_prefix": hint.option_label_prefix,
    }


def project_object_spec(spec: ObjectSpec) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kind": "object",
        "expose": spec.expose,
        "when": [_condition_to_json(item) for item in spec.when],
        "fields": {},
        "group_toggle": spec.group_toggle,
    }
    for name, node in spec.fields.items():
        if isinstance(node, FieldSpec):
            item: dict[str, Any] = {
                "kind": node.kind,
                "expose": node.expose,
                "required": node.required,
                "options": list(node.options or ()),
                "disabled_options": list(node.disabled_options or ()),
                "when": [_condition_to_json(cond) for cond in node.when],
                "disabled_when": [_condition_to_json(cond) for cond in node.disabled_when],
                "ui": _ui_hint_to_json(node.ui),
                "min_value": node.min_value,
                "max_value": node.max_value,
                "step": node.step,
            }
            if node.default is not MISSING:
                item["default"] = node.default
            if node.const is not MISSING:
                item["const"] = node.const
            out["fields"][name] = item
        else:
            out["fields"][name] = project_object_spec(node)
    return out


def _project_llm_spec(spec: Any) -> dict[str, Any]:
    if spec is None:
        return None
    return {
        "variant_path": spec.variant_path,
        "default_variant": spec.default_variant,
        "supports_tools": spec.supports_tools,
        "supports_thinking": spec.supports_thinking,
        "common_task_config": project_object_spec(spec.common_task_config),
        "variants": {
            key: {
                "id": variant.id,
                "task_config": project_object_spec(variant.task_config),
            }
            for key, variant in spec.variants.items()
        },
    }


def _project_embedding_spec(spec: Any) -> dict[str, Any]:
    if spec is None:
        return None
    return {
        "config": project_object_spec(spec.config),
    }


def _project_image_model(model: Any) -> dict[str, Any]:
    return {
        "id": model.id,
        "name": model.name,
        "prompt_type": model.prompt_type,
        "supports_image_input": model.supports_image_input,
        "supports_mask_input": model.supports_mask_input,
        "supports_multi_image_input": model.supports_multi_image_input,
        "geometry": {
            "supported_aspect_ratios": list(model.geometry.supported_aspect_ratios),
            "supported_resolutions": list(model.geometry.supported_resolutions),
            "default_aspect_ratio": model.geometry.default_aspect_ratio,
            "default_resolution": model.geometry.default_resolution,
            "resolution_mode": model.geometry.resolution_mode,
            "native_size_by_ratio": model.geometry.native_size_by_ratio,
            "supported_geometry_pairs": {
                key: list(value)
                for key, value in (model.geometry.supported_geometry_pairs or {}).items()
            } if model.geometry.supported_geometry_pairs else None,
        },
        "description": model.description,
        "canonical_slug": model.canonical_slug,
        "owned_by": model.owned_by,
        "icon_url": model.icon_url,
        "tags": list(model.tags or ()),
        "category": model.category,
        "architecture": model.architecture,
        "pricing": model.pricing,
        "capabilities": model.capabilities,
        "supported_parameters": model.supported_parameters,
    }


def _project_image_spec(spec: Any) -> dict[str, Any]:
    if spec is None:
        return None
    return {
        "prompt_type": spec.prompt_type,
        "supports_image_input": spec.supports_image_input,
        "provider_settings": project_object_spec(spec.provider_settings) if spec.provider_settings else None,
        "settings_title_key": spec.settings_title_key,
        "settings_description_key": spec.settings_description_key,
        "models": [_project_image_model(model) for model in spec.models],
        "has_dynamic_models": bool(spec.models_adapter),
        "catalog_cache_policy": spec.catalog_cache_policy,
        "allow_missing_credentials_for_model_listing": spec.allow_missing_credentials_for_model_listing,
    }


def to_public_provider_spec(spec: ProviderSpec) -> dict[str, Any]:
    return {
        "id": spec.id,
        "ui": {
            "display_name_key": spec.ui.display_name_key,
            "icon_key": spec.ui.icon_key,
            "description_key": spec.ui.description_key,
            "llm_order": spec.ui.llm_order,
            "embedding_order": spec.ui.embedding_order,
            "image_order": spec.ui.image_order,
            "model_browser_grouping_llm": spec.ui.model_browser_grouping_llm,
            "model_browser_grouping_embedding": spec.ui.model_browser_grouping_embedding,
            "llm_show_architecture": spec.ui.llm_show_architecture,
            "llm_show_pricing": spec.ui.llm_show_pricing,
            "llm_show_endpoints": spec.ui.llm_show_endpoints,
            "embedding_show_architecture": spec.ui.embedding_show_architecture,
            "embedding_show_pricing": spec.ui.embedding_show_pricing,
            "embedding_show_endpoints": spec.ui.embedding_show_endpoints,
        },
        "credentials": project_object_spec(spec.credentials),
        "llm": _project_llm_spec(spec.llm),
        "embedding": _project_embedding_spec(spec.embedding),
        "image": _project_image_spec(spec.image),
    }
