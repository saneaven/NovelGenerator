from __future__ import annotations

from copy import deepcopy
from typing import Any

from .conditions import is_active
from .contracts import FieldSpec, MISSING, ObjectSpec, SchemaNode


class _Skip:
    pass


SKIP = _Skip()


def merge_specs(base: ObjectSpec, override: ObjectSpec) -> ObjectSpec:
    fields: dict[str, SchemaNode] = {**base.fields}
    for name, node in override.fields.items():
        existing = fields.get(name)
        if isinstance(existing, ObjectSpec) and isinstance(node, ObjectSpec):
            fields[name] = merge_specs(existing, node)
        else:
            fields[name] = node
    return ObjectSpec(fields=fields, when=override.when or base.when, expose=override.expose and base.expose)


def normalize_field(raw: Any, spec: FieldSpec) -> Any:
    if raw is None:
        if spec.const is not MISSING:
            return deepcopy(spec.const)
        if spec.default is not MISSING:
            raw = deepcopy(spec.default)
        elif spec.required:
            if spec.kind in {"string", "literal"}:
                raw = ""
            elif spec.kind == "bool":
                raw = False
            elif spec.kind == "array":
                raw = []
            elif spec.kind == "object":
                raw = {}
            else:
                return SKIP
        else:
            return SKIP

    if spec.const is not MISSING:
        return deepcopy(spec.const)

    if raw is None:
        return None

    try:
        if spec.kind == "string":
            value = str(raw)
        elif spec.kind == "number":
            value = float(raw)
        elif spec.kind == "int":
            value = int(raw)
        elif spec.kind == "bool":
            value = bool(raw)
        elif spec.kind == "enum":
            if spec.options is not None and raw not in spec.options:
                if spec.default is not MISSING:
                    return deepcopy(spec.default)
                return SKIP
            value = raw
        elif spec.kind == "object":
            value = raw if isinstance(raw, dict) else {}
        elif spec.kind == "array":
            value = raw if isinstance(raw, list) else []
        else:
            value = raw
    except (TypeError, ValueError):
        if spec.default is not MISSING:
            return deepcopy(spec.default)
        return SKIP

    if spec.options is not None and spec.kind != "enum" and value not in spec.options:
        if spec.default is not MISSING:
            return deepcopy(spec.default)
        return SKIP

    if spec.disabled_options is not None and value in spec.disabled_options:
        if spec.default is not MISSING:
            return deepcopy(spec.default)
        return SKIP

    if spec.min_value is not None and isinstance(value, (int, float)) and value < spec.min_value:
        value = spec.min_value
    if spec.max_value is not None and isinstance(value, (int, float)) and value > spec.max_value:
        value = spec.max_value

    return value


def normalize_by_spec(
    value: dict[str, Any],
    spec: ObjectSpec,
    *,
    flags: dict[str, Any] | None = None,
    root: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    active_flags = flags or {}
    root_value = root if isinstance(root, dict) else value

    for name, node in spec.fields.items():
        if not is_active(node.when, root_value, active_flags):
            continue

        raw = value.get(name)
        if isinstance(node, FieldSpec):
            normalized = normalize_field(raw, node)
            if normalized is not SKIP:
                out[name] = normalized
            continue

        child_raw = raw if isinstance(raw, dict) else {}
        child = normalize_by_spec(child_raw, node, flags=active_flags, root=root_value)
        if child:
            out[name] = child

    return out
