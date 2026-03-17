"""Unify outline, act, and chapter rows into the outlines table."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_outline_kind"
down_revision = "0002_story_entity"
branch_labels = None
depends_on = None


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    if not _table_exists(inspector, table_name):
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    outline_columns = _column_names(inspector, "outlines")
    has_legacy_order = "order" in outline_columns

    if "kind" not in outline_columns:
        op.add_column("outlines", sa.Column("kind", sa.String(length=20), nullable=True))
    if "parent_id" not in outline_columns:
        op.add_column(
            "outlines",
            sa.Column("parent_id", sa.UUID(), sa.ForeignKey("outlines.id", ondelete="CASCADE"), nullable=True),
        )
    if "position" not in outline_columns:
        op.add_column("outlines", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))

    bind.exec_driver_sql(
        """
        UPDATE outlines
        SET kind = 'outline',
            parent_id = NULL,
            position = COALESCE("order", 0)
        WHERE kind IS NULL
        """
    )

    if _table_exists(inspector, "acts"):
        if has_legacy_order:
            bind.exec_driver_sql(
                """
                INSERT INTO outlines (id, project_id, "order", kind, parent_id, position, created_at, updated_at)
                SELECT id, project_id, COALESCE("order", 0), 'act', outline_id, COALESCE("order", 0), created_at, updated_at
                FROM acts
                """
            )
        else:
            bind.exec_driver_sql(
                """
                INSERT INTO outlines (id, project_id, kind, parent_id, position, created_at, updated_at)
                SELECT id, project_id, 'act', outline_id, COALESCE("order", 0), created_at, updated_at
                FROM acts
                """
            )

    if _table_exists(inspector, "chapters"):
        if has_legacy_order:
            bind.exec_driver_sql(
                """
                INSERT INTO outlines (id, project_id, "order", kind, parent_id, position, created_at, updated_at)
                SELECT id, project_id, COALESCE("order", 0), 'chapter', act_id, COALESCE("order", 0), created_at, updated_at
                FROM chapters
                """
            )
        else:
            bind.exec_driver_sql(
                """
                INSERT INTO outlines (id, project_id, kind, parent_id, position, created_at, updated_at)
                SELECT id, project_id, 'chapter', act_id, COALESCE("order", 0), created_at, updated_at
                FROM chapters
                """
            )

    if _table_exists(inspector, "manuscripts"):
        op.execute("ALTER TABLE manuscripts DROP CONSTRAINT IF EXISTS manuscripts_chapter_id_fkey")
        op.create_foreign_key(
            "manuscripts_chapter_id_fkey",
            "manuscripts",
            "outlines",
            ["chapter_id"],
            ["id"],
            ondelete="CASCADE",
        )

    if _table_exists(inspector, "object_versions"):
        bind.exec_driver_sql(
            """
            UPDATE object_versions
            SET object_type = 'outline'
            WHERE object_type IN ('act', 'chapter')
            """
        )

    if _table_exists(inspector, "semantic_sources"):
        bind.exec_driver_sql(
            """
            UPDATE semantic_sources
            SET object_type = 'outline'
            WHERE object_type IN ('act', 'chapter')
            """
        )

    if _table_exists(inspector, "storage_usage_measurements"):
        bind.exec_driver_sql(
            """
            UPDATE storage_usage_measurements
            SET object_type = 'outline'
            WHERE object_type IN ('act', 'chapter')
            """
        )

    op.execute("ALTER TABLE outlines DROP CONSTRAINT IF EXISTS ck_outlines_kind")
    op.execute("ALTER TABLE outlines DROP CONSTRAINT IF EXISTS ck_outlines_position_non_negative")
    op.create_check_constraint(
        "ck_outlines_kind",
        "outlines",
        "kind IN ('outline', 'act', 'chapter')",
    )
    op.create_check_constraint(
        "ck_outlines_position_non_negative",
        "outlines",
        "position >= 0",
    )

    existing_indexes = inspector.get_indexes("outlines") if _table_exists(inspector, "outlines") else []
    index_names = {index["name"] for index in existing_indexes}
    if "ix_outlines_project_parent_position" not in index_names:
        op.create_index(
            "ix_outlines_project_parent_position",
            "outlines",
            ["project_id", "parent_id", "position"],
        )
    if "ix_outlines_project_kind" not in index_names:
        op.create_index("ix_outlines_project_kind", "outlines", ["project_id", "kind"])

    if "order" in _column_names(sa.inspect(bind), "outlines"):
        op.drop_column("outlines", "order")

    if _table_exists(sa.inspect(bind), "chapters"):
        op.drop_table("chapters")
    if _table_exists(sa.inspect(bind), "acts"):
        op.drop_table("acts")

    op.alter_column("outlines", "kind", existing_type=sa.String(length=20), nullable=False)
    op.alter_column("outlines", "position", existing_type=sa.Integer(), server_default=None)


def downgrade() -> None:
    raise NotImplementedError("Outline kind unification is irreversible")
