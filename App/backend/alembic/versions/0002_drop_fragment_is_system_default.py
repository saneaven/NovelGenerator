"""Drop is_system_default from prompt_fragments"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0002_drop_fragment_is_system_default"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    # NOTE: Alembic's default `alembic_version.version_num` is VARCHAR(32). Our revision id
    # exceeds 32 chars, so on PostgreSQL/MySQL the version table update will fail unless we
    # widen this column first (still within this same migration transaction).
    try:
        version_cols = inspector.get_columns("alembic_version")
        version_num_col = next((c for c in version_cols if c.get("name") == "version_num"), None)
        cur_len = getattr(version_num_col.get("type"), "length", None) if version_num_col else None
    except Exception:
        cur_len = None

    if not cur_len or int(cur_len) < 64:
        dialect = getattr(bind.dialect, "name", "")
        if dialect == "postgresql":
            op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")
        elif dialect in {"mysql", "mariadb"}:
            op.execute("ALTER TABLE alembic_version MODIFY version_num VARCHAR(64)")

    columns = {col["name"] for col in inspector.get_columns("prompt_fragments")}
    if "is_system_default" in columns:
        op.drop_column("prompt_fragments", "is_system_default")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("prompt_fragments")}
    if "is_system_default" not in columns:
        op.add_column(
            "prompt_fragments",
            sa.Column("is_system_default", sa.Boolean(), nullable=False, server_default="false"),
        )
