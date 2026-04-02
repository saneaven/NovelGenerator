"""Replace llm_logs with llm_requests."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0009_llm_requests"
down_revision = "0008_regex_search_cutover"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    if conn.dialect.has_table(conn, "llm_logs"):
        op.drop_table("llm_logs")

    if not conn.dialect.has_table(conn, "llm_requests"):
        op.create_table(
            "llm_requests",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("request_id", sa.String(40), nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("thread_id", UUID(as_uuid=True), nullable=False),
            sa.Column("run_id", UUID(as_uuid=True), nullable=False),
            sa.Column("assistant_message_id", UUID(as_uuid=True), nullable=False),
            sa.Column("provider", sa.String(50), nullable=False),
            sa.Column("model", sa.String(200), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="running"),
            sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("raw_input", JSONB, nullable=True),
            sa.Column("raw_output", JSONB, nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("meta", JSONB, nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("request_id", name="uq_llm_requests_request_id"),
            sa.UniqueConstraint("assistant_message_id", name="uq_llm_requests_assistant_message_id"),
        )
        op.create_index("ix_llm_requests_user_created", "llm_requests", ["user_id", sa.text("created_at DESC")])
        op.create_index("ix_llm_requests_run_id", "llm_requests", ["run_id"])
        op.create_index("ix_llm_requests_thread_id", "llm_requests", ["thread_id"])


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.has_table(conn, "llm_requests"):
        op.drop_table("llm_requests")
