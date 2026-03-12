"""Add MCP server support."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_mcp_support"
down_revision = "0002_run_message_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sub_agent_definitions",
        sa.Column(
            "allowed_mcp_server_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    op.create_table(
        "mcp_servers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("preset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("server_url", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("allow_agent_mode", sa.Boolean(), nullable=False),
        sa.Column("allow_plan_mode", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["preset_id"], ["prompt_presets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("preset_id", "server_key", name="uq_mcp_server_preset_key"),
    )
    op.create_index(op.f("ix_mcp_servers_preset_id"), "mcp_servers", ["preset_id"], unique=False)
    op.create_index(op.f("ix_mcp_servers_user_id"), "mcp_servers", ["user_id"], unique=False)
    op.create_index("idx_mcp_servers_preset", "mcp_servers", ["preset_id"], unique=False)

    op.create_table(
        "mcp_server_secrets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("auth_kind", sa.String(length=20), nullable=False),
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["server_id"], ["mcp_servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("server_id"),
    )
    op.create_index(op.f("ix_mcp_server_secrets_server_id"), "mcp_server_secrets", ["server_id"], unique=True)

    op.create_table(
        "mcp_server_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("protocol_version", sa.String(length=32), nullable=True),
        sa.Column(
            "server_info_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "capabilities_raw_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "catalog_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["server_id"], ["mcp_servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("server_id"),
    )
    op.create_index(op.f("ix_mcp_server_snapshots_server_id"), "mcp_server_snapshots", ["server_id"], unique=True)

    op.add_column(
        "runs",
        sa.Column(
            "mcp_request_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{\"selections\": []}'::jsonb"),
        ),
    )
    op.add_column(
        "runs",
        sa.Column(
            "mcp_resolution_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text(
                "'{\"system_overlays\": [], \"injected_messages\": [], \"user_message_parts\": [], \"template_contexts\": [], \"tool_server_ids\": [], \"audit\": []}'::jsonb"
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("runs", "mcp_resolution_json")
    op.drop_column("runs", "mcp_request_json")

    op.drop_index(op.f("ix_mcp_server_snapshots_server_id"), table_name="mcp_server_snapshots")
    op.drop_table("mcp_server_snapshots")

    op.drop_index(op.f("ix_mcp_server_secrets_server_id"), table_name="mcp_server_secrets")
    op.drop_table("mcp_server_secrets")

    op.drop_index("idx_mcp_servers_preset", table_name="mcp_servers")
    op.drop_index(op.f("ix_mcp_servers_user_id"), table_name="mcp_servers")
    op.drop_index(op.f("ix_mcp_servers_preset_id"), table_name="mcp_servers")
    op.drop_table("mcp_servers")

    op.drop_column("sub_agent_definitions", "allowed_mcp_server_ids")
