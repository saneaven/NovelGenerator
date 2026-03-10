"""Rewrite image generation geometry and add OpenRouter image support."""

from __future__ import annotations

import json
import math
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from services.image_model_catalog_service import (
    default_image_gen_config,
    migrate_image_gen_config,
    rewrite_image_run_recipe,
    sanitize_generation_settings,
)


revision = "0004_image_geometry_openrouter"
down_revision = "0003_vector_storage_enabled"
branch_labels = None
depends_on = None


OLD_IMAGE_GEN_DEFAULT = {
    "provider": "openai",
    "model": "gpt-image-1.5",
    "size": "1024x1024",
    "naturalStyles": [],
    "tagBasedStyles": [],
    "selectedNaturalStyleId": None,
    "selectedTagBasedStyleId": None,
    "openaiSettings": {
        "quality": "auto",
        "background": "auto",
        "output_format": "png",
        "output_compression": 90,
        "input_fidelity": "high",
    },
    "geminiSettings": {"aspect_ratio": "1:1", "image_resolution": "2K"},
    "novelaiSettings": {"sampler": "k_euler_ancestral", "steps": 28, "scale": 6.0, "noise_schedule": "karras"},
}

FIXED_PROVIDER_NATIVE_SIZE_BY_RATIO = {
    "openai": {
        "1:1": "1024x1024",
        "3:2": "1536x1024",
        "2:3": "1024x1536",
    },
    "xai": {
        "1:1": "1024x1024",
        "4:7": "1024x1792",
        "7:4": "1792x1024",
    },
    "novelai": {
        "1:1": "1024x1024",
        "13:19": "832x1216",
        "19:13": "1216x832",
        "2:3": "1024x1536",
        "3:2": "1536x1024",
        "5:12": "640x1536",
        "12:5": "1536x640",
    },
}


def _normalize_ratio(raw: Any, *, fallback: str = "1:1") -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback
    for separator in (":", "/", "x"):
        if separator not in text:
            continue
        left, right = text.split(separator, 1)
        try:
            width = int(float(left.strip()))
            height = int(float(right.strip()))
        except ValueError:
            return fallback
        if width <= 0 or height <= 0:
            return fallback
        divisor = math.gcd(width, height) or 1
        return f"{width // divisor}:{height // divisor}"
    return fallback


def _migrate_resolved_geometry(provider: str, resolved_ratio: Any, resolved_size: Any) -> tuple[str, str, str]:
    resolved_aspect_ratio = _normalize_ratio(resolved_ratio)
    resolved_size_text = str(resolved_size or "").strip()

    if provider in FIXED_PROVIDER_NATIVE_SIZE_BY_RATIO:
        native_map = FIXED_PROVIDER_NATIVE_SIZE_BY_RATIO[provider]
        resolved_native_size = resolved_size_text or native_map.get(resolved_aspect_ratio) or next(iter(native_map.values()))
        return resolved_aspect_ratio, "1K", resolved_native_size

    if not resolved_size_text:
        resolved_size_text = "1K"
    return resolved_aspect_ratio, resolved_size_text, resolved_size_text


def _jsonb_default(value: dict[str, Any]) -> sa.TextClause:
    encoded = json.dumps(value, separators=(",", ":")).replace(":", r"\:")
    return sa.text(f"'{encoded}'::jsonb")


USER_SETTINGS_TABLE = sa.table(
    "user_settings",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("image_gen_config", postgresql.JSONB),
)

IMAGE_RUNS_TABLE = sa.table(
    "image_runs",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("provider", sa.String()),
    sa.column("model", sa.String()),
    sa.column("resolved_ratio", sa.String()),
    sa.column("resolved_size", sa.String()),
    sa.column("request_snapshot", postgresql.JSONB),
    sa.column("resolved_aspect_ratio", sa.String()),
    sa.column("resolved_image_size", sa.String()),
    sa.column("resolved_native_size", sa.String()),
)

ASSETS_TABLE = sa.table(
    "assets",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("generation_settings", postgresql.JSONB),
)


