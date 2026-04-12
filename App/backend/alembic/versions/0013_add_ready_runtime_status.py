"""Add ready runtime status."""

from __future__ import annotations

from alembic import op


revision = "0013_add_ready_runtime_status"
down_revision = "0012_asset_generation_mask_image"
branch_labels = None
depends_on = None


_RUNTIME_STATUS_WITH_READY = "status IN ('running','waiting','processing','ready','paused','done','error','canceled')"
_RUNTIME_STATUS_WITHOUT_READY = "status IN ('running','waiting','processing','paused','done','error','canceled')"
_NOTIFICATION_STATUS_WITH_READY = (
    "status IN ("
    "'running','waiting','processing','ready','paused','done','error','canceled',"
    "'queued','review','applying','applied','rejected','failed'"
    ")"
)
_NOTIFICATION_STATUS_WITHOUT_READY = (
    "status IN ("
    "'running','waiting','processing','paused','done','error','canceled',"
    "'queued','review','applying','applied','rejected','failed'"
    ")"
)


def _replace_check_constraint(*, table_name: str, constraint_name: str, condition: str) -> None:
    op.drop_constraint(constraint_name, table_name, type_="check")
    op.create_check_constraint(constraint_name, table_name, condition)


def upgrade() -> None:
    _replace_check_constraint(
        table_name="journeys",
        constraint_name="ck_journeys_status",
        condition=_RUNTIME_STATUS_WITH_READY,
    )
    _replace_check_constraint(
        table_name="threads",
        constraint_name="ck_threads_status",
        condition=_RUNTIME_STATUS_WITH_READY,
    )
    _replace_check_constraint(
        table_name="runs",
        constraint_name="ck_runs_status",
        condition=_RUNTIME_STATUS_WITH_READY,
    )
    _replace_check_constraint(
        table_name="notifications",
        constraint_name="ck_notifications_status",
        condition=_NOTIFICATION_STATUS_WITH_READY,
    )


def downgrade() -> None:
    op.execute("UPDATE notifications SET status = 'done' WHERE status = 'ready'")
    op.execute("UPDATE journeys SET status = 'done' WHERE status = 'ready'")
    op.execute("UPDATE threads SET status = 'done' WHERE status = 'ready'")
    op.execute("UPDATE runs SET status = 'done' WHERE status = 'ready'")

    _replace_check_constraint(
        table_name="notifications",
        constraint_name="ck_notifications_status",
        condition=_NOTIFICATION_STATUS_WITHOUT_READY,
    )
    _replace_check_constraint(
        table_name="runs",
        constraint_name="ck_runs_status",
        condition=_RUNTIME_STATUS_WITHOUT_READY,
    )
    _replace_check_constraint(
        table_name="threads",
        constraint_name="ck_threads_status",
        condition=_RUNTIME_STATUS_WITHOUT_READY,
    )
    _replace_check_constraint(
        table_name="journeys",
        constraint_name="ck_journeys_status",
        condition=_RUNTIME_STATUS_WITHOUT_READY,
    )
