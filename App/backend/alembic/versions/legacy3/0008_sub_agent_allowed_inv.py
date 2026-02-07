"""Rename sub_agent_definitions.allowed_agent_modes -> allowed_invocation_modes.

No legacy compatibility / transforms:
- We keep existing JSON values as-is and only rename the column.
- If the old column is missing, this is a no-op (idempotent).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_sub_agent_allowed_inv"
down_revision = "0007_drop_user_settings_ui_lang"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("sub_agent_definitions"):
        return

    cols = {c["name"] for c in inspector.get_columns("sub_agent_definitions")}
    if "allowed_invocation_modes" in cols:
        return
    if "allowed_agent_modes" not in cols:
        return

    op.alter_column(
        "sub_agent_definitions",
        "allowed_agent_modes",
        new_column_name="allowed_invocation_modes",
    )


def downgrade() -> None:
    # Irreversible cleanup for early-stage schema refactor.
    return

