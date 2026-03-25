"""Add timeline tables."""

from __future__ import annotations

import json
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0005_timeline"
down_revision = "0004_sub_agent_tool_grants"
branch_labels = None
depends_on = None


TIMELINE_DEFAULT_CALENDAR_JSON = json.dumps(
    {
        "units": [
            {"name": "year", "label": "Year", "count": 12},
            {"name": "month", "label": "Month", "count": 30},
            {"name": "day", "label": "Day", "count": 24},
            {"name": "hour", "label": "Hour"},
        ]
    },
    ensure_ascii=True,
)


def upgrade() -> None:
    conn = op.get_bind()

    if not conn.dialect.has_table(conn, "timelines"):
        op.create_table(
            "timelines",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column(
                "calendar",
                JSONB,
                nullable=False,
                server_default=sa.text(f"'{TIMELINE_DEFAULT_CALENDAR_JSON}'::jsonb"),
            ),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )

    if not conn.dialect.has_table(conn, "timeline_tracks"):
        op.create_table(
            "timeline_tracks",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("timeline_id", UUID(as_uuid=True), sa.ForeignKey("timelines.id", ondelete="CASCADE"), nullable=False),
            sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("timeline_tracks.id", ondelete="CASCADE"), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("color", sa.String(length=20), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint("position >= 0", name="ck_timeline_tracks_position_non_negative"),
        )
        op.create_index("ix_timeline_tracks_timeline_id", "timeline_tracks", ["timeline_id"])
        op.create_index("ix_timeline_tracks_parent_id", "timeline_tracks", ["parent_id"])
        op.create_index(
            "ix_timeline_tracks_timeline_parent_position",
            "timeline_tracks",
            ["timeline_id", "parent_id", "position"],
        )

    if not conn.dialect.has_table(conn, "timeline_events"):
        op.create_table(
            "timeline_events",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("track_id", UUID(as_uuid=True), sa.ForeignKey("timeline_tracks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("start_date", JSONB, nullable=False),
            sa.Column("end_date", JSONB, nullable=True),
            sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_timeline_events_track_id", "timeline_events", ["track_id"])

    if not conn.dialect.has_table(conn, "timeline_event_links"):
        op.create_table(
            "timeline_event_links",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("event_id", UUID(as_uuid=True), sa.ForeignKey("timeline_events.id", ondelete="CASCADE"), nullable=False),
            sa.Column("object_type", sa.String(length=50), nullable=False),
            sa.Column("object_id", UUID(as_uuid=True), nullable=False),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("event_id", "object_type", "object_id", name="uq_timeline_event_link_target"),
        )
        op.create_index("ix_timeline_event_links_event_id", "timeline_event_links", ["event_id"])
        op.create_index("ix_timeline_event_links_object_id", "timeline_event_links", ["object_id"])
        op.create_index(
            "ix_timeline_event_links_object_target",
            "timeline_event_links",
            ["object_type", "object_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.has_table(conn, "timeline_event_links"):
        op.drop_table("timeline_event_links")
    if conn.dialect.has_table(conn, "timeline_events"):
        op.drop_table("timeline_events")
    if conn.dialect.has_table(conn, "timeline_tracks"):
        op.drop_table("timeline_tracks")
    if conn.dialect.has_table(conn, "timelines"):
        op.drop_table("timelines")
