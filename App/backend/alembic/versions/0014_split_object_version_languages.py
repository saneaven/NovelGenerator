"""Split object version language payloads."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0014_object_version_langs"
down_revision = "0013_add_ready_runtime_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "object_version_languages",
        sa.Column(
            "version_id",
            UUID(as_uuid=True),
            sa.ForeignKey("object_versions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("language", sa.String(32), primary_key=True),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("user_request", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.execute(
        """
        INSERT INTO object_version_languages
            (version_id, language, data, user_request, created_at, created_by)
        SELECT  ov.id, kv.key, kv.value,
                ov.user_request, ov.created_at, ov.created_by
        FROM    object_versions ov,
                LATERAL jsonb_each(ov.data) AS kv(key, value)
        WHERE   jsonb_typeof(ov.data) = 'object'
          AND   jsonb_typeof(kv.value) = 'object'
        """
    )

    op.execute(
        """
        DO $$
        DECLARE missing INT;
        BEGIN
          SELECT COUNT(*) INTO missing
          FROM object_versions ov
          WHERE jsonb_typeof(ov.data) = 'object'
            AND ov.data <> '{}'::jsonb
            AND NOT EXISTS (
                SELECT 1 FROM object_version_languages
                WHERE version_id = ov.id
            );
          IF missing > 0 THEN
            RAISE EXCEPTION 'Backfill incomplete: % versions missing language rows', missing;
          END IF;
        END $$;
        """
    )

    op.drop_index("ix_object_versions_data", table_name="object_versions")
    op.drop_column("object_versions", "data")
    op.drop_column("object_versions", "user_request")


def downgrade() -> None:
    op.add_column("object_versions", sa.Column("user_request", sa.Text(), nullable=True))
    op.add_column("object_versions", sa.Column("data", JSONB, nullable=True))
    op.execute(
        """
        UPDATE object_versions ov
        SET data = COALESCE((
            SELECT jsonb_object_agg(language, data)
            FROM object_version_languages
            WHERE version_id = ov.id
        ), '{}'::jsonb)
        """
    )
    op.execute(
        """
        UPDATE object_versions ov
        SET user_request = (
            SELECT user_request
            FROM object_version_languages ovl
            WHERE ovl.version_id = ov.id
            ORDER BY ovl.created_at ASC
            LIMIT 1
        )
        """
    )
    op.alter_column("object_versions", "data", nullable=False)
    op.create_index("ix_object_versions_data", "object_versions", ["data"], postgresql_using="gin")
    op.drop_table("object_version_languages")
