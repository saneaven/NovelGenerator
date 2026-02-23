"""Remove all prefill functionality.

Drop the captured_history_prefill column from threads,
strip enable_prefill from task config advanced settings,
and remove prefill blocks from prompt scenario versions.
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0004_remove_prefill"
down_revision = "0003_prompt_scenarios"
branch_labels = None
depends_on = None


def _strip_enable_prefill_from_task_configs(task_configs: dict[str, Any]) -> dict[str, Any]:
    changed = False
    for _key, cfg in task_configs.items():
        if not isinstance(cfg, dict):
            continue
        adv = cfg.get("advanced")
        if isinstance(adv, dict) and "enable_prefill" in adv:
            del adv["enable_prefill"]
            changed = True
    return task_configs if changed else task_configs


def _remove_prefill_blocks(scenario_doc: dict[str, Any]) -> bool:
    blocks = scenario_doc.get("blocks")
    if not isinstance(blocks, list):
        return False
    original_len = len(blocks)
    filtered = [
        b for b in blocks
        if not (
            isinstance(b, dict)
            and b.get("type") == "staticPrompt"
            and isinstance(b.get("staticPrompt"), dict)
            and b["staticPrompt"].get("subtype") == "prefill"
        )
    ]
    if len(filtered) == original_len:
        return False
    # Re-normalize block_order
    for i, block in enumerate(filtered):
        block["block_order"] = i
    scenario_doc["blocks"] = filtered
    return True


def upgrade() -> None:
    # 1) Drop captured_history_prefill column from threads
    with op.batch_alter_table("threads") as batch_op:
        batch_op.drop_column("captured_history_prefill")

    # 2) Strip enable_prefill from user_settings.task_configs
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, task_configs FROM user_settings WHERE task_configs IS NOT NULL"))
    for row in rows:
        task_configs = row.task_configs if isinstance(row.task_configs, dict) else json.loads(row.task_configs) if row.task_configs else None
        if not task_configs:
            continue
        _strip_enable_prefill_from_task_configs(task_configs)
        conn.execute(
            sa.text("UPDATE user_settings SET task_configs = :tc WHERE id = :id"),
            {"tc": json.dumps(task_configs), "id": row.id},
        )

    # 3) Remove prefill blocks from prompt_scenario_versions
    rows = conn.execute(sa.text("SELECT id, scenario FROM prompt_scenario_versions WHERE scenario IS NOT NULL"))
    for row in rows:
        doc = row.scenario if isinstance(row.scenario, dict) else json.loads(row.scenario) if row.scenario else None
        if not doc:
            continue
        if _remove_prefill_blocks(doc):
            conn.execute(
                sa.text("UPDATE prompt_scenario_versions SET scenario = :doc WHERE id = :id"),
                {"doc": json.dumps(doc), "id": row.id},
            )


def downgrade() -> None:
    raise NotImplementedError("Destructive migration — cannot downgrade")
