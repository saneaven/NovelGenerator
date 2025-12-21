"""add_image_prompt_to_basic_info

Revision ID: 030
Revises: 029
Create Date: 2025-12-19

Adds image_prompt fields to basic_info table for cover image prompt management:
- image_prompt: Natural language prompt
- image_prompt_positive: NovelAI positive tags
- image_prompt_negative: NovelAI negative tags
"""
from alembic import op
import sqlalchemy as sa

revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add image_prompt columns to basic_info table
    op.add_column('basic_info', sa.Column('image_prompt', sa.Text(), nullable=True))
    op.add_column('basic_info', sa.Column('image_prompt_positive', sa.Text(), nullable=True))
    op.add_column('basic_info', sa.Column('image_prompt_negative', sa.Text(), nullable=True))


def downgrade() -> None:
    # Drop columns in reverse order
    op.drop_column('basic_info', 'image_prompt_negative')
    op.drop_column('basic_info', 'image_prompt_positive')
    op.drop_column('basic_info', 'image_prompt')