def upgrade() -> None:
    op.add_column("image_runs", sa.Column("resolved_aspect_ratio", sa.String(length=32), nullable=True))
    op.add_column("image_runs", sa.Column("resolved_image_size", sa.String(length=32), nullable=True))
    op.add_column("image_runs", sa.Column("resolved_native_size", sa.String(length=32), nullable=True))

    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        user_rows = session.execute(sa.text("SELECT id, image_gen_config FROM user_settings")).mappings().all()
        for row in user_rows:
            session.execute(
                sa.update(USER_SETTINGS_TABLE)
                .where(USER_SETTINGS_TABLE.c.id == sa.bindparam("row_id"))
                .values(image_gen_config=sa.bindparam("config_json", type_=postgresql.JSONB)),
                {"row_id": row["id"], "config_json": migrate_image_gen_config(row["image_gen_config"])},
            )

        image_run_rows = session.execute(
            sa.text("SELECT id, provider, resolved_ratio, resolved_size, request_snapshot FROM image_runs")
        ).mappings().all()
        for row in image_run_rows:
            snapshot = row["request_snapshot"] if isinstance(row["request_snapshot"], dict) else {}
            recipe = rewrite_image_run_recipe(snapshot.get("recipe"))
            snapshot["recipe"] = recipe

            provider = str(recipe.get("provider") or row["provider"] or "").strip()
            next_ratio, next_image_size, next_native_size = _migrate_resolved_geometry(
                provider,
                row["resolved_ratio"],
                row["resolved_size"],
            )
            session.execute(
                sa.update(IMAGE_RUNS_TABLE)
                .where(IMAGE_RUNS_TABLE.c.id == sa.bindparam("row_id"))
                .values(
                    request_snapshot=sa.bindparam("snapshot_json", type_=postgresql.JSONB),
                    provider=sa.case(
                        (sa.bindparam("next_provider") != "", sa.bindparam("next_provider")),
                        else_=IMAGE_RUNS_TABLE.c.provider,
                    ),
                    model=sa.case(
                        (sa.bindparam("next_model") != "", sa.bindparam("next_model")),
                        else_=IMAGE_RUNS_TABLE.c.model,
                    ),
                    resolved_aspect_ratio=sa.bindparam("next_resolved_aspect_ratio"),
                    resolved_image_size=sa.bindparam("next_resolved_image_size"),
                    resolved_native_size=sa.bindparam("next_resolved_native_size"),
                ),
                {
                    "row_id": row["id"],
                    "snapshot_json": snapshot,
                    "next_provider": provider,
                    "next_model": str(recipe.get("model") or "").strip(),
                    "next_resolved_aspect_ratio": next_ratio,
                    "next_resolved_image_size": next_image_size,
                    "next_resolved_native_size": next_native_size,
                },
            )

        asset_rows = session.execute(
            sa.text("SELECT id, generation_provider, generation_settings FROM assets WHERE generation_settings IS NOT NULL")
        ).mappings().all()
        for row in asset_rows:
            session.execute(
                sa.update(ASSETS_TABLE)
                .where(ASSETS_TABLE.c.id == sa.bindparam("row_id"))
                .values(generation_settings=sa.bindparam("settings_json", type_=postgresql.JSONB)),
                {
                    "row_id": row["id"],
                    "settings_json": sanitize_generation_settings(
                        str(row["generation_provider"] or ""),
                        row["generation_settings"],
                    ),
                },
            )

        session.commit()
    finally:
        session.close()

    op.alter_column("user_settings", "image_gen_config", server_default=_jsonb_default(default_image_gen_config()))
    op.drop_column("image_runs", "resolved_ratio")
    op.drop_column("image_runs", "resolved_size")


def downgrade() -> None:
    op.add_column("image_runs", sa.Column("resolved_ratio", sa.String(length=32), nullable=True))
    op.add_column("image_runs", sa.Column("resolved_size", sa.String(length=32), nullable=True))

    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        image_run_rows = session.execute(
            sa.text(
                "SELECT id, provider, resolved_aspect_ratio, resolved_image_size, resolved_native_size FROM image_runs"
            )
        ).mappings().all()
        for row in image_run_rows:
            provider = str(row["provider"] or "").strip()
            resolved_size = row["resolved_image_size"]
            if provider in FIXED_PROVIDER_NATIVE_SIZE_BY_RATIO:
                resolved_size = row["resolved_native_size"]
            session.execute(
                sa.update(IMAGE_RUNS_TABLE)
                .where(IMAGE_RUNS_TABLE.c.id == sa.bindparam("row_id"))
                .values(
                    resolved_ratio=sa.bindparam("next_resolved_ratio"),
                    resolved_size=sa.bindparam("next_resolved_size"),
                ),
                {
                    "row_id": row["id"],
                    "next_resolved_ratio": row["resolved_aspect_ratio"],
                    "next_resolved_size": resolved_size,
                },
            )

        user_rows = session.execute(sa.text("SELECT id, image_gen_config FROM user_settings")).mappings().all()
        for row in user_rows:
            raw = row["image_gen_config"] if isinstance(row["image_gen_config"], dict) else {}
            next_config = {
                **OLD_IMAGE_GEN_DEFAULT,
                "provider": raw.get("provider") or OLD_IMAGE_GEN_DEFAULT["provider"],
                "model": raw.get("model") or OLD_IMAGE_GEN_DEFAULT["model"],
                "size": "1024x1024",
                "naturalStyles": raw.get("naturalStyles") if isinstance(raw.get("naturalStyles"), list) else [],
                "tagBasedStyles": raw.get("tagBasedStyles") if isinstance(raw.get("tagBasedStyles"), list) else [],
                "selectedNaturalStyleId": raw.get("selectedNaturalStyleId"),
                "selectedTagBasedStyleId": raw.get("selectedTagBasedStyleId"),
                "openaiSettings": {
                    **OLD_IMAGE_GEN_DEFAULT["openaiSettings"],
                    **(raw.get("openaiSettings") if isinstance(raw.get("openaiSettings"), dict) else {}),
                },
                "novelaiSettings": {
                    **OLD_IMAGE_GEN_DEFAULT["novelaiSettings"],
                    **(raw.get("novelaiSettings") if isinstance(raw.get("novelaiSettings"), dict) else {}),
                },
                "geminiSettings": {
                    "aspect_ratio": raw.get("aspect_ratio") or "1:1",
                    "image_resolution": raw.get("image_size") or "2K",
                },
            }
            session.execute(
                sa.update(USER_SETTINGS_TABLE)
                .where(USER_SETTINGS_TABLE.c.id == sa.bindparam("row_id"))
                .values(image_gen_config=sa.bindparam("config_json", type_=postgresql.JSONB)),
                {"row_id": row["id"], "config_json": next_config},
            )

        session.commit()
    finally:
        session.close()

    op.alter_column("user_settings", "image_gen_config", server_default=_jsonb_default(OLD_IMAGE_GEN_DEFAULT))
    op.drop_column("image_runs", "resolved_aspect_ratio")
    op.drop_column("image_runs", "resolved_image_size")
    op.drop_column("image_runs", "resolved_native_size")
