"""Remove legacy staticPrompt subtype fields from stored scenario JSON.

Usage:
  python -m App.backend.scripts.migrate_memory_static_subtype
"""

from __future__ import annotations

import copy

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import PromptScenarioVersion


def _rewrite_scenario_payload(scenario: dict) -> tuple[dict, int]:
    updated = copy.deepcopy(scenario)
    replacements = 0

    blocks = updated.get("blocks")
    if not isinstance(blocks, list):
        return updated, replacements

    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "staticPrompt":
            continue
        static_prompt = block.get("staticPrompt")
        if not isinstance(static_prompt, dict):
            continue
        if "subtype" not in static_prompt:
            continue
        static_prompt.pop("subtype", None)
        replacements += 1

    return updated, replacements


def run(db: Session) -> tuple[int, int]:
    updated_rows = 0
    updated_blocks = 0

    for row in db.query(PromptScenarioVersion).all():
        scenario = row.scenario if isinstance(row.scenario, dict) else None
        if scenario is None:
            continue
        next_scenario, replacements = _rewrite_scenario_payload(scenario)
        if replacements <= 0:
            continue
        row.scenario = next_scenario
        updated_rows += 1
        updated_blocks += replacements

    db.commit()
    return updated_rows, updated_blocks


def main() -> None:
    db = SessionLocal()
    try:
        rows, blocks = run(db)
        print(f"Updated {rows} scenario rows and {blocks} staticPrompt blocks.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
