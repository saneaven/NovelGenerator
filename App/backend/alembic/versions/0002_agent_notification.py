"""Add 'agent' to notifications source_kind check constraint."""

from __future__ import annotations

from alembic import op


revision = "0002_agent_notification"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_notifications_source_kind", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_source_kind",
        "notifications",
        "source_kind IN ('journey','imageRun','system','agent','subAgent')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_notifications_source_kind", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_source_kind",
        "notifications",
        "source_kind IN ('journey','imageRun','system')",
    )
