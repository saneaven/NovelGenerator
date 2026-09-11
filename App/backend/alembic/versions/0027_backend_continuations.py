"""Persist server-owned automatic approval and continuation work.

Revision ID: 0027_backend_continuations
Revises: 0026_image_prompt_formats
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0027_backend_continuations"
down_revision = "0026_image_prompt_formats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("run_messages", sa.Column("is_streaming", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "runtime_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_runtime_events_user_id", "runtime_events", ["user_id", "id"])
    op.create_index("ix_runtime_events_thread_id", "runtime_events", ["thread_id", "id"])
    op.create_index("ix_runtime_events_created", "runtime_events", ["created_at"])
    op.create_table(
        "run_continuations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assistant_message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("run_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("owner", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("next_check_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("run_id", "assistant_message_id", name="uq_run_continuation_response"),
        sa.CheckConstraint("state IN ('pending','applying','started','done')", name="ck_run_continuation_state"),
    )
    op.create_index("ix_run_continuations_due", "run_continuations", ["state", "next_check_at"])
    # Pick up existing waiting work, but never revive completed, stopped or failed runs.
    op.execute("""
        INSERT INTO run_continuations (id, thread_id, run_id, assistant_message_id)
        SELECT m.id, t.id, r.id, m.id
        FROM threads t JOIN runs r ON r.thread_id = t.id
        JOIN LATERAL (
            SELECT id FROM run_messages
            WHERE run_id = r.id AND role = 'assistant' ORDER BY seq DESC LIMIT 1
        ) m ON true
        WHERE r.status IN ('waiting', 'processing', 'ready')
          AND NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.thread_id = t.id AND newer.run_seq > r.run_seq)
          AND EXISTS (SELECT 1 FROM run_tool_calls tc WHERE tc.assistant_message_id = m.id)
    """)


def downgrade() -> None:
    op.drop_table("run_continuations")
    op.drop_table("runtime_events")
    op.drop_column("run_messages", "is_streaming")
