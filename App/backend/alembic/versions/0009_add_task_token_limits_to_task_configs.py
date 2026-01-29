"""Backfill task token limits in user_settings.task_configs.

Revision ID: 0009_add_task_token_limits_to_task_configs
Revises: 0008_add_agent_memory_max_message_limits
Create Date: 2026-01-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009_add_task_token_limits_to_task_configs"
down_revision = "0008_add_agent_memory_max_message_limits"
branch_labels = None
depends_on = None


OLD_DEFAULT_TASK_CONFIGS = (
    '{"agent":{"provider":"openrouter","model":"gpt-4o-mini","temperature": 0.7,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"translation":{"provider":"openrouter","model":"gpt-4o","temperature": 0.2,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"editAssistant":{"provider":"openrouter","model":"gpt-4o","temperature": 0.7,'
    '"advanced":{"enablePrefill": true,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"imagePrompt":{"provider":"openrouter","model":"gpt-4o","temperature": 0.7,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"summary":{"provider":"openrouter","model":"gpt-4o-mini","temperature": 0.2,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}}}'
)


NEW_DEFAULT_TASK_CONFIGS = (
    '{"agent":{"provider":"openrouter","model":"gpt-4o-mini","temperature": 0.7,'
    '"maxOutputTokens": null,"contextWindowTokens": 32000,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"translation":{"provider":"openrouter","model":"gpt-4o","temperature": 0.2,'
    '"maxOutputTokens": null,"contextWindowTokens": 32000,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"editAssistant":{"provider":"openrouter","model":"gpt-4o","temperature": 0.7,'
    '"maxOutputTokens": null,"contextWindowTokens": 32000,'
    '"advanced":{"enablePrefill": true,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"imagePrompt":{"provider":"openrouter","model":"gpt-4o","temperature": 0.7,'
    '"maxOutputTokens": null,"contextWindowTokens": 32000,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}},'
    '"summary":{"provider":"openrouter","model":"gpt-4o-mini","temperature": 0.2,'
    '"maxOutputTokens": null,"contextWindowTokens": 32000,'
    '"advanced":{"enablePrefill": false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}}}'
)


def _backfill_token_limits(*, task_key: str) -> None:
    # Only set when the path is missing (SQL NULL), so we don't overwrite user overrides.
    op.execute(
        f"""
        UPDATE user_settings
        SET task_configs = jsonb_set(task_configs, '{{{task_key},contextWindowTokens}}', '32000'::jsonb, true)
        WHERE (task_configs #> '{{{task_key},contextWindowTokens}}') IS NULL
        """
    )
    op.execute(
        f"""
        UPDATE user_settings
        SET task_configs = jsonb_set(task_configs, '{{{task_key},maxOutputTokens}}', 'null'::jsonb, true)
        WHERE (task_configs #> '{{{task_key},maxOutputTokens}}') IS NULL
        """
    )


def upgrade() -> None:
    # Update default for new users.
    op.alter_column(
        "user_settings",
        "task_configs",
        server_default=sa.text(f"'{NEW_DEFAULT_TASK_CONFIGS}'::jsonb"),
    )

    for task in ("agent", "translation", "editAssistant", "imagePrompt", "summary"):
        _backfill_token_limits(task_key=task)


def downgrade() -> None:
    # Revert default.
    op.alter_column(
        "user_settings",
        "task_configs",
        server_default=sa.text(f"'{OLD_DEFAULT_TASK_CONFIGS}'::jsonb"),
    )

    # Best-effort removal of the new keys.
    for task in ("agent", "translation", "editAssistant", "imagePrompt", "summary"):
        op.execute(
            f"""
            UPDATE user_settings
            SET task_configs = task_configs #- '{{{task},contextWindowTokens}}'
            """
        )
        op.execute(
            f"""
            UPDATE user_settings
            SET task_configs = task_configs #- '{{{task},maxOutputTokens}}'
            """
        )
