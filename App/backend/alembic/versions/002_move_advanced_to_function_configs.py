"""move_advanced_settings_to_function_configs

Revision ID: 002
Revises: 001
Create Date: 2025-10-20

Move enable_prefill and enable_thinking from global columns
into per-function advanced settings in function_configs JSONB.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Migrate enable_prefill and enable_thinking into function_configs.advanced
    for each function, then drop the old columns.
    """

    # Step 1: Migrate existing data - add 'advanced' object to each function config
    # using the current global enable_prefill and enable_thinking values
    op.execute("""
        UPDATE user_settings
        SET function_configs = jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        function_configs,
                        '{chat,advanced}',
                        jsonb_build_object(
                            'enablePrefill', COALESCE(enable_prefill, false),
                            'enableThinking', COALESCE(enable_thinking, false)
                        )
                    ),
                    '{translation,advanced}',
                    jsonb_build_object(
                        'enablePrefill', COALESCE(enable_prefill, false),
                        'enableThinking', COALESCE(enable_thinking, false)
                    )
                ),
                '{storyObjectEdit,advanced}',
                jsonb_build_object(
                    'enablePrefill', COALESCE(enable_prefill, false),
                    'enableThinking', COALESCE(enable_thinking, false)
                )
            ),
            '{chapterGen,advanced}',
            jsonb_build_object(
                'enablePrefill', true,
                'enableThinking', COALESCE(enable_thinking, false)
            )
        )
        WHERE function_configs IS NOT NULL
    """)

    # Step 2: Drop the old columns
    op.drop_column('user_settings', 'enable_prefill')
    op.drop_column('user_settings', 'enable_thinking')

    # Step 3: Update the server default for function_configs to include advanced settings
    op.alter_column('user_settings', 'function_configs',
                    server_default="""{
        "chat": {
            "provider": "copilot",
            "model": "gpt-4o-mini",
            "temperature": 0.7,
            "advanced": {"enablePrefill": false, "enableThinking": false}
        },
        "translation": {
            "provider": "copilot",
            "model": "gpt-4o",
            "temperature": 0.2,
            "advanced": {"enablePrefill": false, "enableThinking": false}
        },
        "storyObjectEdit": {
            "provider": "copilot",
            "model": "gpt-4o",
            "temperature": 0.3,
            "advanced": {"enablePrefill": false, "enableThinking": false}
        },
        "chapterGen": {
            "provider": "copilot",
            "model": "gpt-4o",
            "temperature": 0.7,
            "advanced": {"enablePrefill": true, "enableThinking": false}
        }
    }""")


def downgrade() -> None:
    """
    Restore enable_prefill and enable_thinking as global columns,
    extracting values from chat function's advanced settings.
    """

    # Step 1: Add back the columns
    op.add_column('user_settings',
        sa.Column('enable_prefill', sa.Boolean(), nullable=False, server_default='false'))

    op.add_column('user_settings',
        sa.Column('enable_thinking', sa.Boolean(), nullable=False, server_default='false'))

    # Step 2: Migrate data back - use chat function's advanced settings as global values
    op.execute("""
        UPDATE user_settings
        SET
            enable_prefill = COALESCE(
                (function_configs->'chat'->'advanced'->>'enablePrefill')::boolean,
                false
            ),
            enable_thinking = COALESCE(
                (function_configs->'chat'->'advanced'->>'enableThinking')::boolean,
                false
            )
        WHERE function_configs IS NOT NULL
    """)

    # Step 3: Remove 'advanced' keys from all function configs
    op.execute("""
        UPDATE user_settings
        SET function_configs = jsonb_build_object(
            'chat', function_configs->'chat' - 'advanced',
            'translation', function_configs->'translation' - 'advanced',
            'storyObjectEdit', function_configs->'storyObjectEdit' - 'advanced',
            'chapterGen', function_configs->'chapterGen' - 'advanced'
        )
        WHERE function_configs IS NOT NULL
    """)

    # Step 4: Restore old server default
    op.alter_column('user_settings', 'function_configs',
                    server_default="""{
        "chat": {"provider": "copilot", "model": "gpt-4o-mini", "temperature": 0.7},
        "translation": {"provider": "copilot", "model": "gpt-4o", "temperature": 0.2},
        "storyObjectEdit": {"provider": "copilot", "model": "gpt-4o", "temperature": 0.3},
        "chapterGen": {"provider": "copilot", "model": "gpt-4o", "temperature": 0.7}
    }""")
