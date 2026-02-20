from __future__ import annotations

from typing import Any

from .contracts import ValidationResult


def valid_result() -> ValidationResult:
    return ValidationResult(valid=True)


def invalid_result(validator: str, reason: str) -> ValidationResult:
    return ValidationResult(valid=False, reason=reason, validator=validator)


def make_result(
    message: str,
    *,
    object_id: str | None = None,
    object_type: str | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"success": True, "message": message}
    if object_id is not None:
        payload["objectId"] = object_id
    if object_type is not None:
        payload["objectType"] = object_type
    if data is not None:
        payload["data"] = data
    return payload
