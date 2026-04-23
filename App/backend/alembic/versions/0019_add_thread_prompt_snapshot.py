"""Add thread prompt snapshot column.

Revision 0018 was already applied in some environments before the thread
snapshot column replaced the older cache-plan column in application code.
This revision makes that schema change explicit without rewriting applied
migration history.
"""

from __future__ import annotations

from alembic import op


revision = "0019_add_thread_prompt_snapshot"
down_revision = "0018_llm_prompt_caching"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE threads ADD COLUMN IF NOT EXISTS captured_prompt_snapshot JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE threads DROP COLUMN IF EXISTS captured_prompt_snapshot")
