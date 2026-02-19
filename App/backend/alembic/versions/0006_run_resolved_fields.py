"""Add resolved_output_mode and resolved_toolset to runs.

Revision ID: 0006_run_resolved_fields
Revises: 0005_enforce_tool_result_sot
Create Date: 2026-02-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_run_resolved_fields"
down_revision = "0005_enforce_tool_result_sot"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(c.get("name") == column for c in inspector.get_columns(table))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not _has_column(inspector, "runs", "resolved_output_mode"):
        op.add_column(
            "runs",
            sa.Column("resolved_output_mode", sa.String(20), nullable=False, server_default="tool_call"),
        )

    if not _has_column(inspector, "runs", "resolved_toolset"):
        op.add_column(
            "runs",
            sa.Column("resolved_toolset", sa.String(40), nullable=False, server_default="agent_agent_mode"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if _has_column(inspector, "runs", "resolved_toolset"):
        op.drop_column("runs", "resolved_toolset")

    if _has_column(inspector, "runs", "resolved_output_mode"):
        op.drop_column("runs", "resolved_output_mode")
