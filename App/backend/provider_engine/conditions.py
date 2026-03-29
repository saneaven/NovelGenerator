from __future__ import annotations

import re
from typing import Any

from .contracts import Condition


def get_path(data: Any, path: str | None) -> Any:
    if not path:
        return data
    current = data
    for segment in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(segment)
    return current


def eval_condition(cond: Condition, data: dict[str, Any], flags: dict[str, Any] | None = None) -> bool:
    active_flags = flags or {}
    if cond.op == "flag":
        return bool(active_flags.get(cond.flag or ""))

    value = get_path(data, cond.path)
    if cond.op == "eq":
        return value == cond.value
    if cond.op == "neq":
        return value != cond.value
    if cond.op == "in":
        return value in (cond.value or ())
    if cond.op == "not_in":
        return value not in (cond.value or ())
    if cond.op == "truthy":
        return bool(value)
    if cond.op == "falsy":
        return not bool(value)
    if cond.op == "regex":
        return isinstance(value, str) and re.search(cond.pattern or "", value) is not None
    if cond.op == "not_regex":
        return not isinstance(value, str) or re.search(cond.pattern or "", value) is None
    return False


def is_active(conditions: tuple[Condition, ...], data: dict[str, Any], flags: dict[str, Any] | None = None) -> bool:
    if not conditions:
        return True
    return all(eval_condition(cond, data, flags) for cond in conditions)
