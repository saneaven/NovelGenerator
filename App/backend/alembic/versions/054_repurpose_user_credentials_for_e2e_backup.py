"""repurpose_user_credentials_for_e2e_backup

Revision ID: 054
Revises: 053
Create Date: 2026-01-20

Reuse the existing user_credentials table (Migration B), but repurpose it as an
opaque E2E-encrypted blob store:
- Rename provider_credentials_enc -> credentials_blob
"""

from alembic import op
import sqlalchemy as sa

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "user_credentials",
        "provider_credentials_enc",
        new_column_name="credentials_blob",
        existing_type=sa.Text(),
        existing_nullable=False,
        nullable=False,
    )
    # Existing rows (server-encrypted Fernet tokens) are not compatible with the new
    # client-side E2E backup format, so wipe to avoid false "backup exists" signals.
    op.execute("DELETE FROM user_credentials")


def downgrade() -> None:
    op.alter_column(
        "user_credentials",
        "credentials_blob",
        new_column_name="provider_credentials_enc",
        existing_type=sa.Text(),
        existing_nullable=False,
        nullable=False,
    )
