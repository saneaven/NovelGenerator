"""Add notifications table.

Revision ID: 0007_add_notifications
Revises: 0006_journey_kind_canonical
Create Date: 2026-02-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0007_add_notifications"
down_revision = "0006_journey_kind_canonical"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_ref_id", sa.String(length=128), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("warning", sa.Text(), nullable=True),
        sa.Column("progress_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("custom_slot_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("meta_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("source IN ('journey','imageTask')", name="ck_notifications_source"),
        sa.CheckConstraint(
            "status IN ('running','pending','success','error','cancelled')",
            name="ck_notifications_status",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "project_id", "source", "source_ref_id", name="uq_notifications_source_ref"),
    )

    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)
    op.create_index("ix_notifications_project_id", "notifications", ["project_id"], unique=False)
    op.create_index("ix_notifications_thread_id", "notifications", ["thread_id"], unique=False)
    op.create_index("ix_notifications_project_read", "notifications", ["user_id", "project_id", "is_read"], unique=False)
    op.execute(
        "CREATE INDEX ix_notifications_project_order ON notifications (user_id, project_id, updated_at DESC, id DESC)"
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_project_order", table_name="notifications")
    op.drop_index("ix_notifications_project_read", table_name="notifications")
    op.drop_index("ix_notifications_thread_id", table_name="notifications")
    op.drop_index("ix_notifications_project_id", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
