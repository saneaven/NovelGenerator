"""Add sub agent definitions table.

Notes:
- The baseline migration uses `Base.metadata.create_all()` and may already create
  this table for fresh installs. This migration is therefore written to be
  idempotent (no-op if the table already exists).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0002_sub_agent_definitions"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("sub_agent_definitions"):
        return

    op.create_table(
        "sub_agent_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "preset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("prompt_presets.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("agent_name", sa.String(length=50), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("allowed_agent_modes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("allowed_tool_names", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("allowed_sub_agent_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("llm_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("preset_id", "agent_name", name="uq_sub_agent_per_preset"),
    )
    op.create_index("idx_sub_agent_preset", "sub_agent_definitions", ["preset_id"])

    # Optional: remove defaults now that the table is created
    op.alter_column("sub_agent_definitions", "enabled", server_default=None)
    op.alter_column("sub_agent_definitions", "allowed_sub_agent_ids", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("sub_agent_definitions"):
        return

    op.drop_index("idx_sub_agent_preset", table_name="sub_agent_definitions")
    op.drop_table("sub_agent_definitions")
