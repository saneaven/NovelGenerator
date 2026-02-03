"""Sub Agents: rename sub_agent_id -> agent_name and add allowed_sub_agent_ids.

This migration intentionally keeps the unique constraint name the same
(`uq_sub_agent_per_preset`) while changing the column name; PostgreSQL updates
the underlying constraint definition automatically on column rename.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0003_sub_agent_agent_name_ids"
down_revision = "0002_sub_agent_definitions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("sub_agent_definitions"):
        return

    columns = {c["name"] for c in inspector.get_columns("sub_agent_definitions")}

    # 1) Add allowlist for calling other Sub Agents (stored as UUID strings in JSONB).
    if "allowed_sub_agent_ids" not in columns:
        op.add_column(
            "sub_agent_definitions",
            sa.Column(
                "allowed_sub_agent_ids",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
        # Optional: remove default now that existing rows are backfilled
        op.alter_column("sub_agent_definitions", "allowed_sub_agent_ids", server_default=None)

    # 2) Rename stable key column to reflect its true meaning:
    # - prompt_name key for Sub Agent templates
    # - suffix for call_{agent_name}
    if "sub_agent_id" in columns and "agent_name" not in columns:
        op.alter_column("sub_agent_definitions", "sub_agent_id", new_column_name="agent_name")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("sub_agent_definitions"):
        return

    columns = {c["name"] for c in inspector.get_columns("sub_agent_definitions")}

    if "agent_name" in columns and "sub_agent_id" not in columns:
        op.alter_column("sub_agent_definitions", "agent_name", new_column_name="sub_agent_id")
    if "allowed_sub_agent_ids" in columns:
        op.drop_column("sub_agent_definitions", "allowed_sub_agent_ids")
