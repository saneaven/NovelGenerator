"""rename_terminology

Revision ID: 056
Revises: 055
Create Date: 2026-01-23

Rename terminology throughout the database:
- function_configs → task_configs (user_settings)
- function_call_history_limit → tool_call_history_limit (user_settings)
- function_calls → tool_calls (agent_messages)
- function_type → task_type (prompt_versions)
"""
from alembic import op

revision = '056'
down_revision = '055'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename columns in user_settings
    op.alter_column('user_settings', 'function_configs', new_column_name='task_configs')
    op.alter_column('user_settings', 'function_call_history_limit', new_column_name='tool_call_history_limit')

    # Rename column in agent_messages
    op.alter_column('agent_messages', 'function_calls', new_column_name='tool_calls')

    # Rename column in prompt_versions
    op.alter_column('prompt_versions', 'function_type', new_column_name='task_type')


def downgrade() -> None:
    # Revert column names in user_settings
    op.alter_column('user_settings', 'task_configs', new_column_name='function_configs')
    op.alter_column('user_settings', 'tool_call_history_limit', new_column_name='function_call_history_limit')

    # Revert column name in agent_messages
    op.alter_column('agent_messages', 'tool_calls', new_column_name='function_calls')

    # Revert column name in prompt_versions
    op.alter_column('prompt_versions', 'task_type', new_column_name='function_type')
