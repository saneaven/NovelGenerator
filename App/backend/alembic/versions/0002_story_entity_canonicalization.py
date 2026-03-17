"""Canonicalize story entities and reset prompt presets."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_story_entity"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


LEGACY_KIND_ORDER = {
    "character": 0,
    "organization": 1,
    "location": 2,
    "lorebook": 3,
}


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _ensure_story_entity_tables(inspector: sa.Inspector) -> None:
    if not _table_exists(inspector, "story_entity_folders"):
        op.create_table(
            "story_entity_folders",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("story_entity_folders.id", ondelete="CASCADE"), nullable=True),
            sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("project_id", "parent_id", "name", name="uq_story_entity_folder_sibling_name"),
        )
        op.create_index(
            "ix_story_entity_folders_project_parent_order",
            "story_entity_folders",
            ["project_id", "parent_id", "display_order"],
        )

    if not _table_exists(inspector, "story_entities"):
        op.create_table(
            "story_entities",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(length=30), nullable=False),
            sa.Column("folder_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("story_entity_folders.id", ondelete="SET NULL"), nullable=True),
            sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("image_prompt", sa.Text(), nullable=True),
            sa.Column("image_prompt_positive", sa.Text(), nullable=True),
            sa.Column("image_prompt_negative", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint(
                "kind IN ('character', 'organization', 'location', 'lorebook')",
                name="ck_story_entities_kind",
            ),
        )
        op.create_index("ix_story_entities_project_kind", "story_entities", ["project_id", "kind"])
        op.create_index(
            "ix_story_entities_project_folder_order",
            "story_entities",
            ["project_id", "folder_id", "display_order"],
        )


def _assert_no_legacy_id_collisions(bind) -> None:
    row = bind.exec_driver_sql(
        """
        SELECT id
        FROM (
            SELECT id FROM characters
            UNION ALL
            SELECT id FROM organizations
            UNION ALL
            SELECT id FROM locations
            UNION ALL
            SELECT id FROM lorebook_entries
        ) AS legacy_ids
        GROUP BY id
        HAVING COUNT(*) > 1
        LIMIT 1
        """
    ).first()
    if row is not None:
        raise RuntimeError(f"Legacy story object UUID collision detected: {row[0]}")


def _migrate_legacy_story_objects(bind) -> None:
    for kind, table_name in (
        ("character", "characters"),
        ("organization", "organizations"),
        ("location", "locations"),
        ("lorebook", "lorebook_entries"),
    ):
        bind.exec_driver_sql(
            f"""
            INSERT INTO story_entities (
                id,
                project_id,
                kind,
                folder_id,
                display_order,
                image_prompt,
                image_prompt_positive,
                image_prompt_negative,
                created_at,
                updated_at
            )
            SELECT
                id,
                project_id,
                '{kind}',
                NULL,
                COALESCE("order", 0),
                image_prompt,
                image_prompt_positive,
                image_prompt_negative,
                created_at,
                updated_at
            FROM {table_name}
            """
        )

    bind.exec_driver_sql(
        """
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY project_id, folder_id
                    ORDER BY
                        CASE kind
                            WHEN 'character' THEN 0
                            WHEN 'organization' THEN 1
                            WHEN 'location' THEN 2
                            ELSE 3
                        END,
                        display_order,
                        created_at,
                        id
                ) - 1 AS new_display_order
            FROM story_entities
        )
        UPDATE story_entities AS target
        SET display_order = ranked.new_display_order
        FROM ranked
        WHERE ranked.id = target.id
        """
    )


def _rewrite_canonical_types(bind) -> None:
    bind.exec_driver_sql(
        """
        UPDATE object_versions
        SET object_type = 'story_entity'
        WHERE object_type IN ('character', 'organization', 'location', 'lorebook')
        """
    )
    bind.exec_driver_sql(
        """
        UPDATE story_object_assets
        SET object_type = 'story_entity'
        WHERE object_type IN ('character', 'organization', 'location', 'lorebook')
        """
    )
    bind.exec_driver_sql(
        """
        UPDATE manuscript_images
        SET story_object_type = 'story_entity'
        WHERE story_object_type IN ('character', 'organization', 'location', 'lorebook')
        """
    )
    bind.exec_driver_sql(
        """
        UPDATE semantic_sources
        SET object_type = 'story_entity'
        WHERE object_type IN ('character', 'organization', 'location', 'lorebook')
        """
    )
    bind.exec_driver_sql(
        """
        UPDATE journeys
        SET kind = 'objectEdit'
        WHERE kind = 'storyObjectEdit'
        """
    )

    # Best-effort canonical rewrite for structured JSON payloads used by image tooling.
    bind.exec_driver_sql(
        """
        UPDATE assets
        SET generation_reference_objects = REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(generation_reference_objects::text,
                            '"type": "character"', '"type": "story_entity", "kind": "character"'),
                        '"type": "organization"', '"type": "story_entity", "kind": "organization"'),
                    '"type": "location"', '"type": "story_entity", "kind": "location"'),
                '"type": "lorebook"', '"type": "story_entity", "kind": "lorebook"'
            )::jsonb
        WHERE generation_reference_objects IS NOT NULL
        """
    )
    bind.exec_driver_sql(
        """
        UPDATE image_runs
        SET request_snapshot = REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(request_snapshot::text,
                            '"objectType": "character"', '"objectType": "story_entity", "objectKind": "character"'),
                        '"objectType": "organization"', '"objectType": "story_entity", "objectKind": "organization"'),
                    '"objectType": "location"', '"objectType": "story_entity", "objectKind": "location"'),
                '"objectType": "lorebook"', '"objectType": "story_entity", "objectKind": "lorebook"'
            )::jsonb
        WHERE request_snapshot IS NOT NULL
        """
    )


def _reset_prompt_tables(bind, inspector: sa.Inspector) -> None:
    if _table_exists(inspector, "user_settings"):
        bind.exec_driver_sql("UPDATE user_settings SET active_preset_id = NULL")
    if _table_exists(inspector, "prompt_presets"):
        bind.exec_driver_sql("DELETE FROM prompt_presets")


def _drop_legacy_story_object_tables(inspector: sa.Inspector) -> None:
    for table_name in ("lorebook_entries", "locations", "organizations", "characters"):
        if _table_exists(inspector, table_name):
            op.drop_table(table_name)


def _refresh_journey_constraint(inspector: sa.Inspector) -> None:
    if not _table_exists(inspector, "journeys"):
        return
    op.execute("ALTER TABLE journeys DROP CONSTRAINT IF EXISTS ck_journeys_kind")
    op.create_check_constraint(
        "ck_journeys_kind",
        "journeys",
        "kind IN ('manuscriptEdit','outlineEdit','objectEdit','objectTranslation','imagePrompt','sceneImagePrompt','messageTranslation')",
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _ensure_story_entity_tables(inspector)

    legacy_tables = ("characters", "organizations", "locations", "lorebook_entries")
    if all(_table_exists(inspector, table_name) for table_name in legacy_tables):
        _assert_no_legacy_id_collisions(bind)
        if bind.exec_driver_sql("SELECT 1 FROM story_entities LIMIT 1").first() is None:
            _migrate_legacy_story_objects(bind)

    _rewrite_canonical_types(bind)
    _refresh_journey_constraint(inspector)
    _reset_prompt_tables(bind, inspector)
    _drop_legacy_story_object_tables(inspector)


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for story entity canonicalization")
