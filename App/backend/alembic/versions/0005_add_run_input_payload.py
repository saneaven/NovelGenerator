"""Add input_payload column to runs table.

Persists the payload sent with the initial user message so it can be
restored when a run is resumed.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005_add_run_input_payload"
down_revision = "0004_remove_prefill"


def upgrade() -> None:
    op.add_column("runs", sa.Column("input_payload", JSONB, nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("runs", "input_payload")
