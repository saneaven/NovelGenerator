"""Move embedding profile config into user_settings (drop rag_embedding_profiles).

Revision ID: 0006_move_embedding_profiles_to_user_settings
Revises: 0005_add_agent_long_term_memory
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0006_move_embedding_profiles_to_user_settings"
down_revision = "0005_add_agent_long_term_memory"
branch_labels = None
depends_on = None


DEFAULT_EMBEDDING_CONFIGS = (
    '{"ragSearch":{"provider":"openai","model":"","dimensions": null},'
    '"agentMemory":{"provider":"openai","model":"","dimensions": null}}'
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # Alembic's default schema uses VARCHAR(32) for `alembic_version.version_num`.
    # Our revision IDs are longer (e.g. "0006_move_embedding_profiles_to_user_settings"),
    # so widen it to avoid upgrade failures when Alembic records the new head.
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)")

    existing_cols = {col["name"] for col in inspector.get_columns("user_settings")}
    if "embedding_configs" not in existing_cols:
        op.add_column(
            "user_settings",
            sa.Column(
                "embedding_configs",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text(f"'{DEFAULT_EMBEDDING_CONFIGS}'::jsonb"),
            ),
        )

    existing_tables = set(inspector.get_table_names())
    if "rag_embedding_profiles" in existing_tables:
        op.drop_table("rag_embedding_profiles")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    existing_tables = set(inspector.get_table_names())
    if "rag_embedding_profiles" not in existing_tables:
        op.create_table(
            "rag_embedding_profiles",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("provider", sa.String(length=50), nullable=False),
            sa.Column("model", sa.String(length=200), nullable=False),
            sa.Column("dimensions", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        )

    existing_cols = {col["name"] for col in inspector.get_columns("user_settings")}
    if "embedding_configs" in existing_cols:
        op.drop_column("user_settings", "embedding_configs")
