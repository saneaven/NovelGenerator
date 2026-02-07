"""Make Sub Agent description required (non-null).

Ensures existing rows have a non-empty description (fallback to display_name),
then sets the column to NOT NULL.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_sub_agent_desc_required"
down_revision = "0003_sub_agent_agent_name_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("sub_agent_definitions"):
        return

    # Backfill missing/empty descriptions.
    op.execute(
        """
        UPDATE sub_agent_definitions
        SET description = display_name
        WHERE description IS NULL OR trim(description) = ''
        """
    )

    columns = {c["name"]: c for c in inspector.get_columns("sub_agent_definitions")}
    desc_col = columns.get("description")
    if not desc_col:
        return

    if desc_col.get("nullable", True):
        op.alter_column("sub_agent_definitions", "description", nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("sub_agent_definitions"):
        return

    columns = {c["name"]: c for c in inspector.get_columns("sub_agent_definitions")}
    desc_col = columns.get("description")
    if not desc_col:
        return

    if not desc_col.get("nullable", False):
        op.alter_column("sub_agent_definitions", "description", nullable=True)
