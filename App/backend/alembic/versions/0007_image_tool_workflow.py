"""Add image tool preview ownership and working status.

Adds:
- assets.preview_tool_call_id for hidden preview assets owned by a tool call
- run_tool_calls.status check-constraint support for 'working'
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007_image_tool_workflow"
down_revision = "0006_add_run_input_payload"


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column("preview_tool_call_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_assets_preview_tool_call_id", "assets", ["preview_tool_call_id"])
    op.create_foreign_key(
        "fk_assets_preview_tool_call_id",
        "assets",
        "run_tool_calls",
        ["preview_tool_call_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("ck_run_tool_calls_status", "run_tool_calls", type_="check")
    op.create_check_constraint(
        "ck_run_tool_calls_status",
        "run_tool_calls",
        "status IN ('streaming','validating','pending','processing','working','failed','rejected','applied')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_run_tool_calls_status", "run_tool_calls", type_="check")
    op.create_check_constraint(
        "ck_run_tool_calls_status",
        "run_tool_calls",
        "status IN ('streaming','validating','pending','processing','failed','rejected','applied')",
    )

    op.drop_constraint("fk_assets_preview_tool_call_id", "assets", type_="foreignkey")
    op.drop_index("ix_assets_preview_tool_call_id", table_name="assets")
    op.drop_column("assets", "preview_tool_call_id")
