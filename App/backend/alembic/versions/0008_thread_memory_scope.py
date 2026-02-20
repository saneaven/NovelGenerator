"""Scope message memory tables to thread.

Revision ID: 0008_thread_memory_scope
Revises: 0007_add_notifications
Create Date: 2026-02-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_thread_memory_scope"
down_revision = "0007_add_notifications"
branch_labels = None
depends_on = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table_name)}


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {idx["name"] for idx in inspector.get_indexes(table_name)}


def _unique_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {uq["name"] for uq in inspector.get_unique_constraints(table_name) if uq.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    summary_cols = _column_names(inspector, "message_memory_summaries")
    source_cols = _column_names(inspector, "message_rag_sources")

    # Fresh installs from baseline already have thread-scoped schema.
    if (
        "thread_id" in summary_cols
        and "owner_id" not in summary_cols
        and "to_seq_in_thread" in summary_cols
        and "thread_id" in source_cols
        and "owner_id" not in source_cols
    ):
        return

    # Rename owner scope to thread scope.
    if "owner_id" in summary_cols and "thread_id" not in summary_cols:
        op.alter_column("message_memory_summaries", "owner_id", new_column_name="thread_id")
    if "owner_id" in source_cols and "thread_id" not in source_cols:
        op.alter_column("message_rag_sources", "owner_id", new_column_name="thread_id")

    # Track summary boundary in thread message ordering.
    if "to_seq_in_thread" not in summary_cols:
        op.add_column(
            "message_memory_summaries",
            sa.Column("to_seq_in_thread", sa.BigInteger(), nullable=True),
        )

    # Drop old indexes/constraints before rebuilding.
    op.execute("DROP INDEX IF EXISTS ix_message_memory_summaries_owner_to_message")
    op.execute("DROP INDEX IF EXISTS ix_message_memory_summaries_owner_id")
    op.execute("DROP INDEX IF EXISTS ix_message_rag_sources_owner_language")
    op.execute("DROP INDEX IF EXISTS ix_message_rag_sources_owner_id")
    if "uq_message_rag_source_identity" in _unique_names(inspector, "message_rag_sources"):
        op.drop_constraint("uq_message_rag_source_identity", "message_rag_sources", type_="unique")

    # Backfill thread_id and summary sequence from run_messages.
    op.execute(
        """
        UPDATE message_memory_summaries s
        SET thread_id = m.thread_id,
            to_seq_in_thread = m.seq_in_thread
        FROM run_messages m
        WHERE m.id = s.to_message_id
        """
    )
    op.execute(
        """
        UPDATE message_rag_sources s
        SET thread_id = m.thread_id
        FROM run_messages m
        WHERE m.id = s.message_id
        """
    )

    # Remove legacy rows that cannot be mapped to thread scope.
    op.execute("DELETE FROM message_memory_summaries WHERE thread_id IS NULL")
    op.execute("DELETE FROM message_rag_sources WHERE thread_id IS NULL")

    # Remove any pre-existing FK names if present.
    op.execute("ALTER TABLE message_memory_summaries DROP CONSTRAINT IF EXISTS message_memory_summaries_thread_id_fkey")
    op.execute("ALTER TABLE message_memory_summaries DROP CONSTRAINT IF EXISTS message_memory_summaries_to_message_id_fkey")
    op.execute("ALTER TABLE message_rag_sources DROP CONSTRAINT IF EXISTS message_rag_sources_thread_id_fkey")
    op.execute("ALTER TABLE message_rag_sources DROP CONSTRAINT IF EXISTS message_rag_sources_message_id_fkey")

    # Enforce thread/message referential integrity.
    op.create_foreign_key(
        "message_memory_summaries_thread_id_fkey",
        "message_memory_summaries",
        "threads",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "message_memory_summaries_to_message_id_fkey",
        "message_memory_summaries",
        "run_messages",
        ["to_message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "message_rag_sources_thread_id_fkey",
        "message_rag_sources",
        "threads",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "message_rag_sources_message_id_fkey",
        "message_rag_sources",
        "run_messages",
        ["message_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Rebuild thread-scoped indexes/constraints.
    idx_summary = _index_names(inspector, "message_memory_summaries")
    if "ix_message_memory_summaries_thread_id" not in idx_summary:
        op.create_index("ix_message_memory_summaries_thread_id", "message_memory_summaries", ["thread_id"])
    if "ix_message_memory_summaries_thread_to_message" not in idx_summary:
        op.create_index(
            "ix_message_memory_summaries_thread_to_message",
            "message_memory_summaries",
            ["thread_id", "to_message_id"],
        )
    if "ix_message_memory_summaries_thread_to_seq" not in idx_summary:
        op.create_index(
            "ix_message_memory_summaries_thread_to_seq",
            "message_memory_summaries",
            ["thread_id", "to_seq_in_thread"],
        )

    idx_sources = _index_names(inspector, "message_rag_sources")
    if "ix_message_rag_sources_thread_id" not in idx_sources:
        op.create_index("ix_message_rag_sources_thread_id", "message_rag_sources", ["thread_id"])
    if "ix_message_rag_sources_thread_language" not in idx_sources:
        op.create_index(
            "ix_message_rag_sources_thread_language",
            "message_rag_sources",
            ["thread_id", "language"],
        )
    op.create_unique_constraint(
        "uq_message_rag_source_identity",
        "message_rag_sources",
        ["user_id", "thread_id", "message_id", "language"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    summary_cols = _column_names(inspector, "message_memory_summaries")
    source_cols = _column_names(inspector, "message_rag_sources")
    if "owner_id" in summary_cols and "owner_id" in source_cols:
        return

    # Drop thread-scoped constraints/indexes first.
    op.drop_constraint("uq_message_rag_source_identity", "message_rag_sources", type_="unique")
    op.drop_index("ix_message_rag_sources_thread_language", table_name="message_rag_sources")
    op.drop_index("ix_message_rag_sources_thread_id", table_name="message_rag_sources")

    op.drop_index("ix_message_memory_summaries_thread_to_seq", table_name="message_memory_summaries")
    op.drop_index("ix_message_memory_summaries_thread_to_message", table_name="message_memory_summaries")
    op.drop_index("ix_message_memory_summaries_thread_id", table_name="message_memory_summaries")

    op.drop_constraint("message_rag_sources_message_id_fkey", "message_rag_sources", type_="foreignkey")
    op.drop_constraint("message_rag_sources_thread_id_fkey", "message_rag_sources", type_="foreignkey")
    op.drop_constraint("message_memory_summaries_to_message_id_fkey", "message_memory_summaries", type_="foreignkey")
    op.drop_constraint("message_memory_summaries_thread_id_fkey", "message_memory_summaries", type_="foreignkey")

    # Restore owner-scoped names.
    op.drop_column("message_memory_summaries", "to_seq_in_thread")
    op.alter_column("message_rag_sources", "thread_id", new_column_name="owner_id")
    op.alter_column("message_memory_summaries", "thread_id", new_column_name="owner_id")

    # Restore previous indexes/constraint shape.
    op.create_index("ix_message_memory_summaries_owner_id", "message_memory_summaries", ["owner_id"])
    op.create_index(
        "ix_message_memory_summaries_owner_to_message",
        "message_memory_summaries",
        ["owner_id", "to_message_id"],
    )
    op.create_index("ix_message_rag_sources_owner_id", "message_rag_sources", ["owner_id"])
    op.create_index(
        "ix_message_rag_sources_owner_language",
        "message_rag_sources",
        ["owner_id", "language"],
    )
    op.create_unique_constraint(
        "uq_message_rag_source_identity",
        "message_rag_sources",
        ["user_id", "owner_id", "message_id", "language"],
    )
