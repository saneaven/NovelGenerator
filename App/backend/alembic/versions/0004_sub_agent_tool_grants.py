"""Replace sub-agent allowed_tool_names with tool_grants."""

from __future__ import annotations

from collections import defaultdict

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0004_sub_agent_tool_grants"
down_revision = "0003_llm_log"
branch_labels = None
depends_on = None


_FEATURE_ORDER = (
    "project_data",
    "story_entity",
    "outline",
    "manuscript",
    "search",
    "project_tree",
    "image",
    "sub_agent",
    "mcp",
)
_CATEGORY_ORDER = (
    "read",
    "write",
    "delete",
    "translate",
    "sub_agent",
    "generate",
    "mcp",
)
_FEATURE_INDEX = {value: index for index, value in enumerate(_FEATURE_ORDER)}
_CATEGORY_INDEX = {value: index for index, value in enumerate(_CATEGORY_ORDER)}

_FEATURE_CATEGORY_TOOLS: dict[str, dict[str, tuple[str, ...]]] = {
    "project_data": {
        "write": (
            "replace_basic_info",
            "patch_basic_info",
            "replace_guidelines",
            "patch_guidelines",
        ),
        "translate": (
            "translate_basic_info",
            "patch_translation_basic_info",
            "translate_guidelines",
            "patch_translation_guidelines",
        ),
    },
    "story_entity": {
        "read": (
            "read_story_entity",
            "read_story_entity_folder",
        ),
        "write": (
            "create_story_entity",
            "replace_story_entity",
            "patch_story_entity",
            "create_story_entity_folder",
            "replace_story_entity_folder",
            "patch_story_entity_folder",
        ),
        "delete": (
            "delete_story_entity",
            "delete_story_entity_folder",
        ),
        "translate": (
            "translate_story_entity",
            "patch_translation_story_entity",
            "translate_story_entity_folder",
            "patch_translation_story_entity_folder",
        ),
    },
    "outline": {
        "read": ("read_outline",),
        "write": (
            "create_outline",
            "replace_outline",
            "patch_outline",
        ),
        "delete": ("delete_outline",),
        "translate": (
            "translate_outline",
            "patch_translation_outline",
        ),
    },
    "manuscript": {
        "read": ("read_manuscript",),
        "write": (
            "replace_manuscript",
            "patch_manuscript",
        ),
        "translate": (
            "translate_manuscript",
            "patch_translation_manuscript",
        ),
    },
    "search": {
        "read": (
            "search_keyword",
            "search_semantic",
        ),
    },
    "project_tree": {
        "read": ("get_project_tree",),
    },
    "image": {
        "generate": (
            "generate_object_image",
            "generate_scene_image",
        ),
    },
}

_TOOL_TO_GRANT: dict[str, tuple[str, str]] = {}
for _feature_key, _categories in _FEATURE_CATEGORY_TOOLS.items():
    for _category, _tool_names in _categories.items():
        for _tool_name in _tool_names:
            _TOOL_TO_GRANT[_tool_name] = (_feature_key, _category)


def _table_exists(conn, table: str) -> bool:
    return bool(conn.dialect.has_table(conn, table))


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.scalar() is not None


def _coerce_string_list(raw_value) -> list[str]:
    if not isinstance(raw_value, list):
        return []
    out: list[str] = []
    for item in raw_value:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
    return out


def _normalize_grants(raw_value) -> list[dict[str, object]]:
    grouped: dict[str, set[str]] = defaultdict(set)
    if not isinstance(raw_value, list):
        return []
    for item in raw_value:
        if not isinstance(item, dict):
            continue
        feature_key = str(item.get("feature_key") or "").strip()
        if not feature_key:
            continue
        categories = item.get("categories")
        if not isinstance(categories, list):
            continue
        for category in categories:
            if isinstance(category, str) and category.strip():
                grouped[feature_key].add(category.strip())
    return _serialize_grouped_grants(grouped)


def _serialize_grouped_grants(grouped: dict[str, set[str]]) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for feature_key in sorted(grouped, key=lambda value: (_FEATURE_INDEX.get(value, 999), value)):
        categories = sorted(
            grouped[feature_key],
            key=lambda value: (_CATEGORY_INDEX.get(value, 999), value),
        )
        if not categories:
            continue
        normalized.append(
            {
                "feature_key": feature_key,
                "categories": categories,
            }
        )
    return normalized


