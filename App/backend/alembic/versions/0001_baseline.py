"""Baseline schema for fresh installs."""

from __future__ import annotations

from alembic import op

from database import Base
from models import db_models, memory_models, semantic_models, translation_models  # noqa: F401


revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
    bind.exec_driver_sql("DROP EXTENSION IF EXISTS vector")
