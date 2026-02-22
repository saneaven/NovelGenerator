"""Add rag_search_keyword_page_size to user_settings.

This controls the page size for keyword-based chunk search over rag_chunks.

Written to be idempotent for safety (no-op if the column already exists).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_add_rag_keyword_page_size"
down_revision = "0005_sub_agent_prompt_vars"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_settings"):
        return

    existing = {c["name"] for c in inspector.get_columns("user_settings")}
    if "rag_search_keyword_page_size" in existing:
        return

    op.add_column(
        "user_settings",
        sa.Column(
            "rag_search_keyword_page_size",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("20"),
        ),
    )
    op.alter_column("user_settings", "rag_search_keyword_page_size", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_settings"):
        return

    existing = {c["name"] for c in inspector.get_columns("user_settings")}
    if "rag_search_keyword_page_size" not in existing:
        return

    op.drop_column("user_settings", "rag_search_keyword_page_size")

