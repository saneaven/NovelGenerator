"""One-off prompt() -> include migration for the latest prompt rows.

Usage:
  python -m App.backend.scripts.migrate_prompt_include_syntax
"""

from __future__ import annotations

import argparse
import copy
import re
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import PromptFragment, PromptScenarioVersion


DEFAULT_NOTE = "Auto-migrated prompt() syntax to include syntax"
_PROMPT_EXPR_RE = re.compile(
    r"""\{\{\s*prompt\(\s*(?P<quote>["'])(?P<path>[^"']+)(?P=quote)(?P<args>\s*,.*?)?\)\s*\}\}""",
    re.DOTALL,
)
_KWARG_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _split_top_level_commas(raw: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    escaped = False

    for ch in raw:
        if quote is not None:
            buf.append(ch)
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == quote:
                quote = None
            continue

        if ch in {"'", '"'}:
            quote = ch
            buf.append(ch)
            continue

        if ch in "([{":
            depth += 1
            buf.append(ch)
            continue

        if ch in ")]}":
            if depth > 0:
                depth -= 1
            buf.append(ch)
            continue

        if ch == "," and depth == 0:
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
            continue

        buf.append(ch)

    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _build_replacement(path: str, args_text: str | None) -> str:
    fragment_ref = f'fragment:{path.strip()}'
    if not args_text or not args_text.strip():
        return f'{{% include "{fragment_ref}" %}}'

    raw_kwargs = args_text.strip()
    if raw_kwargs.startswith(","):
        raw_kwargs = raw_kwargs[1:].strip()
    if not raw_kwargs:
        return f'{{% include "{fragment_ref}" %}}'

    assignments: list[str] = []
    for item in _split_top_level_commas(raw_kwargs):
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not _KWARG_NAME_RE.match(key):
            raise ValueError(f"invalid prompt() kwarg name: {key}")
        assignments.append(f"{key} = {value}")
    return f'{{% with {", ".join(assignments)} %}}{{% include "{fragment_ref}" %}}{{% endwith %}}'


def migrate_text(text: str) -> tuple[str, int]:
    replacements = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal replacements
        replacements += 1
        return _build_replacement(match.group("path"), match.group("args"))

    return _PROMPT_EXPR_RE.sub(repl, text), replacements


def _load_latest_fragments(db: Session) -> list[PromptFragment]:
    subq = (
        db.query(
            PromptFragment.user_id,
            PromptFragment.preset_id,
            PromptFragment.folder_id,
            PromptFragment.fragment_name,
            func.max(PromptFragment.version_number).label("max_version"),
        )
        .group_by(
            PromptFragment.user_id,
            PromptFragment.preset_id,
            PromptFragment.folder_id,
            PromptFragment.fragment_name,
        )
        .subquery()
    )

    return (
        db.query(PromptFragment)
        .join(
            subq,
            and_(
                PromptFragment.user_id == subq.c.user_id,
                PromptFragment.preset_id == subq.c.preset_id,
                PromptFragment.folder_id.is_not_distinct_from(subq.c.folder_id),
                PromptFragment.fragment_name == subq.c.fragment_name,
                PromptFragment.version_number == subq.c.max_version,
            ),
        )
        .all()
    )


def _load_latest_scenarios(db: Session) -> list[PromptScenarioVersion]:
    subq = (
        db.query(
            PromptScenarioVersion.user_id,
            PromptScenarioVersion.preset_id,
            PromptScenarioVersion.task_type,
            PromptScenarioVersion.task_subtype,
            func.max(PromptScenarioVersion.version_number).label("max_version"),
        )
        .group_by(
            PromptScenarioVersion.user_id,
            PromptScenarioVersion.preset_id,
            PromptScenarioVersion.task_type,
            PromptScenarioVersion.task_subtype,
        )
        .subquery()
    )

    return (
        db.query(PromptScenarioVersion)
        .join(
            subq,
            and_(
                PromptScenarioVersion.user_id == subq.c.user_id,
                PromptScenarioVersion.preset_id == subq.c.preset_id,
                PromptScenarioVersion.task_type == subq.c.task_type,
                PromptScenarioVersion.task_subtype == subq.c.task_subtype,
                PromptScenarioVersion.version_number == subq.c.max_version,
            ),
        )
        .all()
    )


def _migrate_scenario_payload(scenario: dict[str, Any]) -> tuple[dict[str, Any], int]:
    updated = copy.deepcopy(scenario)
    replacements = 0

    system_template = updated.get("system_template")
    if isinstance(system_template, str):
        updated["system_template"], count = migrate_text(system_template)
        replacements += count

    blocks = updated.get("blocks")
    if not isinstance(blocks, list):
        return updated, replacements

    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "staticPrompt":
            static_prompt = block.get("staticPrompt")
            if isinstance(static_prompt, dict) and isinstance(static_prompt.get("template"), str):
                static_prompt["template"], count = migrate_text(static_prompt["template"])
                replacements += count
            continue

        if block.get("type") != "rangeMapping":
            continue
        mapping = block.get("rangeMapping")
        if not isinstance(mapping, dict):
            continue
        if isinstance(mapping.get("user_template"), str):
            mapping["user_template"], count = migrate_text(mapping["user_template"])
            replacements += count
        if isinstance(mapping.get("assistant_template"), str):
            mapping["assistant_template"], count = migrate_text(mapping["assistant_template"])
            replacements += count

    return updated, replacements


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate prompt() syntax to include syntax")
    parser.add_argument("--note", default=DEFAULT_NOTE)
    args = parser.parse_args()

    db: Session = SessionLocal()
    try:
        latest_fragments = _load_latest_fragments(db)
        latest_scenarios = _load_latest_scenarios(db)
        now = datetime.utcnow()
        changed_preset_ids: set[uuid.UUID] = set()

        fragment_rows = 0
        fragment_replacements = 0
        for row in latest_fragments:
            updated_content, replacements = migrate_text(row.content)
            if replacements == 0:
                continue
            fragment_rows += 1
            fragment_replacements += replacements
            changed_preset_ids.add(row.preset_id)
            db.add(
                PromptFragment(
                    id=uuid.uuid4(),
                    user_id=row.user_id,
                    preset_id=row.preset_id,
                    folder_id=row.folder_id,
                    fragment_name=row.fragment_name,
                    content=updated_content,
                    description=row.description,
                    version_number=int(row.version_number) + 1,
                    note=args.note,
                    created_at=now,
                    updated_at=now,
                )
            )

        scenario_rows = 0
        scenario_replacements = 0
        for row in latest_scenarios:
            if not isinstance(row.scenario, dict):
                continue
            updated_scenario, replacements = _migrate_scenario_payload(row.scenario)
            if replacements == 0:
                continue
            scenario_rows += 1
            scenario_replacements += replacements
            changed_preset_ids.add(row.preset_id)
            db.add(
                PromptScenarioVersion(
                    id=uuid.uuid4(),
                    user_id=row.user_id,
                    preset_id=row.preset_id,
                    task_type=row.task_type,
                    task_subtype=row.task_subtype,
                    scenario=updated_scenario,
                    version_number=int(row.version_number) + 1,
                    is_default=False,
                    note=args.note,
                    created_at=now,
                )
            )

        db.commit()

        print("presets_changed:", len(changed_preset_ids))
        print("fragment_rows_changed:", fragment_rows)
        print("scenario_rows_changed:", scenario_rows)
        print("fragment_prompt_replacements:", fragment_replacements)
        print("scenario_prompt_replacements:", scenario_replacements)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
