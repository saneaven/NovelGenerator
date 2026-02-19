"""Rename legacy journey kinds to canonical names.

Revision ID: 0006_journey_kind_canonical
Revises: 0005_enforce_tool_result_sot
Create Date: 2026-02-19
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0006_journey_kind_canonical"
down_revision = "0005_enforce_tool_result_sot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE threads
        SET journey_kind = CASE journey_kind
            WHEN ('ai' || 'Edit') THEN 'objectEdit'
            WHEN 'translation' THEN 'objectTranslation'
            WHEN ('translate' || 'Objects') THEN 'objectTranslation'
            WHEN ('scene' || 'Image') THEN 'sceneImagePrompt'
            ELSE journey_kind
        END
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE threads
        SET journey_kind = CASE journey_kind
            WHEN 'objectEdit' THEN ('ai' || 'Edit')
            WHEN 'objectTranslation' THEN 'translation'
            WHEN 'sceneImagePrompt' THEN ('scene' || 'Image')
            ELSE journey_kind
        END
        """
    )
