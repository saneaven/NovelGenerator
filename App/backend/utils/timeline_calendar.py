from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Iterable


DEFAULT_CALENDAR = {
    "units": [
        {"name": "year", "label": "Year", "count": 12},
        {"name": "month", "label": "Month", "count": 30},
        {"name": "day", "label": "Day", "count": 24},
        {"name": "hour", "label": "Hour"},
    ]
}

DEFAULT_CALENDAR_JSON = json.dumps(DEFAULT_CALENDAR, ensure_ascii=True)


def default_calendar() -> dict[str, Any]:
    return deepcopy(DEFAULT_CALENDAR)


def _coerce_units(value: dict[str, Any] | Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        raw_units = value.get("units")
    else:
        raw_units = value
    if not isinstance(raw_units, list) or not raw_units:
        raise ValueError("calendar.units must be a non-empty array")

    units: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for index, raw_unit in enumerate(raw_units):
        if not isinstance(raw_unit, dict):
            raise ValueError(f"calendar.units[{index}] must be an object")
        name = str(raw_unit.get("name") or "").strip()
        label = str(raw_unit.get("label") or name).strip()
        if not name:
            raise ValueError(f"calendar.units[{index}].name is required")
        if name in seen_names:
            raise ValueError(f"calendar unit names must be unique: {name}")
        seen_names.add(name)

        unit: dict[str, Any] = {"name": name, "label": label or name.title()}
        if "count" in raw_unit and raw_unit.get("count") is not None:
            try:
                count = int(raw_unit["count"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"calendar.units[{index}].count must be an integer") from exc
            if count <= 0:
                raise ValueError(f"calendar.units[{index}].count must be > 0")
            unit["count"] = count
        units.append(unit)

    for index, unit in enumerate(units[:-1]):
        if "count" not in unit:
            raise ValueError(f"calendar.units[{index}].count is required for non-terminal units")
    return units


def normalize_calendar(value: dict[str, Any] | Iterable[dict[str, Any]]) -> dict[str, Any]:
    return {"units": _coerce_units(value)}


def _unit_multiplier(units: list[dict[str, Any]], index: int) -> int:
    multiplier = 1
    for unit in units[index:]:
        count = unit.get("count")
        if count is None:
            break
        multiplier *= int(count)
    return multiplier


def validate_date(date_value: Any, units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]]) -> bool:
    if not isinstance(date_value, dict):
        return False
    try:
        units = _coerce_units(units_or_calendar)
    except ValueError:
        return False

    for i, unit in enumerate(units):
        raw = date_value.get(unit["name"], 1)
        if not isinstance(raw, int):
            return False
        if raw < 1:
            return False
        if i > 0:
            parent_count = units[i - 1].get("count")
            if parent_count is not None and raw > int(parent_count):
                return False
    return True


def to_base_units(date_value: dict[str, Any], units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]]) -> int:
    units = _coerce_units(units_or_calendar)
    if not validate_date(date_value, units):
        raise ValueError("Invalid timeline date")

    total = 0
    for index, unit in enumerate(units):
        total += (int(date_value.get(unit["name"], 1)) - 1) * _unit_multiplier(units, index)
    return total


def from_base_units(position: int, units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]]) -> dict[str, int]:
    units = _coerce_units(units_or_calendar)
    remaining = max(int(position or 0), 0)
    date_value: dict[str, int] = {}
    for index, unit in enumerate(units):
        multiplier = _unit_multiplier(units, index)
        if multiplier <= 0:
            date_value[unit["name"]] = 1
            continue
        count = unit.get("count")
        if count is None:
            date_value[unit["name"]] = remaining + 1
            remaining = 0
            continue
        date_value[unit["name"]] = (remaining // multiplier) + 1
        remaining = remaining % multiplier
    return date_value


def format_date(date_value: dict[str, Any], units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]]) -> str:
    units = _coerce_units(units_or_calendar)
    parts: list[str] = []
    for unit in units:
        parts.append(f"{unit['label']} {int(date_value.get(unit['name'], 1))}")
    return " / ".join(parts)


def migrate_dates(
    old_units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]],
    new_units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]],
    dates: Iterable[dict[str, Any] | None],
) -> tuple[list[dict[str, int] | None], list[str]]:
    old_units = _coerce_units(old_units_or_calendar)
    new_units = _coerce_units(new_units_or_calendar)

    warnings: list[str] = []
    migrated: list[dict[str, int] | None] = []

    renamed_pairs = [
        (old_units[index]["name"], new_units[index]["name"])
        for index in range(min(len(old_units), len(new_units)))
        if old_units[index]["name"] != new_units[index]["name"]
    ]
    removed_units = [unit["name"] for unit in old_units[len(new_units):]]
    added_units = [unit["name"] for unit in new_units[len(old_units):]]

    for date_value in dates:
        if date_value is None:
            migrated.append(None)
            continue
        if not isinstance(date_value, dict):
            raise ValueError("Timeline date payload must be an object")

        next_value = {unit["name"]: int(date_value.get(unit["name"], 1)) for unit in old_units}

        for old_name, new_name in renamed_pairs:
            next_value[new_name] = int(next_value.pop(old_name, 1))

        for unit_name in removed_units:
            removed_value = int(next_value.pop(unit_name, 1))
            if removed_value != 1:
                warnings.append(f"Removed calendar unit '{unit_name}' discarded non-default values")

        for unit_name in added_units:
            next_value.setdefault(unit_name, 1)

        ordered = {unit["name"]: int(next_value.get(unit["name"], 1)) for unit in new_units}

        # Carry propagation: redistribute values that exceed the parent's count
        for i in range(len(new_units) - 1, 0, -1):
            parent_count = new_units[i - 1].get("count")
            if parent_count is None:
                continue
            parent_count = int(parent_count)
            unit_name = new_units[i]["name"]
            value = int(ordered.get(unit_name, 1))
            if value > parent_count:
                carry = (value - 1) // parent_count
                ordered[unit_name] = ((value - 1) % parent_count) + 1
                parent_name = new_units[i - 1]["name"]
                ordered[parent_name] = int(ordered.get(parent_name, 1)) + carry

        migrated.append(ordered)

    return migrated, list(dict.fromkeys(warnings))
