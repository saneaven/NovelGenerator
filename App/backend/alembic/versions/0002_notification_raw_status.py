"""Expand notification statuses and normalize canceled spelling."""

from __future__ import annotations

from alembic import op


revision = "0002_notification_raw_status"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE image_runs SET status = 'canceled' WHERE status = 'cancelled'")
    op.execute("UPDATE notifications SET status = 'canceled' WHERE status = 'cancelled'")

    op.drop_constraint("ck_image_runs_status", "image_runs", type_="check")
    op.create_check_constraint(
        "ck_image_runs_status",
        "image_runs",
        "status IN ('queued','running','review','applying','applied','rejected','failed','canceled')",
    )

    op.drop_constraint("ck_notifications_status", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_status",
        "notifications",
        "status IN ("
        "'running','waiting','processing','paused','done','error','canceled',"
        "'queued','review','applying','applied','rejected','failed'"
        ")",
    )


def downgrade() -> None:
    op.drop_constraint("ck_notifications_status", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_status",
        "notifications",
        "status IN ('running','pending','success','error','cancelled')",
    )

    op.drop_constraint("ck_image_runs_status", "image_runs", type_="check")
    op.create_check_constraint(
        "ck_image_runs_status",
        "image_runs",
        "status IN ('queued','running','review','applying','applied','rejected','failed','cancelled')",
    )

    op.execute("UPDATE notifications SET status = 'cancelled' WHERE status = 'canceled'")
    op.execute("UPDATE image_runs SET status = 'cancelled' WHERE status = 'canceled'")
