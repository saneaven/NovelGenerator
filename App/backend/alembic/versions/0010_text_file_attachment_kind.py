"""Add 'text_file' to run_message_attachments kind check constraint."""

from __future__ import annotations

from alembic import op


revision = "0010_text_file_attachment_kind"
down_revision = "0009_llm_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_run_message_attachments_kind", "run_message_attachments", type_="check")
    op.create_check_constraint(
        "ck_run_message_attachments_kind",
        "run_message_attachments",
        "kind IN ('image','document','text_file')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_run_message_attachments_kind", "run_message_attachments", type_="check")
    op.create_check_constraint(
        "ck_run_message_attachments_kind",
        "run_message_attachments",
        "kind IN ('image','document')",
    )
