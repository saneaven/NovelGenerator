"""Remove the unused token/event journal; live streams are process-local."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0028_remove_runtime_journal"
down_revision = "0027_backend_continuations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("runtime_events")
    op.drop_column("run_messages", "is_streaming")


def downgrade() -> None:
    op.add_column("run_messages", sa.Column("is_streaming", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "runtime_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("threads.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_runtime_events_user_id", "runtime_events", ["user_id", "id"])
    op.create_index("ix_runtime_events_thread_id", "runtime_events", ["thread_id", "id"])
    op.create_index("ix_runtime_events_created", "runtime_events", ["created_at"])
