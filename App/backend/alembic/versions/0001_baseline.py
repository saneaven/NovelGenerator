"""Baseline schema for fresh installs.
This baseline creates the current schema directly from SQLAlchemy models so a
fresh Postgres database contains required core tables.
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pgvector is required by `models/rag_models.py` (Vector type).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    bind = op.get_bind()

    # Import models so they register with Base.metadata before create_all().
    from database import Base  # noqa: E402
    from models import db_models  # noqa: F401,E402
    from models import translation_models  # noqa: F401,E402
    from models import rag_models  # noqa: F401,E402
    from models import memory_models  # noqa: F401,E402

    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()

    from database import Base  # noqa: E402
    from models import db_models  # noqa: F401,E402
    from models import translation_models  # noqa: F401,E402
    from models import rag_models  # noqa: F401,E402
    from models import memory_models  # noqa: F401,E402

    Base.metadata.drop_all(bind=bind)
    op.execute("DROP EXTENSION IF EXISTS vector")

