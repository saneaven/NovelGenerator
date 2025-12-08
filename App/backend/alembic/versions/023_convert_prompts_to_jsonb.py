"""Convert generation prompt columns from TEXT to JSONB with StyledPrompt structure

Revision ID: 023_convert_prompts_to_jsonb
Revises: 022_add_asset_type_and_chapter_assets
Create Date: 2024-12-08

This migration converts the following columns in the assets table from TEXT to JSONB:
- generation_prompt
- generation_positive_prompt
- generation_negative_prompt

The new format is StyledPrompt: { "prefix": "", "content": "...", "postfix": "" }
Existing data is migrated with the old text value as "content".
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic
revision = '023_convert_prompts_to_jsonb'
down_revision = '022_add_asset_type_and_chapter_assets'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: Add new JSONB columns with temporary names
    op.add_column('assets', sa.Column('generation_prompt_new', JSONB, nullable=True))
    op.add_column('assets', sa.Column('generation_positive_prompt_new', JSONB, nullable=True))
    op.add_column('assets', sa.Column('generation_negative_prompt_new', JSONB, nullable=True))

    # Step 2: Migrate data from old TEXT columns to new JSONB columns
    # Convert existing text to StyledPrompt format: { "prefix": "", "content": old_value, "postfix": "" }
    op.execute("""
        UPDATE assets
        SET generation_prompt_new = jsonb_build_object(
            'prefix', '',
            'content', COALESCE(generation_prompt, ''),
            'postfix', ''
        )
        WHERE generation_prompt IS NOT NULL
    """)

    op.execute("""
        UPDATE assets
        SET generation_positive_prompt_new = jsonb_build_object(
            'prefix', '',
            'content', COALESCE(generation_positive_prompt, ''),
            'postfix', ''
        )
        WHERE generation_positive_prompt IS NOT NULL
    """)

    op.execute("""
        UPDATE assets
        SET generation_negative_prompt_new = jsonb_build_object(
            'prefix', '',
            'content', COALESCE(generation_negative_prompt, ''),
            'postfix', ''
        )
        WHERE generation_negative_prompt IS NOT NULL
    """)

    # Step 3: Drop old TEXT columns
    op.drop_column('assets', 'generation_prompt')
    op.drop_column('assets', 'generation_positive_prompt')
    op.drop_column('assets', 'generation_negative_prompt')

    # Step 4: Rename new columns to original names
    op.alter_column('assets', 'generation_prompt_new', new_column_name='generation_prompt')
    op.alter_column('assets', 'generation_positive_prompt_new', new_column_name='generation_positive_prompt')
    op.alter_column('assets', 'generation_negative_prompt_new', new_column_name='generation_negative_prompt')


def downgrade() -> None:
    # Step 1: Add old TEXT columns back
    op.add_column('assets', sa.Column('generation_prompt_old', sa.Text, nullable=True))
    op.add_column('assets', sa.Column('generation_positive_prompt_old', sa.Text, nullable=True))
    op.add_column('assets', sa.Column('generation_negative_prompt_old', sa.Text, nullable=True))

    # Step 2: Extract content from JSONB and put back to TEXT
    # Combine prefix + content + postfix into single string
    op.execute("""
        UPDATE assets
        SET generation_prompt_old = CONCAT(
            COALESCE(generation_prompt->>'prefix', ''),
            COALESCE(generation_prompt->>'content', ''),
            COALESCE(generation_prompt->>'postfix', '')
        )
        WHERE generation_prompt IS NOT NULL
    """)

    op.execute("""
        UPDATE assets
        SET generation_positive_prompt_old = CONCAT(
            COALESCE(generation_positive_prompt->>'prefix', ''),
            COALESCE(generation_positive_prompt->>'content', ''),
            COALESCE(generation_positive_prompt->>'postfix', '')
        )
        WHERE generation_positive_prompt IS NOT NULL
    """)

    op.execute("""
        UPDATE assets
        SET generation_negative_prompt_old = CONCAT(
            COALESCE(generation_negative_prompt->>'prefix', ''),
            COALESCE(generation_negative_prompt->>'content', ''),
            COALESCE(generation_negative_prompt->>'postfix', '')
        )
        WHERE generation_negative_prompt IS NOT NULL
    """)

    # Step 3: Drop JSONB columns
    op.drop_column('assets', 'generation_prompt')
    op.drop_column('assets', 'generation_positive_prompt')
    op.drop_column('assets', 'generation_negative_prompt')

    # Step 4: Rename old columns back
    op.alter_column('assets', 'generation_prompt_old', new_column_name='generation_prompt')
    op.alter_column('assets', 'generation_positive_prompt_old', new_column_name='generation_positive_prompt')
    op.alter_column('assets', 'generation_negative_prompt_old', new_column_name='generation_negative_prompt')
