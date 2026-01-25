"""add_tag_based_prompt_columns

Revision ID: 015
Revises: 014
Create Date: 2025-12-01

Adds columns to support tag-based image generation (NovelAI):
1. generation_positive_prompt - For positive prompts in tag-based providers (separate from natural language prompt)
2. generation_negative_prompt - For negative prompts in tag-based providers
3. generation_settings - JSON column for provider-specific settings

Prompt storage strategy:
- Natural language providers (OpenAI, Gemini, xAI): use generation_prompt only
- Tag-based providers (NovelAI): use generation_positive_prompt and generation_negative_prompt only
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add positive prompt column for tag-based providers (NovelAI)
    # Kept separate from generation_prompt which is for natural language providers
    op.add_column(
        'assets',
        sa.Column('generation_positive_prompt', sa.Text, nullable=True)
    )

    # Add negative prompt column for tag-based providers (NovelAI)
    op.add_column(
        'assets',
        sa.Column('generation_negative_prompt', sa.Text, nullable=True)
    )

    # Add settings column for provider-specific settings (JSON)
    op.add_column(
        'assets',
        sa.Column('generation_settings', postgresql.JSONB, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('assets', 'generation_settings')
    op.drop_column('assets', 'generation_negative_prompt')
    op.drop_column('assets', 'generation_positive_prompt')
