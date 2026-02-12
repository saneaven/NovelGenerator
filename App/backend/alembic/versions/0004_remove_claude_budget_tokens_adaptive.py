"""Remove claude_budget_tokens and default Claude model thinking effort to high.

Revision ID: 0004_remove_claude_budget_tokens_adaptive
Revises: 0003_normalize_task_config_naming
Create Date: 2026-02-12
"""

from __future__ import annotations

import json
from typing import Any, Dict, Tuple

from alembic import op
import sqlalchemy as sa


revision = "0004_remove_claude_budget_tokens_adaptive"
down_revision = "0003_normalize_task_config_naming"
branch_labels = None
depends_on = None


def _is_claude_model_mode(task_cfg: Dict[str, Any]) -> bool:
    provider = task_cfg.get("provider")
    advanced = task_cfg.get("advanced")
    if not isinstance(advanced, dict):
        return False

    thinking_mode = advanced.get("thinking_mode") or advanced.get("thinkingMode")
    if thinking_mode != "model":
        return False

    if provider == "claude":
        return True

    if provider != "custom":
        return False

    request_format = advanced.get("request_format") or advanced.get("requestFormat") or "openai_sdk"
    thinking_format = advanced.get("thinking_format") or advanced.get("customApiFormat") or "openai"
    return request_format == "claude_sdk" or thinking_format == "claude"


def _normalize_task_configs(task_configs: Any) -> Tuple[Any, bool]:
    if not isinstance(task_configs, dict):
        return task_configs, False

    changed = False
    out: Dict[str, Any] = {}
    for task_key, task_cfg in task_configs.items():
        if not isinstance(task_cfg, dict):
            out[task_key] = task_cfg
            continue

        cfg = dict(task_cfg)
        advanced = cfg.get("advanced")
        if not isinstance(advanced, dict):
            out[task_key] = cfg
            continue

        adv = dict(advanced)
        thinking_cfg = adv.get("thinking_config")

        if isinstance(thinking_cfg, dict):
            thinking = dict(thinking_cfg)
            if "claude_budget_tokens" in thinking:
                thinking.pop("claude_budget_tokens", None)
                changed = True
            if "claudeBudgetTokens" in thinking:
                thinking.pop("claudeBudgetTokens", None)
                changed = True

            if _is_claude_model_mode({"provider": cfg.get("provider"), "advanced": adv}):
                effort = thinking.get("effort")
                if not isinstance(effort, str) or not effort.strip():
                    thinking["effort"] = "high"
                    changed = True

            adv["thinking_config"] = thinking
        elif _is_claude_model_mode({"provider": cfg.get("provider"), "advanced": adv}):
            adv["thinking_config"] = {"effort": "high"}
            changed = True

        cfg["advanced"] = adv
        out[task_key] = cfg

    return out, changed


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, task_configs FROM user_settings")).fetchall()
    for row in rows:
        normalized, changed = _normalize_task_configs(row.task_configs)
        if not changed:
            continue
        bind.execute(
            sa.text("UPDATE user_settings SET task_configs = CAST(:cfg AS jsonb) WHERE id = :id"),
            {"id": str(row.id), "cfg": json.dumps(normalized)},
        )


def downgrade() -> None:
    # Irreversible cleanup migration:
    # - removed claude_budget_tokens values
    # - defaulted missing Claude model effort to "high"
    pass
