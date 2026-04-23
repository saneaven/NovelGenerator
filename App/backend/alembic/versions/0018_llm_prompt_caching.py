"""Add prompt caching settings, prompt snapshots, and prompt cache artifacts."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0018_llm_prompt_caching"
down_revision = "0017_asset_requested_geometry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "llm_cache_settings",
            JSONB(),
            nullable=False,
            server_default=sa.text(
                """'{
                    "openai": {"enabled": true, "retention": "default"},
                    "claude": {"enabled": true, "ttl": "5m"},
                    "gemini": {"enabled": true, "implicit": true, "explicit": true, "explicit_ttl_preset": "1h"},
                    "xai": {"enabled": true},
                    "nanogpt": {"enabled": true, "ttl": "5m", "stickyProvider": false}
                }'::jsonb"""
            ),
        ),
    )
    op.add_column("threads", sa.Column("captured_prompt_snapshot", JSONB(), nullable=True))

    op.create_table(
        "thread_prompt_caches",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("checkpoint_id", sa.String(length=120), nullable=False),
        sa.Column("prefix_digest", sa.String(length=128), nullable=False),
        sa.Column("strategy", sa.String(length=50), nullable=False),
        sa.Column("external_handle", sa.String(length=255), nullable=True),
        sa.Column("ttl_label", sa.String(length=32), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_hit_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("meta", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("thread_id", "provider", "model", "prefix_digest", name="uq_thread_prompt_caches_prefix"),
        sa.CheckConstraint(
            "strategy IN ('logical_prefix','gemini_cached_content')",
            name="ck_thread_prompt_caches_strategy",
        ),
        sa.CheckConstraint(
            "status IN ('active','expired','error')",
            name="ck_thread_prompt_caches_status",
        ),
    )
    op.create_index(
        "ix_thread_prompt_caches_thread_provider",
        "thread_prompt_caches",
        ["thread_id", "provider"],
    )
    op.create_index(
        "ix_thread_prompt_caches_project_provider",
        "thread_prompt_caches",
        ["project_id", "provider"],
    )


def downgrade() -> None:
    op.drop_index("ix_thread_prompt_caches_project_provider", table_name="thread_prompt_caches")
    op.drop_index("ix_thread_prompt_caches_thread_provider", table_name="thread_prompt_caches")
    op.drop_table("thread_prompt_caches")
    op.drop_column("threads", "captured_prompt_snapshot")
    op.drop_column("user_settings", "llm_cache_settings")
