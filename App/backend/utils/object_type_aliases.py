"""Helpers for normalizing object type identifiers."""

from typing import Dict

# Aliases map external names -> canonical names stored in DB
OBJECT_TYPE_ALIASES: Dict[str, str] = {}

# Precompute reverse map (canonical -> preferred external)
REVERSE_OBJECT_TYPE_ALIASES: Dict[str, str] = {
    canonical: alias for alias, canonical in OBJECT_TYPE_ALIASES.items()
}


def normalize_object_type(object_type: str) -> str:
    """
    Convert an externally supplied object type to the canonical value used in DB.
    """
    return OBJECT_TYPE_ALIASES.get(object_type, object_type)


def externalize_object_type(object_type: str) -> str:
    """
    Convert a canonical object type (stored in DB) to the preferred external name.
    """
    return REVERSE_OBJECT_TYPE_ALIASES.get(object_type, object_type)
