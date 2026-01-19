"""drop_object_translations

Revision ID: 051
Revises: 050
Create Date: 2026-01-19

- Drop object_translations (translation cache). The system now derives available languages from object_versions only.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("object_translations")


def downgrade() -> None:
    op.create_table(
        "object_translations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),

        # Object identification
        sa.Column("object_type", sa.String(50), nullable=False),
        sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=False),

        # Language
        sa.Column("language", sa.String(50), nullable=False),

        # Translation data (flexible JSONB)
        sa.Column("data", postgresql.JSONB, nullable=False),

        # Active language flag
        sa.Column("is_active", sa.Boolean, default=False, nullable=False),

        # Timestamps
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Unique constraint: one translation per object per language
    op.create_index(
        "uq_object_language",
        "object_translations",
        ["object_type", "object_id", "language"],
        unique=True,
    )

    # GIN index for fast JSONB queries
    op.execute(
        "CREATE INDEX ix_object_translations_data ON object_translations USING gin (data)"
    )

    # Regular indexes for common queries
    op.create_index("ix_object_translations_type", "object_translations", ["object_type"])
    op.create_index("ix_object_translations_object_id", "object_translations", ["object_id"])
    op.create_index("ix_object_translations_language", "object_translations", ["language"])
    op.create_index("ix_object_translations_is_active", "object_translations", ["is_active"])

    # Composite indexes for complex queries
    op.create_index(
        "ix_object_translations_type_id_lang",
        "object_translations",
        ["object_type", "object_id", "language"],
    )
    op.create_index(
        "ix_object_translations_type_active",
        "object_translations",
        ["object_type", "is_active"],
    )

