"""Use Gregorian calendar as the default timeline calendar."""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0023_timeline_gregorian"
down_revision = "0022_timeline_minute_base"
branch_labels = None
depends_on = None


OLD_DEFAULT_CALENDAR = {
    "units": [
        {"name": "year", "label": "Year", "count": 12},
        {"name": "month", "label": "Month", "count": 30},
        {"name": "day", "label": "Day", "count": 24},
        {"name": "hour", "label": "Hour", "count": 60},
        {"name": "minute", "label": "Minute"},
    ]
}

NEW_DEFAULT_CALENDAR = {
    "mode": "gregorian",
    "units": [
        {"name": "year", "label": "Year", "count": 12},
        {"name": "month", "label": "Month", "count": 31},
        {"name": "day", "label": "Day", "count": 24},
        {"name": "hour", "label": "Hour", "count": 60},
        {"name": "minute", "label": "Minute"},
    ],
}

OLD_DEFAULT_CALENDAR_JSON = json.dumps(OLD_DEFAULT_CALENDAR, ensure_ascii=True)
NEW_DEFAULT_CALENDAR_JSON = json.dumps(NEW_DEFAULT_CALENDAR, ensure_ascii=True)


def _set_calendar_default(calendar_json: str) -> None:
    op.alter_column(
        "timelines",
        "calendar",
        existing_type=JSONB,
        nullable=False,
        server_default=sa.text(f"'{calendar_json}'::jsonb"),
    )


def upgrade() -> None:
    _set_calendar_default(NEW_DEFAULT_CALENDAR_JSON)


def downgrade() -> None:
    _set_calendar_default(OLD_DEFAULT_CALENDAR_JSON)
