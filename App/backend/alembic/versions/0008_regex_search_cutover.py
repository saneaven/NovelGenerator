"""Rename search keyword settings to regex settings."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Session


revision = "0008_regex_search_cutover"
down_revision = "0007_fix_timeline_date_ranges"
branch_labels = None
depends_on = None


def _rewrite_search_settings(payload: object) -> dict | None:
    if not isinstance(payload, dict):
        return None

    next_payload = dict(payload)
    general = next_payload.get("general")
    if isinstance(general, dict):
        next_general = dict(general)
        if "keywordPageSize" in next_general:
            next_general["regexPageSize"] = next_general.pop("keywordPageSize")
        next_general.setdefault("regexPageSize", 20)
        next_payload["general"] = next_general
    else:
        next_payload["general"] = {
            "embedding": {"provider": "openai", "model": "", "dimensions": None},
            "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
            "regexPageSize": 20,
        }

    overrides = next_payload.get("overrides")
    if not isinstance(overrides, dict):
        next_payload["overrides"] = {}
        return next_payload

    next_overrides = dict(overrides)
    search_override = next_overrides.get("search")
    if isinstance(search_override, dict):
        next_search_override = dict(search_override)
        if "keywordPageSize" in next_search_override:
            next_search_override["regexPageSize"] = next_search_override.pop("keywordPageSize")
        next_search_override.setdefault(
            "regexPageSize",
            int(next_payload["general"].get("regexPageSize") or 20),
        )
        next_overrides["search"] = next_search_override

    next_payload["overrides"] = next_overrides
    return next_payload


def upgrade() -> None:
    op.alter_column(
        "user_settings",
        "search_memory_settings",
        server_default=sa.text(
            """'{
        "enabled": false,
        "general": {
            "embedding": {"provider": "openai", "model": "", "dimensions": null},
            "retrieval": {"topKPerQuery": 20, "neighborWindow": 0, "maxPrimaryItems": 20, "maxTotalItems": 60},
            "regexPageSize": 20
        },
        "overrides": {}
    }'::jsonb"""
        ),
        existing_type=JSONB,
    )

    conn = op.get_bind()
    session = Session(bind=conn)
    settings_table = sa.table(
        "user_settings",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("search_memory_settings", JSONB),
    )

    rows = session.execute(sa.select(settings_table)).fetchall()
    for row in rows:
        next_payload = _rewrite_search_settings(row.search_memory_settings)
        if next_payload is None or next_payload == row.search_memory_settings:
            continue
        stmt = (
            sa.update(settings_table)
            .where(settings_table.c.id == row.id)
            .values(search_memory_settings=sa.cast(sa.literal(next_payload), JSONB))
        )
        session.execute(stmt)

    session.commit()


def downgrade() -> None:
    pass
