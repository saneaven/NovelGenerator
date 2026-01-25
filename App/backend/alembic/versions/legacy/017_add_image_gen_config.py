"""Add image_gen_config to user_settings

Revision ID: 017
Revises: 016
Create Date: 2025-12-01

Adds image_gen_config JSONB column to user_settings table for storing
image generation settings (provider, model, size, styles, provider-specific settings).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add image_gen_config JSONB column with default value
    op.add_column(
        'user_settings',
        sa.Column(
            'image_gen_config',
            postgresql.JSONB,
            nullable=True,
            server_default=sa.text(
                """'{
                    "provider": "openai",
                    "model": "gpt-image-1",
                    "size": "1024x1024",
                    "naturalStyles": [],
                    "tagBasedStyles": [],
                    "selectedNaturalStyleId": null,
                    "selectedTagBasedStyleId": null,
                    "openaiSettings": {"quality": "standard", "style": "natural"},
                    "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
                    "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"}
                }'::jsonb"""
            )
        )
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'image_gen_config')
