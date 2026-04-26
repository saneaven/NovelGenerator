"""Drop legacy user_settings.llm_cache_settings column."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0020_drop_user_settings_cache"
down_revision = "0019_add_thread_prompt_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("user_settings", "llm_cache_settings")


def downgrade() -> None:
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
