"""Jinja2-based template variable resolution for arbitrary string/dict/list data."""

from __future__ import annotations

from typing import Any

from jinja2 import Undefined
from jinja2.sandbox import ImmutableSandboxedEnvironment

_env = ImmutableSandboxedEnvironment(undefined=Undefined, autoescape=False)


def resolve_str(value: str, ctx: dict[str, Any]) -> str:
    """Render a single string through Jinja2. Returns original on error."""
    try:
        return _env.from_string(value).render(**ctx)
    except Exception:
        return value


def resolve_value(data: Any, ctx: dict[str, Any]) -> Any:
    """Recursively resolve Jinja2 templates in string values within dicts and lists."""
    if isinstance(data, str):
        return resolve_str(data, ctx)
    if isinstance(data, dict):
        return {k: resolve_value(v, ctx) for k, v in data.items()}
    if isinstance(data, list):
        return [resolve_value(item, ctx) for item in data]
    return data
