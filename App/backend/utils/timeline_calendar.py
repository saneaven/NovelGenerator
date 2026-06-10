from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Iterable


DEFAULT_CALENDAR = {
    "mode": "gregorian",
    "units": [
        {"name": "year", "label": "Year", "count": 12},
        {"name": "month", "label": "Month", "count": 31},
        {"name": "day", "label": "Day", "count": 24},
        {"name": "hour", "label": "Hour", "count": 60},
        {"name": "minute", "label": "Minute"},
    ]
}

FIXED_DEFAULT_CALENDAR = {
    "units": [
        {"name": "year", "label": "Year", "count": 12},
        {"name": "month", "label": "Month", "count": 30},
        {"name": "day", "label": "Day", "count": 24},
        {"name": "hour", "label": "Hour", "count": 60},
        {"name": "minute", "label": "Minute"},
    ]
}

DEFAULT_CALENDAR_JSON = json.dumps(DEFAULT_CALENDAR, ensure_ascii=True)


def default_calendar() -> dict[str, Any]:
    return deepcopy(DEFAULT_CALENDAR)


def calendar_mode(value: dict[str, Any] | Iterable[dict[str, Any]]) -> str:
    if isinstance(value, dict) and value.get("mode") == "gregorian":
        return "gregorian"
    return "fixed"


def is_gregorian_calendar(value: dict[str, Any] | Iterable[dict[str, Any]]) -> bool:
    return calendar_mode(value) == "gregorian"


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
    if calendar_mode(value) == "gregorian":
        return default_calendar()
    return {"units": _coerce_units(value)}


def is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year: int, month: int) -> int:
    if month == 2:
        return 29 if is_leap_year(year) else 28
    if month in {4, 6, 9, 11}:
        return 30
    return 31


def _days_before_year(year: int) -> int:
    previous = year - 1
    return previous * 365 + previous // 4 - previous // 100 + previous // 400


def _days_before_month(year: int, month: int) -> int:
    total = 0
    for cursor in range(1, month):
        total += days_in_month(year, cursor)
    return total


def _coerce_gregorian_part(
    date_value: dict[str, Any],
    name: str,
    *,
    required: bool,
    default: int = 1,
) -> int | None:
    if name not in date_value:
        return None if required else default
    raw = date_value.get(name)
    if not isinstance(raw, int):
        return None
    return raw


def _validate_gregorian_date(date_value: Any) -> bool:
    if not isinstance(date_value, dict):
        return False
    year = _coerce_gregorian_part(date_value, "year", required=True)
    month = _coerce_gregorian_part(date_value, "month", required=True)
    day = _coerce_gregorian_part(date_value, "day", required=True)
    hour = _coerce_gregorian_part(date_value, "hour", required=False)
    minute = _coerce_gregorian_part(date_value, "minute", required=False)
    if None in (year, month, day, hour, minute):
        return False
    assert year is not None and month is not None and day is not None and hour is not None and minute is not None
    if year < 1 or month < 1 or month > 12 or day < 1:
        return False
    if day > days_in_month(year, month):
        return False
    if hour < 1 or hour > 24 or minute < 1 or minute > 60:
        return False
    return True


def _gregorian_to_base_units(date_value: dict[str, Any]) -> int:
    if not _validate_gregorian_date(date_value):
        raise ValueError("Invalid timeline date")
    year = int(date_value["year"])
    month = int(date_value["month"])
    day = int(date_value["day"])
    hour = int(date_value.get("hour", 1))
    minute = int(date_value.get("minute", 1))
    days = _days_before_year(year) + _days_before_month(year, month) + day - 1
    return days * 24 * 60 + (hour - 1) * 60 + (minute - 1)


def _year_from_day_position(day_position: int) -> int:
    low = 1
    high = max(2, day_position // 365 + 2)
    while _days_before_year(high + 1) <= day_position:
        high *= 2
    while low < high:
        mid = (low + high + 1) // 2
        if _days_before_year(mid) <= day_position:
            low = mid
        else:
            high = mid - 1
    return low


def _gregorian_from_base_units(position: int) -> dict[str, int]:
    remaining = max(int(position or 0), 0)
    day_position, minute_of_day = divmod(remaining, 24 * 60)
    year = _year_from_day_position(day_position)
    day_of_year = day_position - _days_before_year(year)
    month = 1
    while day_of_year >= days_in_month(year, month):
        day_of_year -= days_in_month(year, month)
        month += 1
    hour_offset, minute_offset = divmod(minute_of_day, 60)
    return {
        "year": year,
        "month": month,
        "day": day_of_year + 1,
        "hour": hour_offset + 1,
        "minute": minute_offset + 1,
    }


def _unit_multiplier(units: list[dict[str, Any]], index: int) -> int:
    multiplier = 1
    for unit in units[index:]:
        count = unit.get("count")
        if count is None:
            break
        multiplier *= int(count)
    return multiplier


def validate_date(date_value: Any, units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]]) -> bool:
    if is_gregorian_calendar(units_or_calendar):
        return _validate_gregorian_date(date_value)
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
    if is_gregorian_calendar(units_or_calendar):
        return _gregorian_to_base_units(date_value)
    units = _coerce_units(units_or_calendar)
    if not validate_date(date_value, units):
        raise ValueError("Invalid timeline date")

    total = 0
    for index, unit in enumerate(units):
        total += (int(date_value.get(unit["name"], 1)) - 1) * _unit_multiplier(units, index)
    return total


def from_base_units(position: int, units_or_calendar: dict[str, Any] | Iterable[dict[str, Any]]) -> dict[str, int]:
    if is_gregorian_calendar(units_or_calendar):
        return _gregorian_from_base_units(position)
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
    if calendar_mode(old_units_or_calendar) != calendar_mode(new_units_or_calendar):
        migrated: list[dict[str, int] | None] = []
        for date_value in dates:
            if date_value is None:
                migrated.append(None)
                continue
            if not isinstance(date_value, dict):
                raise ValueError("Timeline date payload must be an object")
            migrated.append(from_base_units(to_base_units(date_value, old_units_or_calendar), new_units_or_calendar))
        return migrated, []

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