def _tool_names_to_grants(raw_names) -> list[dict[str, object]]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for tool_name in _coerce_string_list(raw_names):
        mapping = _TOOL_TO_GRANT.get(tool_name)
        if mapping is None:
            continue
        feature_key, category = mapping
        grouped[feature_key].add(category)
    return _serialize_grouped_grants(grouped)


def _merge_grants(existing, inferred) -> list[dict[str, object]]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for source in (_normalize_grants(existing), _normalize_grants(inferred)):
        for item in source:
            feature_key = str(item.get("feature_key") or "").strip()
            categories = item.get("categories")
            if not feature_key or not isinstance(categories, list):
                continue
            for category in categories:
                if isinstance(category, str) and category.strip():
                    grouped[feature_key].add(category.strip())
    return _serialize_grouped_grants(grouped)


def _grants_to_tool_names(raw_grants) -> list[str]:
    tool_names: set[str] = set()
    for item in _normalize_grants(raw_grants):
        feature_key = str(item.get("feature_key") or "").strip()
        categories = item.get("categories")
        if not feature_key or not isinstance(categories, list):
            continue
        feature_map = _FEATURE_CATEGORY_TOOLS.get(feature_key, {})
        for category in categories:
            if not isinstance(category, str):
                continue
            tool_names.update(feature_map.get(category, ()))
    return sorted(tool_names)


def upgrade() -> None:
    conn = op.get_bind()
    if not _table_exists(conn, "sub_agent_definitions"):
        return

    if not _column_exists(conn, "sub_agent_definitions", "tool_grants"):
        op.add_column(
            "sub_agent_definitions",
            sa.Column("tool_grants", JSONB, nullable=True, server_default=sa.text("'[]'::jsonb")),
        )

    if _column_exists(conn, "sub_agent_definitions", "allowed_tool_names"):
        select_stmt = sa.text(
            "SELECT id, allowed_tool_names, tool_grants FROM sub_agent_definitions"
        ).columns(
            sa.column("id"),
            sa.column("allowed_tool_names", JSONB),
            sa.column("tool_grants", JSONB),
        )
        update_stmt = sa.text(
            "UPDATE sub_agent_definitions SET tool_grants = :tool_grants WHERE id = :id"
        ).bindparams(sa.bindparam("tool_grants", type_=JSONB))

        for row in conn.execute(select_stmt).mappings():
            inferred = _tool_names_to_grants(row.get("allowed_tool_names"))
            merged = _merge_grants(row.get("tool_grants"), inferred)
            conn.execute(update_stmt, {"id": row["id"], "tool_grants": merged})

        op.drop_column("sub_agent_definitions", "allowed_tool_names")

    conn.execute(
        sa.text(
            "UPDATE sub_agent_definitions "
            "SET tool_grants = '[]'::jsonb "
            "WHERE tool_grants IS NULL"
        )
    )
    op.alter_column(
        "sub_agent_definitions",
        "tool_grants",
        existing_type=JSONB,
        nullable=False,
        server_default=None,
    )


def downgrade() -> None:
    conn = op.get_bind()
    if not _table_exists(conn, "sub_agent_definitions"):
        return

    if not _column_exists(conn, "sub_agent_definitions", "allowed_tool_names"):
        op.add_column(
            "sub_agent_definitions",
            sa.Column("allowed_tool_names", JSONB, nullable=True, server_default=sa.text("'[]'::jsonb")),
        )

    if _column_exists(conn, "sub_agent_definitions", "tool_grants"):
        select_stmt = sa.text(
            "SELECT id, tool_grants FROM sub_agent_definitions"
        ).columns(
            sa.column("id"),
            sa.column("tool_grants", JSONB),
        )
        update_stmt = sa.text(
            "UPDATE sub_agent_definitions SET allowed_tool_names = :allowed_tool_names WHERE id = :id"
        ).bindparams(sa.bindparam("allowed_tool_names", type_=JSONB))

        for row in conn.execute(select_stmt).mappings():
            conn.execute(
                update_stmt,
                {
                    "id": row["id"],
                    "allowed_tool_names": _grants_to_tool_names(row.get("tool_grants")),
                },
            )

        op.drop_column("sub_agent_definitions", "tool_grants")

    conn.execute(
        sa.text(
            "UPDATE sub_agent_definitions "
            "SET allowed_tool_names = '[]'::jsonb "
            "WHERE allowed_tool_names IS NULL"
        )
    )
    op.alter_column(
        "sub_agent_definitions",
        "allowed_tool_names",
        existing_type=JSONB,
        nullable=False,
        server_default=None,
    )
