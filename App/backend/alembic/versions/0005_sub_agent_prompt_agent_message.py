"""Rewrite Sub Agent prompt templates to use {{input.agentMessage}}.

Forward-only cleanup (no legacy runtime branches):
- Replaces {{input.subagent}} and {{input.userMessage}} with {{input.agentMessage}}
  for prompt_versions rows where task_type = 'subAgent'.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_sub_agent_prompt_vars"
down_revision = "0004_sub_agent_desc_required"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("prompt_versions"):
        return

    # Handle both {{ ... }} and {{{ ... }}} variants with optional whitespace.
    op.execute(
        r"""
        UPDATE prompt_versions
        SET content =
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  content,
                  '\{\{\{\s*input\.subagent\s*\}\}\}',
                  '{{{input.agentMessage}}}',
                  'g'
                ),
                '\{\{\{\s*input\.userMessage\s*\}\}\}',
                '{{{input.agentMessage}}}',
                'g'
              ),
              '\{\{\s*input\.subagent\s*\}\}',
              '{{input.agentMessage}}',
              'g'
            ),
            '\{\{\s*input\.userMessage\s*\}\}',
            '{{input.agentMessage}}',
            'g'
          )
        WHERE task_type = 'subAgent'
        """
    )


def downgrade() -> None:
    # Irreversible in general (we can't know whether a given {{input.agentMessage}}
    # used to be userMessage vs subagent). Keep as no-op.
    return

