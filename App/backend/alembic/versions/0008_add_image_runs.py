"""Add image runs and replace tool-call preview ownership.

Adds:
- image_runs table
- run_tool_calls.image_run_id
- assets.preview_image_run_id

Removes:
- assets.preview_tool_call_id
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008_add_image_runs"
down_revision = "0007_image_tool_workflow"


def upgrade() -> None:
    op.create_table(
        "image_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("client_request_id", sa.String(length=128), nullable=True),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("review_mode", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("stage", sa.String(length=20), nullable=True),
        sa.Column("request_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("preview_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("final_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("resolved_ratio", sa.String(length=32), nullable=True),
        sa.Column("resolved_size", sa.String(length=32), nullable=True),
        sa.Column("revised_prompt", sa.Text(), nullable=True),
        sa.Column("before_excerpt", sa.Text(), nullable=True),
        sa.Column("after_excerpt", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=120), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("origin IN ('direct','tool_preview')", name="ck_image_runs_origin"),
        sa.CheckConstraint("review_mode IN ('auto','manual')", name="ck_image_runs_review_mode"),
        sa.CheckConstraint(
            "status IN ('queued','running','review','applying','applied','rejected','failed','cancelled')",
            name="ck_image_runs_status",
        ),
        sa.CheckConstraint(
            "stage IS NULL OR stage IN ('preparing','generating','saving','binding')",
            name="ck_image_runs_stage",
        ),
    )
    op.create_index("ix_image_runs_project_status", "image_runs", ["project_id", "status"])
    op.create_index("ix_image_runs_thread_created", "image_runs", ["thread_id", "created_at"])
    op.create_index("ix_image_runs_client_request_id", "image_runs", ["client_request_id"])
    op.create_index("ix_image_runs_preview_asset_id", "image_runs", ["preview_asset_id"])
    op.create_index("ix_image_runs_final_asset_id", "image_runs", ["final_asset_id"])

    op.add_column(
        "run_tool_calls",
        sa.Column("image_run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_run_tool_calls_image_run_id", "run_tool_calls", ["image_run_id"])
    op.create_foreign_key(
        "fk_run_tool_calls_image_run_id",
        "run_tool_calls",
        "image_runs",
        ["image_run_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "assets",
        sa.Column("preview_image_run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_assets_preview_image_run_id", "assets", ["preview_image_run_id"])
    op.create_foreign_key(
        "fk_assets_preview_image_run_id",
        "assets",
        "image_runs",
        ["preview_image_run_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("fk_assets_preview_tool_call_id", "assets", type_="foreignkey")
    op.drop_index("ix_assets_preview_tool_call_id", table_name="assets")
    op.drop_column("assets", "preview_tool_call_id")


def downgrade() -> None:
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

    op.drop_constraint("fk_assets_preview_image_run_id", "assets", type_="foreignkey")
    op.drop_index("ix_assets_preview_image_run_id", table_name="assets")
    op.drop_column("assets", "preview_image_run_id")

    op.drop_constraint("fk_run_tool_calls_image_run_id", "run_tool_calls", type_="foreignkey")
    op.drop_index("ix_run_tool_calls_image_run_id", table_name="run_tool_calls")
    op.drop_column("run_tool_calls", "image_run_id")

    op.drop_index("ix_image_runs_final_asset_id", table_name="image_runs")
    op.drop_index("ix_image_runs_preview_asset_id", table_name="image_runs")
    op.drop_index("ix_image_runs_client_request_id", table_name="image_runs")
    op.drop_index("ix_image_runs_thread_created", table_name="image_runs")
    op.drop_index("ix_image_runs_project_status", table_name="image_runs")
    op.drop_table("image_runs")
