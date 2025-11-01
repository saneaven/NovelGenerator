"""Template registry loader and helpers.

This module centralises access to the shared template registry metadata so it can be
used across backend services (validation, documentation, etc.) without duplicating
parsing logic.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

# Registry data lives under backend/data so the API can expose it while keeping
# a single authoritative copy in the backend codebase.
REGISTRY_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "template_registry" / "templates.json"
)


class TemplateRegistryError(RuntimeError):
    """Raised when the template registry cannot be loaded."""


def _load_registry_from_disk() -> Dict[str, Any]:
    """Read the raw JSON structure from disk."""
    if not REGISTRY_PATH.exists():
        raise TemplateRegistryError(f"Template registry not found at {REGISTRY_PATH}")

    try:
        with REGISTRY_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise TemplateRegistryError(f"Failed to parse template registry JSON: {exc}") from exc


@lru_cache(maxsize=1)
def _get_registry() -> Dict[str, Any]:
    """Cached accessor for the full registry JSON object."""
    return _load_registry_from_disk()


def refresh_cache() -> None:
    """Clear the cached registry so subsequent calls reload from disk."""
    _get_registry.cache_clear()  # type: ignore[attr-defined]


def get_version() -> Optional[str]:
    """Return the semantic version string embedded in the registry."""
    return _get_registry().get("version")


def get_catalog_section(section: str) -> Dict[str, Any]:
    """Return a catalog subsection such as 'variables', 'contexts', or 'conditionals'."""
    catalog = _get_registry().get("catalog", {})
    return catalog.get(section, {}) if isinstance(catalog, dict) else {}


def get_variable_catalog() -> Dict[str, Any]:
    return get_catalog_section("variables")


def get_context_catalog() -> Dict[str, Any]:
    return get_catalog_section("contexts")


def get_conditional_catalog() -> Dict[str, Any]:
    return get_catalog_section("conditionals")


def _keys_lowercase(data: Dict[str, Any]) -> Set[str]:
    return {key for key in data.keys()}


def get_known_variables() -> Set[str]:
    """Return the set of known variable placeholders."""
    return _keys_lowercase(get_variable_catalog())


def get_known_contexts() -> Set[str]:
    """Return the set of known context placeholders."""
    return _keys_lowercase(get_context_catalog())


def get_known_conditionals() -> Set[str]:
    """Return the set of known conditional placeholders."""
    return _keys_lowercase(get_conditional_catalog())


def get_templates() -> List[Dict[str, Any]]:
    """Return the list of registered templates with placeholder definitions."""
    templates = _get_registry().get("templates", [])
    return templates if isinstance(templates, list) else []


def iter_template_placeholders(template: Dict[str, Any]) -> Iterable[Tuple[str, str, Dict[str, Any]]]:
    """Yield (group, name, config) for each placeholder declared in a template."""
    placeholders = template.get("placeholders", {})
    if not isinstance(placeholders, dict):
        return

    for group in ("variables", "contexts", "conditionals"):
        entries = placeholders.get(group, {})
        if not isinstance(entries, dict):
            continue
        for name, config in entries.items():
            if isinstance(config, dict):
                yield group, name, config


def build_catalog_entries(catalog: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert the catalog dictionary into a list of entries with stable ordering."""
    entries: List[Dict[str, Any]] = []
    for name, details in catalog.items():
        if not isinstance(details, dict):
            details = {}
        entries.append(
            {
                "name": name,
                "description": details.get("description"),
                "type": details.get("type"),
                "source": details.get("source"),
                "example": details.get("example"),
                "default": details.get("default"),
                "supports_negation": details.get("supportsNegation"),
            }
        )
    return entries


def build_template_summaries() -> List[Dict[str, Any]]:
    """Construct template summaries enriched with catalog metadata."""
    templates: List[Dict[str, Any]] = []
    variable_catalog = get_variable_catalog()
    context_catalog = get_context_catalog()
    conditional_catalog = get_conditional_catalog()

    for template in get_templates():
        placeholders = template.get("placeholders", {})
        templates.append(
            {
                "id": template.get("id"),
                "function_type": template.get("functionType"),
                "category": template.get("category"),
                "variant": template.get("variant"),
                "description": template.get("description"),
                "placeholders": {
                    "variables": _build_placeholder_entries(placeholders.get("variables", {}), variable_catalog),
                    "contexts": _build_placeholder_entries(placeholders.get("contexts", {}), context_catalog),
                    "conditionals": _build_placeholder_entries(
                        placeholders.get("conditionals", {}),
                        conditional_catalog,
                    ),
                },
            }
        )

    return templates


def _build_placeholder_entries(
    usage_map: Any,
    catalog: Dict[str, Any],
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    if not isinstance(usage_map, dict):
        return entries

    for name, config in usage_map.items():
        config = config if isinstance(config, dict) else {}
        catalog_entry = catalog.get(name, {})
        if not isinstance(catalog_entry, dict):
            catalog_entry = {}

        entries.append(
            {
                "name": name,
                "required": bool(config.get("required", False)),
                "description": catalog_entry.get("description"),
                "type": catalog_entry.get("type"),
                "source": catalog_entry.get("source"),
                "example": catalog_entry.get("example"),
                "default": catalog_entry.get("default"),
                "supports_negation": catalog_entry.get("supportsNegation"),
            }
        )

    return entries


def build_syntax_metadata() -> Dict[str, Any]:
    """Return a serialisable structure describing catalog and template placeholders."""
    return {
        "version": get_version(),
        "catalog": {
            "variables": build_catalog_entries(get_variable_catalog()),
            "contexts": build_catalog_entries(get_context_catalog()),
            "conditionals": build_catalog_entries(get_conditional_catalog()),
        },
        "templates": build_template_summaries(),
    }
