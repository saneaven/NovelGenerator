"""Remove plaintext provider_credentials from user_settings (E2E credentials).

Revision ID: 0011_remove_user_settings_provider_credentials
Revises: 0010_add_agent_message_seq
Create Date: 2026-01-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0011_remove_user_settings_provider_credentials"
down_revision = "0010_add_agent_message_seq"
branch_labels = None
depends_on = None


_DEFAULT_PROVIDER_CREDENTIALS = (
    '{"openai":{"apiKey":""},'
    '"gemini":{"apiKey":""},'
    '"claude":{"apiKey":""},'
    '"openrouter":{"apiKey":""},'
    '"custom":{"baseUrl":"","apiKey":""},'
    '"xai":{"apiKey":""},'
    '"novelai":{"apiKey":""}}'
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    if "provider_credentials" in cols:
        op.drop_column("user_settings", "provider_credentials")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    if "provider_credentials" not in cols:
        op.add_column(
            "user_settings",
            sa.Column(
                "provider_credentials",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text(f"'{_DEFAULT_PROVIDER_CREDENTIALS}'::jsonb"),
            ),
        )
        op.alter_column("user_settings", "provider_credentials", server_default=None)

