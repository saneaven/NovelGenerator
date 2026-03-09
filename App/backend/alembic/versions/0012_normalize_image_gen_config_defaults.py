"""Normalize stored image generation config values after image model refresh.

Revision ID: 0012_normalize_image_gen_config_defaults
Revises: 0011_storage_usage_reconcile_metadata
Create Date: 2026-03-09
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0012_normalize_image_gen_config_defaults"
down_revision = "0011_storage_usage_reconcile_metadata"
branch_labels = None
depends_on = None


NEW_DEFAULT_IMAGE_GEN_CONFIG = json.dumps(
    {
        "provider": "openai",
        "model": "gpt-image-1.5",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {
            "quality": "auto",
            "background": "auto",
            "output_format": "png",
            "output_compression": 90,
            "input_fidelity": "high",
        },
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {
            "sampler": "k_euler_ancestral",
            "steps": 28,
            "scale": 6.0,
            "noise_schedule": "karras",
        },
    }
)

OLD_DEFAULT_IMAGE_GEN_CONFIG = json.dumps(
    {
        "provider": "openai",
        "model": "gpt-image-1",
        "size": "1024x1024",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": None,
        "selectedTagBasedStyleId": None,
        "openaiSettings": {"quality": "standard", "style": "natural"},
        "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
        "novelaiSettings": {
            "sampler": "k_euler_ancestral",
            "steps": 28,
            "scale": 6.0,
            "noise_schedule": "karras",
        },
    }
)


def _set_image_gen_default(payload: str) -> None:
    op.execute(
        sa.text(
            f"""
            ALTER TABLE user_settings
            ALTER COLUMN image_gen_config
            SET DEFAULT '{payload}'::jsonb
            """
        )
    )


def upgrade() -> None:
    _set_image_gen_default(NEW_DEFAULT_IMAGE_GEN_CONFIG)

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = jsonb_set(
                image_gen_config,
                '{openaiSettings,quality}',
                '"medium"'::jsonb,
                true
            )
            WHERE image_gen_config #>> '{openaiSettings,quality}' = 'standard'
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = jsonb_set(
                image_gen_config,
                '{openaiSettings,quality}',
                '"high"'::jsonb,
                true
            )
            WHERE image_gen_config #>> '{openaiSettings,quality}' = 'hd'
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = image_gen_config #- '{openaiSettings,style}'
            WHERE image_gen_config #> '{openaiSettings,style}' IS NOT NULL
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = jsonb_set(
                image_gen_config,
                '{size}',
                '"1024x1536"'::jsonb,
                true
            )
            WHERE image_gen_config #>> '{provider}' = 'openai'
              AND image_gen_config #>> '{model}' IN ('dall-e-2', 'dall-e-3')
              AND image_gen_config #>> '{size}' = '1024x1792'
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = jsonb_set(
                image_gen_config,
                '{size}',
                '"1536x1024"'::jsonb,
                true
            )
            WHERE image_gen_config #>> '{provider}' = 'openai'
              AND image_gen_config #>> '{model}' IN ('dall-e-2', 'dall-e-3')
              AND image_gen_config #>> '{size}' = '1792x1024'
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = jsonb_set(
                image_gen_config,
                '{model}',
                '"gpt-image-1.5"'::jsonb,
                true
            )
            WHERE image_gen_config #>> '{provider}' = 'openai'
              AND image_gen_config #>> '{model}' IN ('dall-e-2', 'dall-e-3')
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE user_settings
            SET image_gen_config = jsonb_set(
                image_gen_config,
                '{model}',
                '"gemini-3.1-flash-image-preview"'::jsonb,
                true
            )
            WHERE image_gen_config #>> '{provider}' = 'gemini'
              AND image_gen_config #>> '{model}' = 'gemini-2.0-flash-preview-image-generation'
            """
        )
    )


def downgrade() -> None:
    _set_image_gen_default(OLD_DEFAULT_IMAGE_GEN_CONFIG)
