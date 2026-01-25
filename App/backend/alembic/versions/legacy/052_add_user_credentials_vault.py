"""add_user_credentials_vault

Revision ID: 052
Revises: 051
Create Date: 2026-01-20

- Add user_credentials table for encrypted provider credentials (API keys).
- Wipe plaintext provider_credentials stored in user_settings (test/dev safety).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("provider_credentials_enc", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # DEV/TEST SAFETY: remove any plaintext credentials previously stored in user_settings.
    # This project is currently in early development with test accounts only.
    op.execute(
        """
        UPDATE user_settings
        SET provider_credentials = '{
            "openai": {"apiKey": ""},
            "gemini": {"apiKey": ""},
            "claude": {"apiKey": ""},
            "openrouter": {"apiKey": ""},
            "custom": {"baseUrl": "", "apiKey": ""},
            "xai": {"apiKey": ""},
            "novelai": {"apiKey": ""}
        }'::jsonb
        """
    )


def downgrade() -> None:
    op.drop_table("user_credentials")
