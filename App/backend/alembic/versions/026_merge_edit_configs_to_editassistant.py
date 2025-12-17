"""merge_edit_configs_to_editassistant

Revision ID: 026
Revises: 025
Create Date: 2025-12-16

Merge 'manuscriptEdit' and 'storyObjectEdit' into a unified 'editAssistant' config:
1. function_configs JSONB column in user_settings table
2. function_type column in prompt_versions table
"""
from alembic import op
import sqlalchemy as sa

revision = '026'
down_revision = '025'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Merge 'manuscriptEdit' and 'storyObjectEdit' into 'editAssistant' in existing data.
    Uses manuscriptEdit settings as base if available, falls back to storyObjectEdit.
    """

    # Step 1: Merge configs in function_configs JSONB for user_settings
    # Create new editAssistant config from manuscriptEdit or storyObjectEdit, with temperature 0.7
    op.execute("""
        UPDATE user_settings
        SET function_configs = (
            function_configs
            - 'manuscriptEdit'
            - 'storyObjectEdit'
        ) || jsonb_build_object(
            'editAssistant', jsonb_build_object(
                'provider', COALESCE(
                    function_configs->'manuscriptEdit'->>'provider',
                    function_configs->'storyObjectEdit'->>'provider',
                    'openai'
                ),
                'model', COALESCE(
                    function_configs->'manuscriptEdit'->>'model',
                    function_configs->'storyObjectEdit'->>'model',
                    'gpt-4o'
                ),
                'temperature', 0.7,
                'advanced', COALESCE(
                    function_configs->'manuscriptEdit'->'advanced',
                    function_configs->'storyObjectEdit'->'advanced',
                    '{"enablePrefill": true, "thinkingMode": "disabled", "thinkingConfig": {"budgetTokens": 10000}}'::jsonb
                )
            )
        )
        WHERE function_configs ? 'manuscriptEdit'
           OR function_configs ? 'storyObjectEdit'
    """)

    # Step 2: Update function_type in prompt_versions table
    # Map both old types to the new editAssistant type
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'editAssistant'
        WHERE function_type IN ('manuscriptEdit', 'storyObjectEdit')
    """)


def downgrade() -> None:
    """
    Split 'editAssistant' back into 'manuscriptEdit' and 'storyObjectEdit'.
    """

    # Step 1: Split editAssistant back into separate configs
    op.execute("""
        UPDATE user_settings
        SET function_configs = (
            function_configs - 'editAssistant'
        ) || jsonb_build_object(
            'manuscriptEdit', jsonb_build_object(
                'provider', COALESCE(function_configs->'editAssistant'->>'provider', 'openai'),
                'model', COALESCE(function_configs->'editAssistant'->>'model', 'gpt-4o'),
                'temperature', 0.7,
                'advanced', COALESCE(
                    function_configs->'editAssistant'->'advanced',
                    '{"enablePrefill": true, "thinkingMode": "disabled", "thinkingConfig": {"budgetTokens": 10000}}'::jsonb
                )
            ),
            'storyObjectEdit', jsonb_build_object(
                'provider', COALESCE(function_configs->'editAssistant'->>'provider', 'openai'),
                'model', COALESCE(function_configs->'editAssistant'->>'model', 'gpt-4o'),
                'temperature', 0.3,
                'advanced', COALESCE(
                    function_configs->'editAssistant'->'advanced',
                    '{"enablePrefill": true, "thinkingMode": "disabled", "thinkingConfig": {"budgetTokens": 10000}}'::jsonb
                )
            )
        )
        WHERE function_configs ? 'editAssistant'
    """)

    # Step 2: Note: We cannot fully reverse function_type changes since we don't know
    # which prompts were originally manuscriptEdit vs storyObjectEdit.
    # Leave them as editAssistant - the old code won't work anyway without the old prompts.
