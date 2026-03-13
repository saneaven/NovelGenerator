"""Notification-first journeys, polymorphic thread parents, and source notifications."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0004_user_scoped_notifications"
down_revision = "0003_mcp_support"
branch_labels = None
depends_on = None


def _has_table(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _has_column(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _has_index(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "journeys"):
        op.create_table(
            "journeys",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("kind", sa.String(length=40), nullable=False),
            sa.Column("display_label", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint(
                "kind IN ('manuscriptEdit','outlineEdit','storyObjectEdit','objectTranslation','imagePrompt','sceneImagePrompt','messageTranslation')",
                name="ck_journeys_kind",
            ),
            sa.CheckConstraint(
                "status IN ('running','waiting','processing','paused','done','error','canceled')",
                name="ck_journeys_status",
            ),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_journeys_project_status", "journeys", ["project_id", "status"], unique=False)
        op.create_index("ix_journeys_user_project_updated", "journeys", ["user_id", "project_id", "updated_at"], unique=False)

    if not _has_column(inspector, "threads", "parent_id"):
        op.add_column("threads", sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True))
    if _has_column(inspector, "threads", "owner_id"):
        op.execute("UPDATE threads SET parent_id = owner_id WHERE parent_id IS NULL")
    op.alter_column("threads", "parent_id", nullable=False)

    if _has_index(inspector, "threads", "ix_threads_owner"):
        op.drop_index("ix_threads_owner", table_name="threads")
    if not _has_index(inspector, "threads", "ix_threads_parent"):
        op.create_index("ix_threads_parent", "threads", ["parent_id"], unique=False)
    if not _has_index(inspector, "threads", "uq_threads_agent_parent"):
        op.create_index(
            "uq_threads_agent_parent",
            "threads",
            ["parent_id"],
            unique=True,
            postgresql_where=sa.text("thread_type = 'agent'"),
        )
    if not _has_index(inspector, "threads", "uq_threads_journey_parent"):
        op.create_index(
            "uq_threads_journey_parent",
            "threads",
            ["parent_id"],
            unique=True,
            postgresql_where=sa.text("thread_type = 'journey'"),
        )
    if _has_column(inspector, "threads", "owner_id"):
        op.drop_column("threads", "owner_id")
    if _has_column(inspector, "threads", "journey_kind"):
        op.drop_column("threads", "journey_kind")
    if _has_column(inspector, "threads", "display_label"):
        op.drop_column("threads", "display_label")

    if _has_table(inspector, "notifications"):
        op.drop_table("notifications")
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("warning", sa.Text(), nullable=True),
        sa.Column("progress_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("custom_slot_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("target_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("meta_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("important", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("source_kind IN ('journey','imageRun','system')", name="ck_notifications_source_kind"),
        sa.CheckConstraint(
            "status IN ('running','pending','success','error','cancelled')",
            name="ck_notifications_status",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "source_kind", "source_id", name="uq_notifications_user_source"),
    )
    op.create_index("ix_notifications_project_id", "notifications", ["project_id"], unique=False)
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)
    op.create_index("ix_notifications_source", "notifications", ["source_kind", "source_id"], unique=False)
    op.create_index(
        "ix_notifications_user_order",
        "notifications",
        ["user_id", "important", "is_read", "updated_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_user_project",
        "notifications",
        ["user_id", "project_id", "updated_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_project", table_name="notifications")
    op.drop_index("ix_notifications_user_order", table_name="notifications")
    op.drop_index("ix_notifications_source", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_index("ix_notifications_project_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("uq_threads_journey_parent", table_name="threads")
    op.drop_index("uq_threads_agent_parent", table_name="threads")
    op.drop_index("ix_threads_parent", table_name="threads")
    op.add_column("threads", sa.Column("display_label", sa.String(length=255), nullable=True))
    op.add_column("threads", sa.Column("journey_kind", sa.String(length=40), nullable=True))
    op.add_column("threads", sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE threads SET owner_id = parent_id")
    op.drop_column("threads", "parent_id")
    op.drop_index("ix_journeys_user_project_updated", table_name="journeys")
    op.drop_index("ix_journeys_project_status", table_name="journeys")
    op.drop_table("journeys")
