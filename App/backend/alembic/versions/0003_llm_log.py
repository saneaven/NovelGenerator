"""Add llm_logs table and llm_log_bytes storage column."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0003_llm_log"
down_revision = "0002_agent_notification"
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.scalar() is not None


def upgrade() -> None:
    conn = op.get_bind()

    # llm_logs table — may already exist on fresh installs via Base.metadata.create_all()
    if not conn.dialect.has_table(conn, "llm_logs"):
        op.create_table(
            "llm_logs",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("provider", sa.String(50), nullable=False),
            sa.Column("model", sa.String(200), nullable=False),
            sa.Column("raw_input", JSONB, nullable=False),
            sa.Column("raw_output", JSONB, nullable=True),
            sa.Column("error", sa.Text, nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime, nullable=True),
            sa.Column("meta", JSONB, nullable=True),
        )
        op.create_index("ix_llm_logs_user_created", "llm_logs", ["user_id", sa.text("created_at DESC")])

    # llm_log_bytes on project_storage_usage
    if not _column_exists(conn, "project_storage_usage", "llm_log_bytes"):
        op.add_column(
            "project_storage_usage",
            sa.Column("llm_log_bytes", sa.BigInteger, nullable=False, server_default="0"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _column_exists(conn, "project_storage_usage", "llm_log_bytes"):
        op.drop_column("project_storage_usage", "llm_log_bytes")
    if conn.dialect.has_table(conn, "llm_logs"):
        op.drop_table("llm_logs")
