from __future__ import annotations

from typing import Any

from .contracts import ValidationResult
from .result_utils import invalid_result, valid_result


def validate_args_is_object(args: Any) -> ValidationResult:
    if isinstance(args, dict):
        return valid_result()
    return invalid_result("validate_args_is_object", "Tool arguments must be a JSON object")


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return (isinstance(value, int) and not isinstance(value, bool)) or isinstance(value, float)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "null":
        return value is None
    return True


def _validate_nested_object(
    key: str,
    value: dict[str, Any],
    prop_schema: dict[str, Any],
) -> ValidationResult:
    required = prop_schema.get("required")
    if isinstance(required, list):
        for req in required:
            if req not in value:
                return invalid_result(
                    "validate_schema_required_enum_additional_properties",
                    f"Missing required nested parameter: {key}.{req}",
                )

    nested_props = prop_schema.get("properties")
    if isinstance(nested_props, dict):
        for nk, nv in value.items():
            nested_schema = nested_props.get(nk)
            if not isinstance(nested_schema, dict):
                continue

            nested_type = nested_schema.get("type")
            if isinstance(nested_type, str) and not _matches_type(nv, nested_type):
                return invalid_result(
                    "validate_schema_required_enum_additional_properties",
                    f"Invalid type for {key}.{nk}: expected {nested_type}",
                )

            enum_vals = nested_schema.get("enum")
            if isinstance(enum_vals, list) and nv not in enum_vals:
                return invalid_result(
                    "validate_schema_required_enum_additional_properties",
                    f"Invalid value for {key}.{nk}: {nv}",
                )

    return valid_result()


def validate_schema_required_enum_additional_properties(
    args: dict[str, Any],
    schema: dict[str, Any],
) -> ValidationResult:
    required = schema.get("required")
    properties = schema.get("properties")
    additional = schema.get("additionalProperties", True)

    req_list = required if isinstance(required, list) else []
    prop_map = properties if isinstance(properties, dict) else {}

    for name in req_list:
        value = args.get(name)
        if value is None:
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                f"Missing required parameter: {name}",
            )

    if additional is False:
        unknown = [k for k in args.keys() if k not in prop_map]
        if unknown:
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                f"Unknown parameters: {', '.join(sorted(unknown))}",
            )

    for key, value in args.items():
        prop_schema = prop_map.get(key)
        if not isinstance(prop_schema, dict):
            continue

        expected_type = prop_schema.get("type")
        if isinstance(expected_type, str) and not _matches_type(value, expected_type):
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                f"Invalid type for {key}: expected {expected_type}",
            )

        enum_vals = prop_schema.get("enum")
        if isinstance(enum_vals, list) and value not in enum_vals:
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                f"Invalid value for {key}: {value}",
            )

        if expected_type == "array":
            items_schema = prop_schema.get("items")
            if isinstance(items_schema, dict) and isinstance(value, list):
                item_type = items_schema.get("type")
                if isinstance(item_type, str):
                    for idx, item in enumerate(value):
                        if not _matches_type(item, item_type):
                            return invalid_result(
                                "validate_schema_required_enum_additional_properties",
                                f"Invalid type for {key}[{idx}]: expected {item_type}",
                            )

        if expected_type == "object" and isinstance(value, dict):
            nested = _validate_nested_object(key, value, prop_schema)
            if not nested.valid:
                return nested

    return valid_result()
