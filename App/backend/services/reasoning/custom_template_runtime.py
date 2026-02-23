"""Custom Thinking Template runtime utilities.

Centralizes dot-path traversal, effort injection, response extraction,
and history re-injection for user-defined thinking templates.

All functions silently skip invalid or missing paths — no exceptions.
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# Dot-path utilities
# ---------------------------------------------------------------------------

def _resolve_segment(current: Any, key: str) -> Any | None:
    """Resolve a single path segment against a dict or list."""
    if isinstance(current, dict):
        return current.get(key)
    if isinstance(current, list):
        try:
            return current[int(key)]
        except (ValueError, IndexError):
            return None
    return None


def get_nested_path(obj: dict[str, Any], path: str) -> Any | None:
    """Retrieve a value from *obj* following a dot-separated *path*.

    Numeric segments are used as list indices when the current value is a list.
    Returns ``None`` when any segment is missing or the traversal fails.
    """
    current: Any = obj
    for key in path.split("."):
        current = _resolve_segment(current, key)
        if current is None:
            return None
    return current


def set_nested_path(obj: dict[str, Any], path: str, value: Any) -> None:
    """Set *value* inside *obj* at the given dot-separated *path*.

    Numeric segments index into existing lists. Intermediate dicts are
    created as needed when the current value is a dict.
    """
    keys = path.split(".")
    current: Any = obj
    for key in keys[:-1]:
        if isinstance(current, dict):
            current = current.setdefault(key, {})
        elif isinstance(current, list):
            try:
                current = current[int(key)]
            except (ValueError, IndexError):
                return
        else:
            return
    last = keys[-1]
    if isinstance(current, dict):
        current[last] = value
    elif isinstance(current, list):
        try:
            current[int(last)] = value
        except (ValueError, IndexError):
            pass


def delete_nested_path(obj: dict[str, Any], path: str) -> None:
    """Remove the leaf at *path* from *obj*.  No-op if the path is absent."""
    keys = path.split(".")
    current: Any = obj
    for key in keys[:-1]:
        current = _resolve_segment(current, key)
        if current is None:
            return
    last = keys[-1]
    if isinstance(current, dict):
        current.pop(last, None)
    elif isinstance(current, list):
        try:
            idx = int(last)
            if 0 <= idx < len(current):
                current.pop(idx)
        except (ValueError, IndexError):
            pass


# ---------------------------------------------------------------------------
# Template compilation (validate & filter valid rows)
# ---------------------------------------------------------------------------

def compile_template(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Validate *raw* template dict and return a cleaned copy, or ``None``."""
    template_id = raw.get("id")
    name = raw.get("name")
    if not isinstance(template_id, str) or not template_id.strip():
        return None
    if not isinstance(name, str) or not name.strip():
        return None

    effort_fields: list[dict[str, str]] = []
    for field in raw.get("effort_fields") or []:
        if not isinstance(field, dict):
            continue
        path = field.get("path")
        value = field.get("value")
        if isinstance(path, str) and path.strip() and isinstance(value, str):
            effort_fields.append({"path": path.strip(), "value": value})

    response_fields: list[dict[str, Any]] = []
    for field in raw.get("response_fields") or []:
        if not isinstance(field, dict):
            continue
        path = field.get("path")
        as_var = field.get("as_var")
        if isinstance(path, str) and path.strip() and isinstance(as_var, str) and as_var.strip():
            response_fields.append({
                "path": path.strip(),
                "as_var": as_var.strip(),
                "is_stream_delta": bool(field.get("is_stream_delta")),
            })

    history_fields: list[dict[str, str]] = []
    for field in raw.get("history_fields") or []:
        if not isinstance(field, dict):
            continue
        path = field.get("path")
        in_var = field.get("in_var")
        if isinstance(path, str) and path.strip() and isinstance(in_var, str) and in_var.strip():
            history_fields.append({"path": path.strip(), "in_var": in_var.strip()})

    return {
        "id": template_id.strip(),
        "name": name.strip(),
        "effort_fields": effort_fields,
        "response_fields": response_fields,
        "history_fields": history_fields,
    }


# ---------------------------------------------------------------------------
# Effort: inject into request body
# ---------------------------------------------------------------------------

def apply_effort_fields(request: dict[str, Any], effort_fields: list[dict[str, str]]) -> None:
    """Inject effort field values into *request* at their declared paths."""
    for field in effort_fields:
        path = field.get("path")
        value = field.get("value")
        if isinstance(path, str) and path and isinstance(value, str):
            set_nested_path(request, path, value)


# ---------------------------------------------------------------------------
# Response: extract from streaming delta
# ---------------------------------------------------------------------------

def extract_response_fields(
    delta: dict[str, Any],
    response_fields: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str | None]:
    """Extract template-defined fields from a streaming *delta* dict.

    Returns ``(reasoning_detail_items, thinking_delta_text_or_none)``.

    * Each ``reasoning_detail_item`` has ``{"_template_var": ..., "value": ...}``
      and flows into ``reasoning_detail_delta`` for snapshot accumulation.
    * ``thinking_delta_text`` is the value of the single field with
      ``is_stream_delta=True`` (for real-time display), or ``None``.
    """
    items: list[dict[str, Any]] = []
    thinking_delta: str | None = None

    for field in response_fields:
        path = field.get("path")
        as_var = field.get("as_var")
        is_stream = field.get("is_stream_delta", False)
        if not isinstance(path, str) or not isinstance(as_var, str):
            continue

        value = get_nested_path(delta, path)
        if value is None:
            continue

        items.append({"_template_var": as_var, "value": value})

        if is_stream and isinstance(value, str) and value:
            thinking_delta = value

    return items, thinking_delta


# ---------------------------------------------------------------------------
# History: inject into outgoing assistant message
# ---------------------------------------------------------------------------

def build_history_inject(
    reasoning_data: dict[str, Any],
    history_fields: list[dict[str, str]],
) -> dict[str, Any]:
    """Build a ``{dot_path: value}`` dict for history re-injection.

    *reasoning_data* holds the accumulated variable values from
    ``reasoningDetail.data``.  Each history field maps a stored variable
    (``in_var``) to a target dot-path in the outgoing assistant message.
    """
    inject: dict[str, Any] = {}
    for field in history_fields:
        path = field.get("path")
        in_var = field.get("in_var")
        if not isinstance(path, str) or not isinstance(in_var, str):
            continue
        value = get_nested_path(reasoning_data, in_var)
        if value is not None:
            inject[path] = value
    return inject
