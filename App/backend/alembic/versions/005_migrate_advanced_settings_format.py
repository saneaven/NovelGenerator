"""migrate_advanced_settings_format

Revision ID: 005
Revises: 004
Create Date: 2025-10-27

Migrate advanced settings from enableThinking to thinkingMode + reasoningConfig.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
import json

# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Migrate function_configs advanced settings from old format to new format.
    Old: {'enablePrefill': bool, 'enableThinking': bool}
    New: {'enablePrefill': bool, 'thinkingMode': str, 'reasoningConfig': {'effort': str}}
    """
    # Get connection
    conn = op.get_bind()

    # Fetch all user settings
    result = conn.execute(sa.text("SELECT id, function_configs FROM user_settings"))

    for row in result:
        user_settings_id = row[0]
        function_configs = row[1]

        if not function_configs:
            continue

        # Migrate each function config
        updated = False
        for func_type, config in function_configs.items():
            if 'advanced' in config:
                advanced = config['advanced']

                # Check if old format exists
                if 'enableThinking' in advanced and 'thinkingMode' not in advanced:
                    # Migrate from enableThinking to thinkingMode
                    enable_thinking = advanced.pop('enableThinking')
                    advanced['thinkingMode'] = 'custom' if enable_thinking else 'off'
                    updated = True

                # Ensure reasoningConfig exists
                if 'reasoningConfig' not in advanced:
                    advanced['reasoningConfig'] = {'effort': 'medium'}
                    updated = True

        # Update the row if changes were made
        if updated:
            conn.execute(
                sa.text("UPDATE user_settings SET function_configs = CAST(:configs AS jsonb) WHERE id = :id"),
                {'configs': json.dumps(function_configs), 'id': user_settings_id}
            )


def downgrade() -> None:
    """
    Revert advanced settings from new format back to old format.
    New: {'enablePrefill': bool, 'thinkingMode': str, 'reasoningConfig': {...}}
    Old: {'enablePrefill': bool, 'enableThinking': bool}
    """
    # Get connection
    conn = op.get_bind()

    # Fetch all user settings
    result = conn.execute(sa.text("SELECT id, function_configs FROM user_settings"))

    for row in result:
        user_settings_id = row[0]
        function_configs = row[1]

        if not function_configs:
            continue

        # Migrate each function config
        updated = False
        for func_type, config in function_configs.items():
            if 'advanced' in config:
                advanced = config['advanced']

                # Check if new format exists
                if 'thinkingMode' in advanced and 'enableThinking' not in advanced:
                    # Convert thinkingMode to enableThinking
                    thinking_mode = advanced.pop('thinkingMode')
                    advanced['enableThinking'] = thinking_mode != 'off'
                    updated = True

                # Remove reasoningConfig
                if 'reasoningConfig' in advanced:
                    advanced.pop('reasoningConfig')
                    updated = True

        # Update the row if changes were made
        if updated:
            conn.execute(
                sa.text("UPDATE user_settings SET function_configs = CAST(:configs AS jsonb) WHERE id = :id"),
                {'configs': json.dumps(function_configs), 'id': user_settings_id}
            )

