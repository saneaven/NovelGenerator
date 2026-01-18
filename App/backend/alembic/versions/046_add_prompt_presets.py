"""add_prompt_presets

Revision ID: 046
Revises: 045
Create Date: 2026-01-17

Create prompt_presets table and add preset_id to prompt_versions, prompt_fragments, prompt_variables.
Migrate existing data to a default preset per user.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = '046'
down_revision = '045'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    1. Create prompt_presets table
    2. Add preset_id columns (nullable initially)
    3. Create default preset for each user with existing data
    4. Link existing data to default preset
    5. Make preset_id NOT NULL
    6. Add active_preset_id to user_settings
    """

    # 1. Create prompt_presets table
    op.create_table(
        'prompt_presets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Create indexes and constraints for prompt_presets
    op.create_index('idx_preset_user', 'prompt_presets', ['user_id'])
    op.create_unique_constraint('uq_preset_user_name', 'prompt_presets', ['user_id', 'name'])

    # 2. Add preset_id columns (nullable initially)
    op.add_column('prompt_versions', sa.Column('preset_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('prompt_fragments', sa.Column('preset_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('prompt_variables', sa.Column('preset_id', postgresql.UUID(as_uuid=True), nullable=True))

    # 3 & 4. Create default presets and link existing data using raw SQL
    conn = op.get_bind()

    # Get all distinct user_ids that have any prompt/fragment/variable data
    user_ids = conn.execute(sa.text("""
        SELECT DISTINCT user_id FROM (
            SELECT user_id FROM prompt_versions
            UNION
            SELECT user_id FROM prompt_fragments
            UNION
            SELECT user_id FROM prompt_variables
        ) AS all_users
    """)).fetchall()

    for (user_id,) in user_ids:
        # Create a default preset for this user
        preset_id = uuid.uuid4()
        conn.execute(sa.text("""
            INSERT INTO prompt_presets (id, user_id, name, description, created_at, updated_at)
            VALUES (:preset_id, :user_id, 'Default', 'Default prompt preset', NOW(), NOW())
        """), {"preset_id": preset_id, "user_id": user_id})

        # Link all existing data to this preset
        conn.execute(sa.text("""
            UPDATE prompt_versions SET preset_id = :preset_id WHERE user_id = :user_id
        """), {"preset_id": preset_id, "user_id": user_id})

        conn.execute(sa.text("""
            UPDATE prompt_fragments SET preset_id = :preset_id WHERE user_id = :user_id
        """), {"preset_id": preset_id, "user_id": user_id})

        conn.execute(sa.text("""
            UPDATE prompt_variables SET preset_id = :preset_id WHERE user_id = :user_id
        """), {"preset_id": preset_id, "user_id": user_id})

    # 5. Make preset_id NOT NULL and add foreign key constraints
    op.alter_column('prompt_versions', 'preset_id', nullable=False)
    op.alter_column('prompt_fragments', 'preset_id', nullable=False)
    op.alter_column('prompt_variables', 'preset_id', nullable=False)

    op.create_foreign_key(
        'fk_prompt_versions_preset_id',
        'prompt_versions', 'prompt_presets',
        ['preset_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_prompt_fragments_preset_id',
        'prompt_fragments', 'prompt_presets',
        ['preset_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_prompt_variables_preset_id',
        'prompt_variables', 'prompt_presets',
        ['preset_id'], ['id'],
        ondelete='CASCADE'
    )

    # Create indexes for preset_id columns
    op.create_index('idx_prompt_version_preset', 'prompt_versions', ['preset_id'])
    op.create_index('idx_prompt_fragment_preset', 'prompt_fragments', ['preset_id'])
    op.create_index('idx_prompt_variable_preset', 'prompt_variables', ['preset_id'])

    # 6. Add active_preset_id to user_settings
    op.add_column('user_settings', sa.Column('active_preset_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_user_settings_active_preset_id',
        'user_settings', 'prompt_presets',
        ['active_preset_id'], ['id'],
        ondelete='SET NULL'
    )

    # Set active_preset_id for existing users to their default preset
    conn.execute(sa.text("""
        UPDATE user_settings us
        SET active_preset_id = (
            SELECT pp.id FROM prompt_presets pp
            WHERE pp.user_id = us.user_id AND pp.name = 'Default'
            LIMIT 1
        )
        WHERE EXISTS (
            SELECT 1 FROM prompt_presets pp
            WHERE pp.user_id = us.user_id AND pp.name = 'Default'
        )
    """))

    # Update variable constraint: change from user_id+name to preset_id+name
    op.drop_constraint('uq_variable_user_name', 'prompt_variables', type_='unique')
    op.drop_index('idx_variable_user_order', 'prompt_variables')
    op.create_unique_constraint('uq_variable_preset_name', 'prompt_variables', ['preset_id', 'name'])
    op.create_index('idx_variable_preset_order', 'prompt_variables', ['preset_id', 'display_order'])


def downgrade() -> None:
    """
    Reverse the migration - remove preset system.
    Note: This will lose preset associations; all data will remain but without preset grouping.
    """

    # Remove variable constraint changes
    op.drop_index('idx_variable_preset_order', 'prompt_variables')
    op.drop_constraint('uq_variable_preset_name', 'prompt_variables', type_='unique')
    op.create_unique_constraint('uq_variable_user_name', 'prompt_variables', ['user_id', 'name'])
    op.create_index('idx_variable_user_order', 'prompt_variables', ['user_id', 'display_order'])

    # Remove active_preset_id from user_settings
    op.drop_constraint('fk_user_settings_active_preset_id', 'user_settings', type_='foreignkey')
    op.drop_column('user_settings', 'active_preset_id')

    # Remove indexes for preset_id
    op.drop_index('idx_prompt_variable_preset', 'prompt_variables')
    op.drop_index('idx_prompt_fragment_preset', 'prompt_fragments')
    op.drop_index('idx_prompt_version_preset', 'prompt_versions')

    # Remove foreign key constraints
    op.drop_constraint('fk_prompt_variables_preset_id', 'prompt_variables', type_='foreignkey')
    op.drop_constraint('fk_prompt_fragments_preset_id', 'prompt_fragments', type_='foreignkey')
    op.drop_constraint('fk_prompt_versions_preset_id', 'prompt_versions', type_='foreignkey')

    # Remove preset_id columns
    op.drop_column('prompt_variables', 'preset_id')
    op.drop_column('prompt_fragments', 'preset_id')
    op.drop_column('prompt_versions', 'preset_id')

    # Drop prompt_presets table
    op.drop_constraint('uq_preset_user_name', 'prompt_presets', type_='unique')
    op.drop_index('idx_preset_user', 'prompt_presets')
    op.drop_table('prompt_presets')
