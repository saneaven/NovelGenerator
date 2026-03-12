"""Add run message attachments."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_run_message_attachments"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "run_message_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('image','document')", name="ck_run_message_attachments_kind"),
        sa.ForeignKeyConstraint(["message_id"], ["run_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "sort_order", name="uq_run_message_attachments_message_sort"),
    )
    op.create_index(op.f("ix_run_message_attachments_message_id"), "run_message_attachments", ["message_id"], unique=False)
    op.create_index(op.f("ix_run_message_attachments_project_id"), "run_message_attachments", ["project_id"], unique=False)
    op.create_index(op.f("ix_run_message_attachments_run_id"), "run_message_attachments", ["run_id"], unique=False)
    op.create_index(op.f("ix_run_message_attachments_thread_id"), "run_message_attachments", ["thread_id"], unique=False)
    op.create_index("ix_run_message_attachments_thread_created", "run_message_attachments", ["thread_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_run_message_attachments_thread_created", table_name="run_message_attachments")
    op.drop_index(op.f("ix_run_message_attachments_thread_id"), table_name="run_message_attachments")
    op.drop_index(op.f("ix_run_message_attachments_run_id"), table_name="run_message_attachments")
    op.drop_index(op.f("ix_run_message_attachments_project_id"), table_name="run_message_attachments")
    op.drop_index(op.f("ix_run_message_attachments_message_id"), table_name="run_message_attachments")
    op.drop_table("run_message_attachments")
