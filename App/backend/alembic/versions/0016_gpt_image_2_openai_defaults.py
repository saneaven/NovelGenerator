"""Upgrade OpenAI image defaults to GPT Image 2."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Session


revision = "0016_gpt_image_2_openai_defaults"
down_revision = "0015_effort_value_type"
branch_labels = None
depends_on = None


OPENAI_DEFAULT_MODEL = "gpt-image-2"
OPENAI_DEFAULT_SETTINGS = {
    "quality": "medium",
    "background": "auto",
    "output_format": "png",
    "output_compression": 90,
    "moderation": "auto",
}
OPENAI_ALLOWED_QUALITIES = {"auto", "low", "medium", "high"}
OPENAI_ALLOWED_BACKGROUNDS = {"auto", "opaque"}
OPENAI_ALLOWED_FORMATS = {"png", "jpeg", "webp"}
OPENAI_ALLOWED_MODERATION = {"auto", "low"}
OPENAI_ALLOWED_ASPECT_RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
OPENAI_ALLOWED_IMAGE_SIZES = {"1K", "2K", "4K"}


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a or 1


def _normalize_ratio(raw: object, *, fallback: str = "1:1") -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback
    for sep in (":", "/", "x"):
        if sep not in text:
            continue
        left, right = text.split(sep, 1)
        try:
            width = int(float(left.strip()))
            height = int(float(right.strip()))
        except ValueError:
            return fallback
        if width <= 0 or height <= 0:
            return fallback
        divisor = _gcd(width, height)
        return f"{width // divisor}:{height // divisor}"
    return fallback


def _ratio_value(raw: str) -> float:
    normalized = _normalize_ratio(raw)
    left, right = normalized.split(":")
    return int(left) / int(right)


def _pick_ratio(candidates: set[str], requested: object, *, fallback: str) -> str:
    normalized_requested = _normalize_ratio(requested, fallback=fallback)
    if normalized_requested in candidates:
        return normalized_requested
    return min(candidates, key=lambda candidate: abs(_ratio_value(candidate) - _ratio_value(normalized_requested)))


def _normalize_openai_settings(raw: object) -> dict[str, object]:
    current = raw if isinstance(raw, dict) else {}
    compression = current.get("output_compression", OPENAI_DEFAULT_SETTINGS["output_compression"])
    try:
        compression_value = max(0, min(100, int(compression)))
    except (TypeError, ValueError):
        compression_value = int(OPENAI_DEFAULT_SETTINGS["output_compression"])

    quality = str(current.get("quality") or OPENAI_DEFAULT_SETTINGS["quality"]).strip()
    background = str(current.get("background") or OPENAI_DEFAULT_SETTINGS["background"]).strip()
    output_format = str(current.get("output_format") or OPENAI_DEFAULT_SETTINGS["output_format"]).strip()
    moderation = str(current.get("moderation") or OPENAI_DEFAULT_SETTINGS["moderation"]).strip()

    return {
        "quality": quality if quality in OPENAI_ALLOWED_QUALITIES else OPENAI_DEFAULT_SETTINGS["quality"],
        "background": background if background in OPENAI_ALLOWED_BACKGROUNDS else OPENAI_DEFAULT_SETTINGS["background"],
        "output_format": output_format if output_format in OPENAI_ALLOWED_FORMATS else OPENAI_DEFAULT_SETTINGS["output_format"],
        "output_compression": compression_value,
        "moderation": moderation if moderation in OPENAI_ALLOWED_MODERATION else OPENAI_DEFAULT_SETTINGS["moderation"],
    }


def _rewrite_image_gen_config(payload: object) -> dict | None:
    if not isinstance(payload, dict):
        return None

    next_payload = dict(payload)
    provider_settings = next_payload.get("providerSettings")
    next_provider_settings = dict(provider_settings) if isinstance(provider_settings, dict) else {}
    legacy_openai_settings = next_payload.get("openaiSettings")
    merged_openai_settings = {}
    if isinstance(next_provider_settings.get("openai"), dict):
        merged_openai_settings.update(next_provider_settings["openai"])
    if isinstance(legacy_openai_settings, dict):
        merged_openai_settings.update(legacy_openai_settings)
    next_provider_settings["openai"] = _normalize_openai_settings(merged_openai_settings)
    next_payload["providerSettings"] = next_provider_settings
    next_payload.pop("openaiSettings", None)

    provider = str(next_payload.get("provider") or "").strip()
    if provider == "openai":
        next_payload["model"] = OPENAI_DEFAULT_MODEL
        raw_aspect_ratio = next_payload.get("aspect_ratio")
        if not raw_aspect_ratio and isinstance(next_payload.get("size"), str):
            raw_aspect_ratio = next_payload.get("size")
        next_payload["aspect_ratio"] = _pick_ratio(
            OPENAI_ALLOWED_ASPECT_RATIOS,
            raw_aspect_ratio,
            fallback="1:1",
        )
        image_size = str(next_payload.get("image_size") or "").strip()
        next_payload["image_size"] = image_size if image_size in OPENAI_ALLOWED_IMAGE_SIZES else "1K"

    return next_payload


def upgrade() -> None:
    op.alter_column(
        "user_settings",
        "image_gen_config",
        server_default=sa.text(
            """'{
        "provider": "openai",
        "model": "gpt-image-2",
        "aspect_ratio": "1:1",
        "image_size": "1K",
        "naturalStyles": [],
        "tagBasedStyles": [],
        "selectedNaturalStyleId": null,
        "selectedTagBasedStyleId": null,
        "providerSettings": {
            "openai": {"quality": "medium", "background": "auto", "output_format": "png", "output_compression": 90, "moderation": "auto"},
            "novelai": {
                "sampler": "k_euler_ancestral",
                "steps": 28,
                "scale": 6.0,
                "noise_schedule": "karras",
                "referenceMode": "auto",
                "strength": 0.7,
                "i2iNoise": 0.0,
                "vibeStrength": 0.6,
                "vibeInfoExtracted": 1.0
            },
            "gemini": {},
            "xai": {},
            "openrouter": {},
            "nanogpt": {}
        }
    }'::jsonb"""
        ),
        existing_type=JSONB,
    )

    conn = op.get_bind()
    session = Session(bind=conn)
    settings_table = sa.table(
        "user_settings",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("image_gen_config", JSONB),
    )
    update_stmt = (
        sa.text(
            "UPDATE user_settings "
            "SET image_gen_config = :image_gen_config "
            "WHERE id = :id"
        )
        .bindparams(
            sa.bindparam("image_gen_config", type_=JSONB),
            sa.bindparam("id", type_=UUID(as_uuid=True)),
        )
    )

    rows = session.execute(sa.select(settings_table)).fetchall()
    for row in rows:
        next_payload = _rewrite_image_gen_config(row.image_gen_config)
        if next_payload is None or next_payload == row.image_gen_config:
            continue
        session.execute(update_stmt, {"id": row.id, "image_gen_config": next_payload})

    session.commit()


def downgrade() -> None:
    pass
