"""add_function_configs_and_temperature_to_settings

Revision ID: 001
Revises:
Create Date: 2025-10-18

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns with default values
    op.add_column('user_settings',
        sa.Column('function_configs', postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False,
                  server_default="""{
                      "chat": {"provider": "copilot", "model": "gpt-4o-mini", "temperature": 0.7},
                      "translation": {"provider": "copilot", "model": "gpt-4o", "temperature": 0.2},
                      "storyObjectEdit": {"provider": "copilot", "model": "gpt-4o", "temperature": 0.3},
                      "chapterGen": {"provider": "copilot", "model": "gpt-4o", "temperature": 0.7}
                  }"""))

    op.add_column('user_settings',
        sa.Column('provider_credentials', postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False,
                  server_default="""{
                      "copilot": {},
                      "openrouter": {"apiKey": ""},
                      "custom": {"baseUrl": "", "apiKey": ""}
                  }"""))

    op.add_column('user_settings',
        sa.Column('enable_prefill', sa.Boolean(), nullable=False, server_default='false'))

    op.add_column('user_settings',
        sa.Column('enable_thinking', sa.Boolean(), nullable=False, server_default='false'))

    # Migrate existing data from old columns to new format
    op.execute("""
        UPDATE user_settings
        SET
            function_configs = jsonb_build_object(
                'chat', jsonb_build_object('provider', active_provider, 'model', ai_model, 'temperature', 0.7),
                'translation', jsonb_build_object('provider', active_provider, 'model', ai_model, 'temperature', 0.2),
                'storyObjectEdit', jsonb_build_object('provider', active_provider, 'model', ai_model, 'temperature', 0.3),
                'chapterGen', jsonb_build_object('provider', active_provider, 'model', ai_model, 'temperature', 0.7)
            ),
            provider_credentials = jsonb_build_object(
                'copilot', '{}'::jsonb,
                'openrouter', COALESCE(providers_config->'openrouter', '{"apiKey": ""}'::jsonb),
                'custom', COALESCE(providers_config->'custom', '{"baseUrl": "", "apiKey": ""}'::jsonb)
            )
        WHERE active_provider IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_column('user_settings', 'enable_thinking')
    op.drop_column('user_settings', 'enable_prefill')
    op.drop_column('user_settings', 'provider_credentials')
    op.drop_column('user_settings', 'function_configs')
