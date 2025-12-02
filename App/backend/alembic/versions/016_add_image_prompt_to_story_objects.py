"""add_image_prompt_to_story_objects

Revision ID: 016
Revises: 015
Create Date: 2025-12-01

Adds image prompt columns to story object tables (characters, locations, organizations, lorebook_entries).
These allow storing reusable image generation prompts per object:
- image_prompt: Natural language prompt (for OpenAI, Gemini, xAI)
- image_prompt_positive: Positive tags (for NovelAI)
- image_prompt_negative: Negative tags (for NovelAI)
"""
from alembic import op
import sqlalchemy as sa

revision = '016'
down_revision = '015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add image_prompt columns to all story object tables
    tables = ['characters', 'locations', 'organizations', 'lorebook_entries']

    for table in tables:
        op.add_column(
            table,
            sa.Column('image_prompt', sa.Text, nullable=True)
        )
        op.add_column(
            table,
            sa.Column('image_prompt_positive', sa.Text, nullable=True)
        )
        op.add_column(
            table,
            sa.Column('image_prompt_negative', sa.Text, nullable=True)
        )


def downgrade() -> None:
    tables = ['characters', 'locations', 'organizations', 'lorebook_entries']

    for table in tables:
        op.drop_column(table, 'image_prompt_negative')
        op.drop_column(table, 'image_prompt_positive')
        op.drop_column(table, 'image_prompt')
