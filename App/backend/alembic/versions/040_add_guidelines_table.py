"""add_guidelines_table

Revision ID: 040
Revises: 039
Create Date: 2025-01-11

Adds guidelines table for project-level AI instructions.
- Creates guidelines table with project_id foreign key
- Creates Guidelines records for existing projects with empty authorNote
- Creates ObjectVersion and ObjectTranslation records for each
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
import uuid
from datetime import datetime

revision = '040'
down_revision = '039'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create guidelines table
    op.create_table(
        'guidelines',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # 2. Create index on project_id
    op.create_index('idx_guidelines_project_id', 'guidelines', ['project_id'])

    # 3. Create Guidelines records for existing projects
    connection = op.get_bind()

    # Find all existing projects
    projects = connection.execute(sa.text(
        "SELECT id FROM projects"
    )).fetchall()

    now = datetime.utcnow()

    for project_row in projects:
        project_id = str(project_row[0])
        guidelines_id = str(uuid.uuid4())

        # Create Guidelines record
        connection.execute(sa.text("""
            INSERT INTO guidelines (id, project_id, created_at, updated_at)
            VALUES (:id, :project_id, :now, :now)
        """), {'id': guidelines_id, 'project_id': project_id, 'now': now})

        # Get the main language from the project's basic_info ObjectTranslation
        lang_result = connection.execute(sa.text("""
            SELECT ot.language FROM object_translations ot
            JOIN basic_info bi ON bi.id = ot.object_id
            WHERE bi.project_id = :project_id AND ot.object_type = 'basic_info'
            LIMIT 1
        """), {'project_id': project_id}).fetchone()

        language = lang_result[0] if lang_result else 'English'

        # Create ObjectTranslation for Guidelines
        translation_id = str(uuid.uuid4())
        connection.execute(sa.text("""
            INSERT INTO object_translations
            (id, object_type, object_id, language, data, is_active, created_at, updated_at)
            VALUES
            (:id, 'guidelines', :object_id, :language, '{"authorNote": ""}', true, :now, :now)
        """), {'id': translation_id, 'object_id': guidelines_id, 'language': language, 'now': now})

        # Create ObjectVersion for Guidelines
        version_id = str(uuid.uuid4())
        version_data = '{"' + language + '": {"authorNote": ""}}'
        connection.execute(sa.text("""
            INSERT INTO object_versions
            (id, object_type, object_id, version_number, data, user_request, created_at)
            VALUES
            (:id, 'guidelines', :object_id, 1, :data, 'Migration', :now)
        """), {'id': version_id, 'object_id': guidelines_id, 'data': version_data, 'now': now})


def downgrade() -> None:
    connection = op.get_bind()

    # 1. Delete guidelines translations and versions
    connection.execute(sa.text("DELETE FROM object_versions WHERE object_type = 'guidelines'"))
    connection.execute(sa.text("DELETE FROM object_translations WHERE object_type = 'guidelines'"))

    # 2. Drop index
    op.drop_index('idx_guidelines_project_id', table_name='guidelines')

    # 3. Drop guidelines table
    op.drop_table('guidelines')
