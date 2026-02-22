"""Drop is_system_default from prompt_fragments"""

from alembic import op
import sqlalchemy as sa

revision = "0002_drop_fragment_is_system_default"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("prompt_fragments", "is_system_default")


def downgrade() -> None:
    op.add_column(
        "prompt_fragments",
        sa.Column("is_system_default", sa.Boolean(), nullable=False, server_default="false"),
    )
