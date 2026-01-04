"""rename_chat_to_agent

Revision ID: 037
Revises: 036
Create Date: 2026-01-01

Rename 'chats' table to 'agents' and 'chat_messages' to 'agent_messages'.
Update all related foreign keys and JSONB configs.
"""
from alembic import op

revision = '037'
down_revision = '036'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Rename chat-related tables and update all references to 'agent'.
    """
    # 1. Rename tables
    op.rename_table('chats', 'agents')
    op.rename_table('chat_messages', 'agent_messages')

    # 2. Rename foreign key column in agent_messages
    op.alter_column('agent_messages', 'chat_id', new_column_name='agent_id')

    # 3. Update function_configs JSONB: rename 'chat' key to 'agent'
    op.execute("""
        UPDATE user_settings
        SET function_configs = (
            function_configs - 'chat' ||
            jsonb_build_object('agent', function_configs->'chat')
        )
        WHERE function_configs ? 'chat'
    """)

    # 4. Update prompt_versions function_type: 'chat' -> 'agent'
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'agent'
        WHERE function_type = 'chat'
    """)


def downgrade() -> None:
    """
    Revert all changes back to 'chat' naming.
    """
    # 1. Revert prompt_versions function_type
    op.execute("""
        UPDATE prompt_versions
        SET function_type = 'chat'
        WHERE function_type = 'agent'
    """)

    # 2. Revert function_configs JSONB: rename 'agent' key back to 'chat'
    op.execute("""
        UPDATE user_settings
        SET function_configs = (
            function_configs - 'agent' ||
            jsonb_build_object('chat', function_configs->'agent')
        )
        WHERE function_configs ? 'agent'
    """)

    # 3. Rename foreign key column back
    op.alter_column('agent_messages', 'agent_id', new_column_name='chat_id')

    # 4. Rename tables back
    op.rename_table('agent_messages', 'chat_messages')
    op.rename_table('agents', 'chats')
