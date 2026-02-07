"""Sub Agents: global LLM config + per-agent overrides.

No legacy compatibility / transforms:
- Add sub_agent_definitions.use_custom_llm_config (default false).
- Rename sub_agent_definitions.llm_config -> llm_config_override and make it nullable.
- Ensure user_settings.task_configs has subAgent key (copy from agent if present).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0009_sub_agent_global_llm_config"
down_revision = "0008_sub_agent_allowed_inv"
branch_labels = None
depends_on = None


_DEFAULT_AGENT_CONFIG_JSON = (
    '{"provider":"openrouter","model":"gpt-4o-mini","temperature":0.7,'
    '"maxOutputTokens":null,"contextWindowTokens":32000,'
    '"advanced":{"enablePrefill":false,"thinkingMode":"off","thinkingConfig":{"effort":"medium"}}}'
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ---------------------------------------------------------------------
    # sub_agent_definitions
    # ---------------------------------------------------------------------
    if inspector.has_table("sub_agent_definitions"):
        cols = {c["name"] for c in inspector.get_columns("sub_agent_definitions")}

        if "use_custom_llm_config" not in cols:
            op.add_column(
                "sub_agent_definitions",
                sa.Column(
                    "use_custom_llm_config",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("false"),
                ),
            )
            op.alter_column("sub_agent_definitions", "use_custom_llm_config", server_default=None)

        cols = {c["name"] for c in inspector.get_columns("sub_agent_definitions")}

        if "llm_config_override" not in cols and "llm_config" in cols:
            op.alter_column(
                "sub_agent_definitions",
                "llm_config",
                new_column_name="llm_config_override",
            )

        cols = {c["name"] for c in inspector.get_columns("sub_agent_definitions")}
        if "llm_config_override" in cols:
            op.alter_column("sub_agent_definitions", "llm_config_override", nullable=True)

    # ---------------------------------------------------------------------
    # user_settings.task_configs backfill: add taskConfigs.subAgent if missing
    # ---------------------------------------------------------------------
    if inspector.has_table("user_settings"):
        cols = {c["name"] for c in inspector.get_columns("user_settings")}
        if "task_configs" in cols:
            op.execute(
                sa.text(
                    """
	                    UPDATE user_settings
	                    SET task_configs = jsonb_set(
	                        COALESCE(task_configs, '{}'::jsonb),
	                        '{subAgent}',
	                        COALESCE(NULLIF(task_configs->'agent', 'null'::jsonb), CAST(:default_agent AS jsonb)),
	                        true
	                    )
	                    WHERE NOT (COALESCE(task_configs, '{}'::jsonb) ? 'subAgent')
	                    """
	                ).bindparams(default_agent=_DEFAULT_AGENT_CONFIG_JSON)
            )


def downgrade() -> None:
    # Irreversible cleanup for early-stage schema refactor.
    return
