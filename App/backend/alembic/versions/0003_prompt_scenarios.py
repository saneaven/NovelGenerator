"""Introduce prompt_scenario_versions and migrate from prompt_versions.

This migration:
1) Creates `prompt_scenario_versions` if it doesn't exist.
2) If `prompt_versions` exists, ports the latest prompt_category templates into a single
   ScenarioDocument per (preset_id, task_type, task_subtype) using fixed rules.
3) Drops `prompt_versions` after porting.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import uuid
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "0003_prompt_scenarios"
down_revision = "0002_drop_fragment_is_system_default"
branch_labels = None
depends_on = None


def _table_exists(bind: sa.engine.Connection, table_name: str) -> bool:
    inspector = inspect(bind)
    return table_name in set(inspector.get_table_names())


def _make_static_block(*, order: int, subtype: str, role: str, template: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "block_order": int(order),
        "enabled": True,
        "type": "staticPrompt",
        "staticPrompt": {
            "subtype": subtype,
            "role": role,
            "template": template,
        },
    }


def _make_range_block(
    *,
    order: int,
    start_index: int,
    end_index: int,
    user_template: str,
    assistant_template: str,
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "block_order": int(order),
        "enabled": True,
        "type": "rangeMapping",
        "rangeMapping": {
            "start_index": int(start_index),
            "end_index": int(end_index),
            "user_template": user_template,
            "assistant_template": assistant_template,
        },
    }


def _as_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _build_scenario_doc(*, task_type: str, task_subtype: str, categories: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], bool]:
    system_template = _as_str(categories.get("systemPrompt", {}).get("content"))
    prefill = _as_str(categories.get("prefill", {}).get("content"))
    memory_prompt = _as_str(categories.get("memoryPrompt", {}).get("content"))

    identity_assistant = "{{input.agentMessage}}"
    if task_type == "subAgent":
        identity_assistant = "{{input.subAgentMessage}}"

    blocks: list[dict[str, Any]] = []
    used_rows: list[dict[str, Any]] = []

    def use_category(key: str) -> str:
        row = categories.get(key) or {}
        if row:
            used_rows.append(row)
        return _as_str(row.get("content"))

    # memory/summary
    if task_type == "memory" and task_subtype == "summary":
        user_prompt = use_category("userPrompt")
        blocks.append(_make_static_block(order=0, subtype="normal", role="user", template=user_prompt))
        is_default = all(bool(r.get("is_default")) for r in used_rows) if used_rows else False
        return {"system_template": system_template, "blocks": blocks}, is_default

    # subAgent/{agent_name}
    if task_type == "subAgent":
        user_prompt = use_category("userPrompt")
        blocks.append(
            _make_range_block(
                order=0,
                start_index=0,
                end_index=-1,
                user_template=user_prompt,
                assistant_template=identity_assistant,
            )
        )
        if prefill.strip():
            used_rows.append(categories.get("prefill", {}))
            blocks.append(_make_static_block(order=1, subtype="prefill", role="assistant", template=prefill))
        is_default = all(bool(r.get("is_default")) for r in used_rows if isinstance(r, dict)) if used_rows else False
        return {"system_template": system_template, "blocks": blocks}, is_default

    # agent/planMode, agent/agentMode
    if task_type == "agent" and task_subtype in {"planMode", "agentMode"}:
        order = 0
        if memory_prompt.strip():
            used_rows.append(categories.get("memoryPrompt", {}))
            blocks.append(_make_static_block(order=order, subtype="memory", role="user", template=memory_prompt))
            order += 1

        user_prompt = use_category("userPrompt")
        first_user_prompt = use_category("firstUserPrompt")
        last_user_prompt = use_category("lastUserPrompt")

        blocks.append(
            _make_range_block(
                order=order,
                start_index=0,
                end_index=-2,
                user_template=user_prompt,
                assistant_template=identity_assistant,
            )
        )
        order += 1

        blocks.append(
            _make_range_block(
                order=order,
                start_index=0,
                end_index=0,
                user_template=first_user_prompt,
                assistant_template=identity_assistant,
            )
        )
        order += 1

        # Put `last` after `first` so N=1 prefers lastUserPrompt (owner overwrite).
        blocks.append(
            _make_range_block(
                order=order,
                start_index=-1,
                end_index=-1,
                user_template=last_user_prompt,
                assistant_template=identity_assistant,
            )
        )
        order += 1

        if prefill.strip():
            used_rows.append(categories.get("prefill", {}))
            blocks.append(_make_static_block(order=order, subtype="prefill", role="assistant", template=prefill))

        is_default = all(bool(r.get("is_default")) for r in used_rows if isinstance(r, dict)) if used_rows else False
        return {"system_template": system_template, "blocks": blocks}, is_default

    # translation/message
    if task_type == "translation" and task_subtype == "message":
        user_prompt = use_category("userPrompt")
        blocks.append(
            _make_range_block(
                order=0,
                start_index=0,
                end_index=-1,
                user_template=user_prompt,
                assistant_template=identity_assistant,
            )
        )
        if prefill.strip():
            used_rows.append(categories.get("prefill", {}))
            blocks.append(_make_static_block(order=1, subtype="prefill", role="assistant", template=prefill))
        is_default = all(bool(r.get("is_default")) for r in used_rows if isinstance(r, dict)) if used_rows else False
        return {"system_template": system_template, "blocks": blocks}, is_default

    # translation/object, editAssistant/*, imagePrompt/* (initialUserPrompt semantics)
    if task_type in {"translation", "editAssistant", "imagePrompt"}:
        user_prompt = use_category("userPrompt")
        initial_user_prompt = use_category("initialUserPrompt")
        last_user_prompt = _as_str(categories.get("lastUserPrompt", {}).get("content")) or user_prompt
        if categories.get("lastUserPrompt"):
            used_rows.append(categories.get("lastUserPrompt", {}))

        blocks.append(
            _make_range_block(
                order=0,
                start_index=0,
                end_index=-2,
                user_template=user_prompt,
                assistant_template=identity_assistant,
            )
        )
        blocks.append(
            _make_range_block(
                order=1,
                start_index=0,
                end_index=0,
                user_template=initial_user_prompt,
                assistant_template=identity_assistant,
            )
        )
        blocks.append(
            _make_range_block(
                order=2,
                start_index=1,
                end_index=-1,
                user_template=last_user_prompt,
                assistant_template=identity_assistant,
            )
        )
        if prefill.strip():
            used_rows.append(categories.get("prefill", {}))
            blocks.append(_make_static_block(order=3, subtype="prefill", role="assistant", template=prefill))
        is_default = all(bool(r.get("is_default")) for r in used_rows if isinstance(r, dict)) if used_rows else False
        return {"system_template": system_template, "blocks": blocks}, is_default

    # Fallback: keep a simple all-range mapping.
    user_prompt = use_category("userPrompt")
    blocks.append(
        _make_range_block(
            order=0,
            start_index=0,
            end_index=-1,
            user_template=user_prompt,
            assistant_template=identity_assistant,
        )
    )
    if memory_prompt.strip():
        used_rows.append(categories.get("memoryPrompt", {}))
        blocks.insert(0, _make_static_block(order=0, subtype="memory", role="user", template=memory_prompt))
        for i, blk in enumerate(blocks):
            blk["block_order"] = i
    if prefill.strip():
        used_rows.append(categories.get("prefill", {}))
        blocks.append(_make_static_block(order=len(blocks), subtype="prefill", role="assistant", template=prefill))
    is_default = all(bool(r.get("is_default")) for r in used_rows if isinstance(r, dict)) if used_rows else False
    return {"system_template": system_template, "blocks": blocks}, is_default


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "prompt_scenario_versions"):
        op.create_table(
            "prompt_scenario_versions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("preset_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("task_type", sa.String(length=50), nullable=False),
            sa.Column("task_subtype", sa.String(length=50), nullable=False),
            sa.Column("scenario", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["preset_id"], ["prompt_presets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "preset_id",
                "task_type",
                "task_subtype",
                "version_number",
                name="uq_scenario_preset_task_version",
            ),
        )
        op.create_index(
            "idx_scenario_preset_task",
            "prompt_scenario_versions",
            ["preset_id", "task_type", "task_subtype", "version_number"],
        )
        op.create_index("ix_prompt_scenario_versions_user_id", "prompt_scenario_versions", ["user_id"])
        op.create_index("ix_prompt_scenario_versions_preset_id", "prompt_scenario_versions", ["preset_id"])

    if not _table_exists(bind, "prompt_versions"):
        return

    # Read latest version per category (distinct-on is Postgres-specific).
    latest_rows = bind.execute(
        sa.text(
            """
            SELECT DISTINCT ON (preset_id, task_type, task_subtype, prompt_category)
              user_id,
              preset_id,
              task_type,
              task_subtype,
              prompt_category,
              content,
              is_default
            FROM prompt_versions
            ORDER BY preset_id, task_type, task_subtype, prompt_category, version_number DESC
            """
        )
    ).mappings().all()

    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in latest_rows:
        preset_id = str(row.get("preset_id"))
        task_type = str(row.get("task_type") or "")
        task_subtype = str(row.get("task_subtype") or "")
        key = (preset_id, task_type, task_subtype)
        entry = grouped.setdefault(
            key,
            {
                "user_id": str(row.get("user_id")),
                "preset_id": preset_id,
                "task_type": task_type,
                "task_subtype": task_subtype,
                "categories": {},
            },
        )
        cat = str(row.get("prompt_category") or "")
        entry["categories"][cat] = {
            "content": _as_str(row.get("content")),
            "is_default": bool(row.get("is_default")),
        }

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    insert_stmt = sa.text(
        """
        INSERT INTO prompt_scenario_versions
          (id, user_id, preset_id, task_type, task_subtype, scenario, version_number, is_default, note, created_at)
        VALUES
          (:id, :user_id, :preset_id, :task_type, :task_subtype, :scenario, :version_number, :is_default, :note, :created_at)
        """
    )

    for (_, task_type, task_subtype), entry in grouped.items():
        scenario_doc, is_default = _build_scenario_doc(
            task_type=task_type,
            task_subtype=task_subtype,
            categories=entry["categories"],
        )
        bind.execute(
            insert_stmt,
            {
                "id": str(uuid.uuid4()),
                "user_id": entry["user_id"],
                "preset_id": entry["preset_id"],
                "task_type": task_type,
                "task_subtype": task_subtype,
                "scenario": json.dumps(scenario_doc, ensure_ascii=False),
                "version_number": 1,
                "is_default": bool(is_default),
                "note": "Migrated from prompt_versions",
                "created_at": now,
            },
        )

    op.drop_table("prompt_versions")


def downgrade() -> None:
    # This migration is intentionally non-reversible. Recreating prompt_versions is out of scope.
    pass
