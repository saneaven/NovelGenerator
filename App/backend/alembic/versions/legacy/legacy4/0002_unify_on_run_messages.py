"""Unify on run_messages as single message store.

Drop agent_messages table entirely. Replace run_messages.content_parts +
run_messages.thinking_details with a single JSONB `data` column keyed by
language. Redirect agent memory FKs to run_messages. Remove
agents.next_message_seq.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "0002_unify_on_run_messages"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. Add `data` JSONB column to run_messages and backfill from existing columns
    if "run_messages" in tables:
        rm_cols = {c["name"] for c in inspector.get_columns("run_messages")}

        if "data" not in rm_cols:
            op.add_column("run_messages", sa.Column("data", sa.dialects.postgresql.JSONB(), nullable=True))

            # Backfill: build { <run.language>: { "contentParts": content_parts, "thinkingDetails": thinking_details } }
            if "content_parts" in rm_cols:
                op.execute(
                    """
                    UPDATE run_messages rm
                    SET data = jsonb_build_object(
                        ar.language,
                        jsonb_build_object(
                            'contentParts', COALESCE(rm.content_parts, '[]'::jsonb),
                            'thinkingDetails', rm.thinking_details
                        )
                    )
                    FROM agent_runs ar WHERE rm.run_id = ar.id
                    """
                )

            # Set NOT NULL after backfill
            op.execute("UPDATE run_messages SET data = '{}'::jsonb WHERE data IS NULL")
            op.alter_column("run_messages", "data", nullable=False)

        # 2. Drop old flat columns
        if "content_parts" in rm_cols:
            op.drop_column("run_messages", "content_parts")
        if "thinking_details" in rm_cols:
            op.drop_column("run_messages", "thinking_details")

    # 3. Wipe agent memory index (will rebuild on next archive)
    for tbl in ("agent_rag_chunks", "agent_rag_sources", "agent_memory_summaries"):
        if tbl in tables:
            op.execute(f"TRUNCATE {tbl} CASCADE")

    # 4. Redirect memory FKs from agent_messages to run_messages
    if "agent_memory_summaries" in tables:
        try:
            op.drop_constraint("agent_memory_summaries_to_message_id_fkey", "agent_memory_summaries", type_="foreignkey")
        except Exception:
            pass
        op.create_foreign_key(
            "agent_memory_summaries_to_message_id_fkey",
            "agent_memory_summaries", "run_messages",
            ["to_message_id"], ["id"],
            ondelete="CASCADE",
        )

    if "agent_rag_sources" in tables:
        try:
            op.drop_constraint("agent_rag_sources_message_id_fkey", "agent_rag_sources", type_="foreignkey")
        except Exception:
            pass
        op.create_foreign_key(
            "agent_rag_sources_message_id_fkey",
            "agent_rag_sources", "run_messages",
            ["message_id"], ["id"],
            ondelete="CASCADE",
        )

    # 5. Reset archive boundaries (old IDs pointed at agent_messages rows)
    if "agents" in tables:
        op.execute("UPDATE agents SET archived_until_message_id = NULL")

    # 6. Drop agents.next_message_seq
    if "agents" in tables:
        agent_cols = {c["name"] for c in inspector.get_columns("agents")}
        if "next_message_seq" in agent_cols:
            op.drop_column("agents", "next_message_seq")

    # 7. Drop agent_messages table
    if "agent_messages" in tables:
        op.drop_table("agent_messages")


def downgrade() -> None:
    # This migration is destructive (drops agent_messages data).
    # Downgrade is not supported — restore from backup if needed.
    raise NotImplementedError("Downgrade not supported for this migration. Restore from backup.")
