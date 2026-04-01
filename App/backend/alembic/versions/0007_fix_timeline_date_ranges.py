"""Fix timeline event dates: reinterpret count as parent-constrains-child.

Previously, each unit's count was used as the max for that unit itself.
The correct interpretation is that count constrains the CHILD unit
(e.g., year.count=12 means month ranges 0-11, not year ranges 0-11).
This migration redistributes any values that overflow the new constraints.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Session


revision = "0007_fix_timeline_date_ranges"
down_revision = "0006_content_tree_rich_text"
branch_labels = None
depends_on = None


def _carry_propagate(date_value: dict, units: list[dict]) -> dict:
    """Redistribute values that exceed their parent's count."""
    result = dict(date_value)
    for i in range(len(units) - 1, 0, -1):
        parent_count = units[i - 1].get("count")
        if parent_count is None:
            continue
        parent_count = int(parent_count)
        unit_name = units[i]["name"]
        value = int(result.get(unit_name, 0) or 0)
        if value >= parent_count:
            carry = value // parent_count
            result[unit_name] = value % parent_count
            parent_name = units[i - 1]["name"]
            result[parent_name] = int(result.get(parent_name, 0) or 0) + carry
    return result


def upgrade() -> None:
    conn = op.get_bind()
    session = Session(bind=conn)

    timelines_table = sa.table(
        "timelines",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("calendar", JSONB),
    )
    events_table = sa.table(
        "timeline_events",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("track_id", UUID(as_uuid=True)),
        sa.column("start_date", JSONB),
        sa.column("end_date", JSONB),
    )
    tracks_table = sa.table(
        "timeline_tracks",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("timeline_id", UUID(as_uuid=True)),
    )

    timelines = session.execute(sa.select(timelines_table)).fetchall()

    for timeline in timelines:
        calendar = timeline.calendar
        if not isinstance(calendar, dict):
            continue
        units = calendar.get("units")
        if not isinstance(units, list) or len(units) < 2:
            continue

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
            updated = {}
            if isinstance(event.start_date, dict):
                new_start = _carry_propagate(event.start_date, units)
                if new_start != event.start_date:
                    updated["start_date"] = new_start
            if isinstance(event.end_date, dict):
                new_end = _carry_propagate(event.end_date, units)
                if new_end != event.end_date:
                    updated["end_date"] = new_end

            if updated:
                stmt = (
                    sa.update(events_table)
                    .where(events_table.c.id == event.id)
                    .values(**{k: sa.cast(sa.literal(v), JSONB) for k, v in updated.items()})
                )
                session.execute(stmt)

    session.commit()


def downgrade() -> None:
    pass  # Data migration cannot be reversed
