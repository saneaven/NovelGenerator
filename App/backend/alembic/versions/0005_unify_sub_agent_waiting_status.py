"""Unify Sub Agent waiting status and enforce status constraint.

Revision ID: 0005_unify_sub_agent_waiting_status
Revises: 0004_remove_claude_budget_tokens_adaptive
Create Date: 2026-02-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0005_unify_sub_agent_waiting_status"
down_revision = "0004_remove_claude_budget_tokens_adaptive"
branch_labels = None
depends_on = None


STATUS_CONSTRAINT_NAME = "ck_sub_agent_invocations_status"
ALLOWED_STATUSES = ("running", "waiting", "paused", "completed", "error", "cancelled")


def _allowed_statuses_sql() -> str:
    return ", ".join(f"'{status}'" for status in ALLOWED_STATUSES)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "sub_agent_invocations" not in tables:
        return

    bind.execute(
        sa.text(
            f"""
            UPDATE sub_agent_invocations
            SET status = 'error'
            WHERE status IS NULL OR status NOT IN ({_allowed_statuses_sql()})
            """
        )
    )

    inspector = inspect(bind)
    check_names = {constraint.get("name") for constraint in inspector.get_check_constraints("sub_agent_invocations")}
    if STATUS_CONSTRAINT_NAME not in check_names:
        op.create_check_constraint(
            STATUS_CONSTRAINT_NAME,
            "sub_agent_invocations",
            f"status IN ({_allowed_statuses_sql()})",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "sub_agent_invocations" not in tables:
        return

    check_names = {constraint.get("name") for constraint in inspector.get_check_constraints("sub_agent_invocations")}
    if STATUS_CONSTRAINT_NAME in check_names:
        op.drop_constraint(STATUS_CONSTRAINT_NAME, "sub_agent_invocations", type_="check")

    # No legacy-status rollback path by design.
