"""language_settings_redesign

Revision ID: 009
Revises: 008
Create Date: 2025-11-25

Migrate language settings from primary/secondary to main/sub languages system:
- primary_language -> main_language
- secondary_language -> sub_languages[] + default_sub_language
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Migrate to new language settings structure.
    """
    conn = op.get_bind()

    # Check if old columns exist
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('user_settings')]

    has_primary = 'primary_language' in columns
    has_secondary = 'secondary_language' in columns
    has_main = 'main_language' in columns
    has_sub = 'sub_languages' in columns
    has_default_sub = 'default_sub_language' in columns

    # Step 1: Add new columns if they don't exist
    if not has_main:
        op.add_column('user_settings',
            sa.Column('main_language', sa.String(50), nullable=True)
        )

    if not has_sub:
        op.add_column('user_settings',
            sa.Column('sub_languages', postgresql.JSONB, server_default='[]')
        )

    if not has_default_sub:
        op.add_column('user_settings',
            sa.Column('default_sub_language', sa.String(50), nullable=True)
        )

    # Step 2: Migrate data from old columns if they exist
    if has_primary and has_main:
        # Copy primary_language to main_language where main_language is null
        op.execute("""
            UPDATE user_settings
            SET main_language = primary_language
            WHERE main_language IS NULL AND primary_language IS NOT NULL
        """)

    if has_secondary:
        # Convert secondary_language to sub_languages array and set as default
        op.execute("""
            UPDATE user_settings
            SET sub_languages = CASE
                WHEN secondary_language IS NOT NULL AND secondary_language != ''
                THEN jsonb_build_array(secondary_language)
                ELSE '[]'::jsonb
            END,
            default_sub_language = secondary_language
            WHERE (sub_languages IS NULL OR sub_languages = '[]'::jsonb)
            AND secondary_language IS NOT NULL AND secondary_language != ''
        """)

    # Step 3: Set default value for main_language where still null
    op.execute("""
        UPDATE user_settings
        SET main_language = 'English'
        WHERE main_language IS NULL
    """)

    # Step 4: Make main_language NOT NULL
    op.alter_column('user_settings', 'main_language',
        existing_type=sa.String(50),
        nullable=False,
        server_default='English'
    )

    # Step 5: Drop old columns if they exist
    if has_primary:
        op.drop_column('user_settings', 'primary_language')

    if has_secondary:
        op.drop_column('user_settings', 'secondary_language')


def downgrade() -> None:
    """
    Revert to old language settings structure.
    WARNING: This may lose sub_languages data if there are multiple sub languages.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('user_settings')]

    has_primary = 'primary_language' in columns
    has_secondary = 'secondary_language' in columns
    has_main = 'main_language' in columns
    has_sub = 'sub_languages' in columns
    has_default_sub = 'default_sub_language' in columns

    # Step 1: Add old columns back
    if not has_primary:
        op.add_column('user_settings',
            sa.Column('primary_language', sa.String(50), nullable=True)
        )

    if not has_secondary:
        op.add_column('user_settings',
            sa.Column('secondary_language', sa.String(50), nullable=True)
        )

    # Step 2: Migrate data back
    if has_main:
        op.execute("""
            UPDATE user_settings
            SET primary_language = main_language
        """)

    if has_default_sub:
        op.execute("""
            UPDATE user_settings
            SET secondary_language = default_sub_language
        """)

    # Step 3: Set default and NOT NULL
    op.execute("""
        UPDATE user_settings
        SET primary_language = 'English'
        WHERE primary_language IS NULL
    """)

    op.alter_column('user_settings', 'primary_language',
        existing_type=sa.String(50),
        nullable=False,
        server_default='English'
    )

    # Step 4: Drop new columns
    if has_main:
        op.drop_column('user_settings', 'main_language')

    if has_sub:
        op.drop_column('user_settings', 'sub_languages')

    if has_default_sub:
        op.drop_column('user_settings', 'default_sub_language')
