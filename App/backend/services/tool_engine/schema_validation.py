from __future__ import annotations

from typing import Any

from .contracts import ValidationResult
from .result_utils import invalid_result, valid_result


def validate_args_is_object(args: Any) -> ValidationResult:
    if isinstance(args, dict):
        return valid_result()
    return invalid_result("validate_args_is_object", "Tool arguments must be a JSON object")


def _matches_type(value: Any, expected: str | list[Any]) -> bool:
    if isinstance(expected, list):
        return any(isinstance(item, str) and _matches_type(value, item) for item in expected)
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


def _type_label(expected: Any) -> str:
    if isinstance(expected, list):
        return "|".join(str(item) for item in expected)
    return str(expected)


def _schema_allows_null(prop_schema: dict[str, Any] | None) -> bool:
    if not isinstance(prop_schema, dict):
        return False
    if prop_schema.get("nullable") is True:
        return True
    expected_type = prop_schema.get("type")
    if expected_type == "null":
        return True
    return isinstance(expected_type, list) and "null" in expected_type


def _schema_type_includes(prop_schema: dict[str, Any], expected: str) -> bool:
    schema_type = prop_schema.get("type")
    if isinstance(schema_type, str):
        return schema_type == expected
    if isinstance(schema_type, list):
        return expected in schema_type
    return False


def _matches_schema_type(value: Any, prop_schema: dict[str, Any]) -> bool:
    if value is None and _schema_allows_null(prop_schema):
        return True
    expected_type = prop_schema.get("type")
    if isinstance(expected_type, str | list):
        return _matches_type(value, expected_type)
    return True


def _validate_nested_object(
    key: str,
    value: dict[str, Any],
    prop_schema: dict[str, Any],
) -> ValidationResult:
    required = prop_schema.get("required")
    if isinstance(required, list):
        for req in required:
            nested_props = prop_schema.get("properties")
            nested_schema = nested_props.get(req) if isinstance(nested_props, dict) else None
            if req not in value or (value.get(req) is None and not _schema_allows_null(nested_schema)):
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
            if isinstance(nested_type, str | list) and not _matches_schema_type(nv, nested_schema):
                return invalid_result(
                    "validate_schema_required_enum_additional_properties",
                    f"Invalid type for {key}.{nk}: expected {_type_label(nested_type)}",
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
        prop_schema = prop_map.get(name)
        if name not in args or (args.get(name) is None and not _schema_allows_null(prop_schema)):
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
        if isinstance(expected_type, str | list) and not _matches_schema_type(value, prop_schema):
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                f"Invalid type for {key}: expected {_type_label(expected_type)}",
            )

        enum_vals = prop_schema.get("enum")
        if isinstance(enum_vals, list) and value not in enum_vals:
            return invalid_result(
                "validate_schema_required_enum_additional_properties",
                f"Invalid value for {key}: {value}",
            )

        if _schema_type_includes(prop_schema, "array"):
            items_schema = prop_schema.get("items")
            if isinstance(items_schema, dict) and isinstance(value, list):
                item_type = items_schema.get("type")
                if isinstance(item_type, str | list):
                    for idx, item in enumerate(value):
                        if not _matches_schema_type(item, items_schema):
                            return invalid_result(
                                "validate_schema_required_enum_additional_properties",
                                f"Invalid type for {key}[{idx}]: expected {_type_label(item_type)}",
                            )

        if _schema_type_includes(prop_schema, "object") and isinstance(value, dict):
            nested = _validate_nested_object(key, value, prop_schema)
            if not nested.valid:
                return nested

    return valid_result()
