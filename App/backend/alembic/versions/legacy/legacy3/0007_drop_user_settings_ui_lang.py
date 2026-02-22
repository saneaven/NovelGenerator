"""Drop user_settings.display_language.

This setting was removed in favor of a browser-only display language preference.

Idempotent by design:
- No-op if the user_settings table doesn't exist
- No-op if the display_language column is already missing
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0007_drop_user_settings_ui_lang"
down_revision = "0006_add_rag_keyword_page_size"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_settings"):
        return

    existing = {c["name"] for c in inspector.get_columns("user_settings")}
    if "display_language" not in existing:
        return

    op.drop_column("user_settings", "display_language")


def downgrade() -> None:
    # Irreversible cleanup (display language is now client-only).
    return
