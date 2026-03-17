"""Rename remaining legacy asset and semantic schema identifiers."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_canonical_name_cleanup"
down_revision = "0004_story_entity_folder_loc"
branch_labels = None
depends_on = None


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    if not _table_exists(inspector, table_name):
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _rename_object_asset_links(bind, inspector: sa.Inspector) -> None:
    if _table_exists(inspector, "story_object_assets") and not _table_exists(inspector, "object_asset_links"):
        op.rename_table("story_object_assets", "object_asset_links")
        inspector = sa.inspect(bind)

    if not _table_exists(inspector, "object_asset_links"):
        return

    columns = _column_names(inspector, "object_asset_links")
    if "story_object_type" in columns and "object_type" not in columns:
        op.alter_column("object_asset_links", "story_object_type", new_column_name="object_type")
    if "story_object_id" in columns and "object_id" not in columns:
        op.alter_column("object_asset_links", "story_object_id", new_column_name="object_id")

    inspector = sa.inspect(bind)
    indexes = {index["name"]: index for index in inspector.get_indexes("object_asset_links")}
    if "idx_object_asset_link_object" not in indexes:
        for name, index in indexes.items():
            if index.get("column_names") == ["object_type", "object_id"]:
                op.execute(sa.text(f'ALTER INDEX "{name}" RENAME TO idx_object_asset_link_object'))
                break

    for constraint in inspector.get_unique_constraints("object_asset_links"):
        if constraint.get("column_names") == ["asset_id"] and constraint.get("name") not in {None, "uq_object_asset_links_asset_id"}:
            op.execute(
                sa.text(
                    f'ALTER TABLE object_asset_links RENAME CONSTRAINT "{constraint["name"]}" TO uq_object_asset_links_asset_id'
                )
            )
            break


def _rename_manuscript_image_fields(inspector: sa.Inspector) -> None:
    if not _table_exists(inspector, "manuscript_images"):
        return

    columns = _column_names(inspector, "manuscript_images")
    bind = op.get_bind()

    if "source_type" not in columns:
        op.add_column("manuscript_images", sa.Column("source_type", sa.String(length=20), nullable=True))
        columns.add("source_type")

    if "story_entity_kind" not in columns:
        op.add_column("manuscript_images", sa.Column("story_entity_kind", sa.String(length=50), nullable=True))
        columns.add("story_entity_kind")

    if "story_object_id" in columns and "object_id" not in columns:
        op.alter_column("manuscript_images", "story_object_id", new_column_name="object_id")
        columns.remove("story_object_id")
        columns.add("object_id")

    bind.exec_driver_sql(
        """
        UPDATE manuscript_images
        SET source_type = CASE
            WHEN asset_id IS NOT NULL THEN 'asset'
            WHEN object_id IS NOT NULL THEN 'object'
            ELSE source_type
        END
        WHERE source_type IS NULL
        """
    )

    if "story_object_type" in columns:
        bind.exec_driver_sql(
            """
            UPDATE manuscript_images
            SET story_entity_kind = CASE
                WHEN story_object_type IN ('character', 'organization', 'location', 'lorebook') THEN story_object_type
                ELSE story_entity_kind
            END
            WHERE story_entity_kind IS NULL
            """
        )
        op.drop_column("manuscript_images", "story_object_type")

    op.alter_column("manuscript_images", "source_type", existing_type=sa.String(length=20), nullable=False)


def _rename_semantic_fields(inspector: sa.Inspector) -> None:
    if not _table_exists(inspector, "semantic_sources"):
        return

    columns = _column_names(inspector, "semantic_sources")
    bind = op.get_bind()

    if "story_object_type" in columns and "story_entity_kind" not in columns:
        op.alter_column("semantic_sources", "story_object_type", new_column_name="story_entity_kind")
    if "story_object_order" in columns and "story_entity_order" not in columns:
        op.alter_column("semantic_sources", "story_object_order", new_column_name="story_entity_order")

    bind.exec_driver_sql(
        """
        UPDATE semantic_sources
        SET type_group = 'story_entity'
        WHERE type_group = 'story_object'
        """
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _rename_object_asset_links(bind, inspector)
    inspector = sa.inspect(bind)
    _rename_manuscript_image_fields(inspector)
    inspector = sa.inspect(bind)
    _rename_semantic_fields(inspector)


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for canonical name cleanup")
