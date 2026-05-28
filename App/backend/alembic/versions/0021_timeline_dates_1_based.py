"""Store timeline event dates as one-based values."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Session


revision = "0021_timeline_dates_1_based"
down_revision = "0020_drop_user_settings_cache"
branch_labels = None
depends_on = None


DEFAULT_UNITS = [
    {"name": "year", "label": "Year", "count": 12},
    {"name": "month", "label": "Month", "count": 30},
    {"name": "day", "label": "Day", "count": 24},
    {"name": "hour", "label": "Hour"},
]


def _calendar_units(calendar: Any) -> list[dict[str, Any]]:
    if isinstance(calendar, dict) and isinstance(calendar.get("units"), list):
        units = [unit for unit in calendar["units"] if isinstance(unit, dict) and unit.get("name")]
        if units:
            return units
    return DEFAULT_UNITS


def _shift_date(date_value: Any, units: list[dict[str, Any]], delta: int) -> dict[str, Any] | None:
    if not isinstance(date_value, dict):
        return None

    shifted = dict(date_value)
    changed = False
    for unit in units:
        name = unit.get("name")
        if not name or name not in shifted:
            continue
        shifted[name] = int(shifted.get(name, 0) or 0) + delta
        changed = True
    return shifted if changed else dict(date_value)


def _rewrite_event_dates(delta: int) -> None:
    conn = op.get_bind()
    session = Session(bind=conn)

    timelines_table = sa.table(
        "timelines",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("calendar", JSONB),
    )
    tracks_table = sa.table(
        "timeline_tracks",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("timeline_id", UUID(as_uuid=True)),
    )
    events_table = sa.table(
        "timeline_events",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("track_id", UUID(as_uuid=True)),
        sa.column("start_date", JSONB),
        sa.column("end_date", JSONB),
    )

    timelines = session.execute(sa.select(timelines_table)).fetchall()
    for timeline in timelines:
        units = _calendar_units(timeline.calendar)
        track_ids = [
            row.id
            for row in session.execute(
                sa.select(tracks_table.c.id).where(tracks_table.c.timeline_id == timeline.id)
            ).fetchall()
        ]
        if not track_ids:
            continue

        events = session.execute(
            sa.select(events_table).where(events_table.c.track_id.in_(track_ids))
        ).fetchall()
        for event in events:
            updated: dict[str, Any] = {}
            start_date = _shift_date(event.start_date, units, delta)
            if start_date is not None and start_date != event.start_date:
                updated["start_date"] = start_date

            end_date = _shift_date(event.end_date, units, delta)
            if end_date is not None and end_date != event.end_date:
                updated["end_date"] = end_date

            if updated:
                stmt = (
                    sa.update(events_table)
                    .where(events_table.c.id == event.id)
                    .values(**{k: sa.cast(sa.literal(v), JSONB) for k, v in updated.items()})
                )
                session.execute(stmt)

    session.commit()


def upgrade() -> None:
    _rewrite_event_dates(1)


def downgrade() -> None:
    _rewrite_event_dates(-1)
