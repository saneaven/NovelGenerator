"""Move story entity folder text into object_versions."""

from __future__ import annotations

from datetime import datetime
import json
import uuid

from alembic import op
import sqlalchemy as sa


revision = "0004_story_entity_folder_localization"
down_revision = "0003_outline_kind"
branch_labels = None
depends_on = None


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in set(inspector.get_table_names())


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    if not _table_exists(inspector, table_name):
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _first_language_from_version_data(raw_data: object) -> str | None:
    if not isinstance(raw_data, dict):
        return None
    for key, value in raw_data.items():
        if isinstance(key, str) and key.strip() and isinstance(value, dict):
            return key
    return None


def _derive_project_language(bind, project_id: str) -> str:
    lookups = [
        """
        SELECT ov.data
        FROM basic_info bi
        JOIN object_versions ov
          ON ov.object_type = 'basic_info'
         AND ov.object_id = bi.id
        WHERE bi.project_id = :project_id
        ORDER BY ov.version_number DESC
        LIMIT 1
        """,
        """
        SELECT ov.data
        FROM guidelines g
        JOIN object_versions ov
          ON ov.object_type = 'guidelines'
         AND ov.object_id = g.id
        WHERE g.project_id = :project_id
        ORDER BY ov.version_number DESC
        LIMIT 1
        """,
        """
        SELECT ov.data
        FROM object_versions ov
        WHERE ov.object_type IN ('basic_info', 'guidelines', 'story_entity', 'outline', 'manuscript')
          AND ov.object_id IN (
            SELECT id FROM basic_info WHERE project_id = :project_id
            UNION
            SELECT id FROM guidelines WHERE project_id = :project_id
            UNION
            SELECT id FROM story_entities WHERE project_id = :project_id
            UNION
            SELECT id FROM outlines WHERE project_id = :project_id
            UNION
            SELECT m.id
            FROM manuscripts m
            JOIN outlines o ON o.id = m.chapter_id
            WHERE o.project_id = :project_id
          )
        ORDER BY ov.created_at DESC, ov.version_number DESC
        LIMIT 1
        """,
    ]

    for sql in lookups:
        row = bind.execute(sa.text(sql), {"project_id": project_id}).first()
        if row is None:
            continue
        language = _first_language_from_version_data(row[0])
        if language:
            return language
    return "English"


def _drop_story_entity_folder_name_constraints(inspector: sa.Inspector) -> None:
    if not _table_exists(inspector, "story_entity_folders"):
        return
    for constraint in inspector.get_unique_constraints("story_entity_folders"):
        name = constraint.get("name")
        column_names = set(constraint.get("column_names") or [])
        if name and {"project_id", "parent_id", "name"}.issubset(column_names):
            op.drop_constraint(name, "story_entity_folders", type_="unique")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _table_exists(inspector, "story_entity_folders") or not _table_exists(inspector, "object_versions"):
        return

    folder_columns = _column_names(inspector, "story_entity_folders")
    if "name" in folder_columns:
        folder_rows = bind.execute(
            sa.text(
                """
                SELECT id, project_id, name, created_at
                FROM story_entity_folders
                ORDER BY created_at ASC, id ASC
                """
            )
        ).mappings().all()
        existing_ids = {
            str(row[0])
            for row in bind.execute(
                sa.text(
                    """
                    SELECT object_id
                    FROM object_versions
                    WHERE object_type = 'story_entity_folder'
                    """
                )
            ).all()
        }
        project_language_cache: dict[str, str] = {}

        for row in folder_rows:
            folder_id = str(row["id"] or "")
            project_id = str(row["project_id"] or "")
            if not folder_id or not project_id or folder_id in existing_ids:
                continue
            language = project_language_cache.get(project_id)
            if language is None:
                language = _derive_project_language(bind, project_id)
                project_language_cache[project_id] = language
            payload = {
                language: {
                    "name": str(row["name"] or ""),
                    "description": "",
                }
            }
            bind.execute(
                sa.text(
                    """
                    INSERT INTO object_versions (
                        id,
                        object_type,
                        object_id,
                        version_number,
                        data,
                        user_request,
                        created_by,
                        created_at
                    )
                    VALUES (
                        :id,
                        'story_entity_folder',
                        :object_id,
                        1,
                        CAST(:data AS jsonb),
                        :user_request,
                        NULL,
                        :created_at
                    )
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "object_id": folder_id,
                    "data": json.dumps(payload),
                    "user_request": "Migration Backfill",
                    "created_at": row["created_at"] or datetime.utcnow(),
                },
            )

    _drop_story_entity_folder_name_constraints(sa.inspect(bind))

    if "name" in folder_columns:
        op.drop_column("story_entity_folders", "name")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _table_exists(inspector, "story_entity_folders"):
        return

    folder_columns = _column_names(inspector, "story_entity_folders")
    if "name" not in folder_columns:
        op.add_column("story_entity_folders", sa.Column("name", sa.String(length=255), nullable=True))

    folder_rows = bind.execute(
        sa.text(
            """
            SELECT sef.id
            FROM story_entity_folders sef
            ORDER BY sef.created_at ASC, sef.id ASC
            """
        )
    ).mappings().all()

    latest_versions = bind.execute(
        sa.text(
            """
            SELECT ov.object_id, ov.data
            FROM object_versions ov
            JOIN (
                SELECT object_id, MAX(version_number) AS max_version
                FROM object_versions
                WHERE object_type = 'story_entity_folder'
                GROUP BY object_id
            ) latest
              ON latest.object_id = ov.object_id
             AND latest.max_version = ov.version_number
            WHERE ov.object_type = 'story_entity_folder'
            """
        )
    ).mappings().all()
    latest_by_id = {str(row["object_id"]): row["data"] for row in latest_versions}

    for row in folder_rows:
        folder_id = str(row["id"] or "")
        data = latest_by_id.get(folder_id)
        name = "Folder"
        if isinstance(data, dict):
            for value in data.values():
                if isinstance(value, dict) and str(value.get("name") or "").strip():
                    name = str(value.get("name") or "").strip()
                    break
        bind.execute(
            sa.text(
                """
                UPDATE story_entity_folders
                SET name = :name
                WHERE id = :folder_id
                """
            ),
            {
                "folder_id": folder_id,
                "name": name,
            },
        )

    op.alter_column("story_entity_folders", "name", existing_type=sa.String(length=255), nullable=False)

    duplicate_count = bind.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM (
                SELECT project_id, parent_id, name
                FROM story_entity_folders
                GROUP BY project_id, parent_id, name
                HAVING COUNT(*) > 1
            ) duplicates
            """
        )
    ).scalar_one()
    if int(duplicate_count or 0) == 0:
        op.create_unique_constraint(
            "uq_story_entity_folders_parent_name",
            "story_entity_folders",
            ["project_id", "parent_id", "name"],
        )
