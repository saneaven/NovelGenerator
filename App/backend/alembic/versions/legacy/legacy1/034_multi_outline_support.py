"""multi_outline_support

Revision ID: 034
Revises: 033
Create Date: 2025-12-29

Enables multiple outlines per project for parallel storylines.
- Removes unique constraint on outlines.project_id
- Adds order column to outlines table
- Creates ObjectTranslation and ObjectVersion records for existing outlines
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
import uuid

revision = '034'
down_revision = '033'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Remove unique constraint on project_id
    # The constraint name may vary - try both possible names
    try:
        op.drop_constraint('outlines_project_id_key', 'outlines', type_='unique')
    except Exception:
        try:
            op.drop_constraint('uq_outlines_project_id', 'outlines', type_='unique')
        except Exception:
            # If no constraint exists, continue
            pass

    # 2. Add order column (nullable first to handle existing rows)
    op.add_column(
        'outlines',
        sa.Column('order', sa.Integer, nullable=True, server_default='0')
    )

    # 3. Set order=0 for all existing outlines
    op.execute("UPDATE outlines SET \"order\" = 0 WHERE \"order\" IS NULL")

    # 4. Make order non-nullable
    op.alter_column('outlines', 'order', nullable=False)

    # 5. Create composite index for efficient ordering queries
    op.create_index('idx_outlines_project_order', 'outlines', ['project_id', 'order'])

    # 6. Create ObjectTranslation and ObjectVersion records for existing outlines
    connection = op.get_bind()

    # Find all existing outlines
    outlines = connection.execute(sa.text(
        "SELECT id FROM outlines"
    )).fetchall()

    for outline_row in outlines:
        outline_id = str(outline_row[0])

        # Check if ObjectTranslation already exists for this outline
        existing = connection.execute(sa.text(
            "SELECT id FROM object_translations WHERE object_type = 'outline' AND object_id = :id"
        ), {'id': outline_id}).fetchone()

        if not existing:
            # Create ObjectTranslation with default name
            translation_id = str(uuid.uuid4())
            connection.execute(sa.text("""
                INSERT INTO object_translations
                (id, object_type, object_id, language, data, is_active, created_at, updated_at)
                VALUES
                (:id, 'outline', :object_id, 'English',
                 '{"name": "Main Outline", "description": ""}',
                 true, NOW(), NOW())
            """), {'id': translation_id, 'object_id': outline_id})

            # Create ObjectVersion for history
            version_id = str(uuid.uuid4())
            connection.execute(sa.text("""
                INSERT INTO object_versions
                (id, object_type, object_id, version_number, data, user_request, created_at)
                VALUES
                (:id, 'outline', :object_id, 1,
                 '{"English": {"name": "Main Outline", "description": ""}}',
                 'Migration', NOW())
            """), {'id': version_id, 'object_id': outline_id})


def downgrade() -> None:
    connection = op.get_bind()

    # 1. Delete outline translations and versions
    connection.execute(sa.text("DELETE FROM object_versions WHERE object_type = 'outline'"))
    connection.execute(sa.text("DELETE FROM object_translations WHERE object_type = 'outline'"))

    # 2. Drop the composite index
    op.drop_index('idx_outlines_project_order', table_name='outlines')

    # 3. Drop the order column
    op.drop_column('outlines', 'order')

    # 4. Re-add unique constraint on project_id
    op.create_unique_constraint('outlines_project_id_key', 'outlines', ['project_id'])
