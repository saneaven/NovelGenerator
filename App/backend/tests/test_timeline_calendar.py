from __future__ import annotations

import importlib

from App.backend.utils.timeline_calendar import (
    DEFAULT_CALENDAR,
    format_date,
    from_base_units,
    migrate_dates,
    to_base_units,
    validate_date,
)


def test_timeline_dates_are_one_based() -> None:
    assert validate_date({"year": 1, "month": 1, "day": 1, "hour": 1}, DEFAULT_CALENDAR)
    assert validate_date({"year": 999, "month": 12, "day": 30, "hour": 24}, DEFAULT_CALENDAR)

    assert not validate_date({"year": 0, "month": 1, "day": 1, "hour": 1}, DEFAULT_CALENDAR)
    assert not validate_date({"year": 1, "month": 13, "day": 1, "hour": 1}, DEFAULT_CALENDAR)
    assert not validate_date({"year": 1, "month": 1, "day": 31, "hour": 1}, DEFAULT_CALENDAR)
    assert not validate_date({"year": 1, "month": 1, "day": 1, "hour": 25}, DEFAULT_CALENDAR)


def test_timeline_base_units_are_zero_origin_with_one_based_dates() -> None:
    assert to_base_units({"year": 1, "month": 1, "day": 1, "hour": 1}, DEFAULT_CALENDAR) == 0
    assert to_base_units({"year": 1, "month": 1, "day": 1, "hour": 2}, DEFAULT_CALENDAR) == 1
    assert to_base_units({"year": 1, "month": 1, "day": 2, "hour": 1}, DEFAULT_CALENDAR) == 24

    assert from_base_units(0, DEFAULT_CALENDAR) == {"year": 1, "month": 1, "day": 1, "hour": 1}
    assert from_base_units(24, DEFAULT_CALENDAR) == {"year": 1, "month": 1, "day": 2, "hour": 1}
    assert format_date({"year": 1, "month": 1}, DEFAULT_CALENDAR) == "Year 1 / Month 1 / Day 1 / Hour 1"


def test_migrate_dates_uses_one_based_defaults_and_carry() -> None:
    old_units = [{"name": "year", "label": "Year", "count": 12}, {"name": "month", "label": "Month"}]
    new_units = [{"name": "year", "label": "Year", "count": 12}, {"name": "month", "label": "Month"}]

    migrated, warnings = migrate_dates(old_units, new_units, [{"year": 1, "month": 13}])

    assert migrated == [{"year": 2, "month": 1}]
    assert warnings == []


def test_one_based_migration_shifts_existing_stored_dates() -> None:
    migration = importlib.import_module("App.backend.alembic.versions.0021_timeline_dates_1_based")
    units = [{"name": "year"}, {"name": "month"}]

    assert migration._shift_date({"year": 0, "month": 11}, units, 1) == {"year": 1, "month": 12}
    assert migration._shift_date({"year": 1, "month": 12}, units, -1) == {"year": 0, "month": 11}
