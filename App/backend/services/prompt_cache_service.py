from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..models.db_models import ThreadPromptCache
from .storage_usage_service import (
    apply_project_usage_delta,
    build_thread_prompt_cache_delta,
    snapshot_thread_prompt_cache_row,
)


GEMINI_TTL_PRESET_TO_SECONDS = {
    "5m": "300s",
    "30m": "1800s",
    "1h": "3600s",
    "6h": "21600s",
    "24h": "86400s",
}


@dataclass(frozen=True)
class CacheCheckpoint:
    checkpoint_id: str
    block_id: str
    block_order: int
    rendered_message_count: int
    provider_message_count: int
    last_seq_in_thread: int | None
    last_role: str | None
    prefix_label: str
    prefix_digest_raw: str
    duplicate_prefix: bool = False


@dataclass(frozen=True)
class PreparedCachePlan:
    provider: str
    provider_strategy: str
    enabled: bool
    cache_settings: dict[str, Any]
    checkpoints: list[CacheCheckpoint]
    thread_cache_key: str | None = None
    selected_checkpoint_id: str | None = None
    selected_prefix_digest: str | None = None
    selected_provider_message_count: int | None = None
    selected_cache_row_id: str | None = None
    selected_cache_handle: str | None = None
    applied_checkpoint_ids: list[str] | None = None
    dropped_checkpoint_ids: list[str] | None = None
    ttl_label: str | None = None

    def as_metrics(self) -> dict[str, Any]:
        return {
            "provider_strategy": self.provider_strategy,
            "selected_checkpoint_id": self.selected_checkpoint_id,
            "applied_checkpoint_ids": list(self.applied_checkpoint_ids or []),
            "dropped_checkpoint_ids": list(self.dropped_checkpoint_ids or []),
            "ttl_label": self.ttl_label,
        }


def annotate_conversation_render_indices(conversation: list[dict[str, Any]]) -> list[dict[str, Any]]:
    annotated: list[dict[str, Any]] = []
    for index, message in enumerate(conversation):
        item = dict(message)
        item["_render_index"] = index
        annotated.append(item)
    return annotated


def normalize_cache_boundaries(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        checkpoint_id = str(item.get("checkpoint_id") or item.get("block_id") or "").strip()
        block_id = str(item.get("block_id") or checkpoint_id).strip()
        prefix_digest_raw = str(item.get("prefix_digest_raw") or "").strip()
        if not checkpoint_id or not block_id or not prefix_digest_raw:
            continue
        normalized.append(
            {
                "checkpoint_id": checkpoint_id,
                "block_id": block_id,
                "block_order": int(item.get("block_order") or 0),
                "rendered_message_count": max(int(item.get("rendered_message_count") or 0), 0),
                "last_seq_in_thread": (
                    int(item["last_seq_in_thread"])
                    if isinstance(item.get("last_seq_in_thread"), int)
                    else None
                ),
                "last_role": str(item.get("last_role")) if isinstance(item.get("last_role"), str) else None,
                "prefix_label": str(item.get("prefix_label") or ""),
                "prefix_digest_raw": prefix_digest_raw,
                "duplicate_prefix": bool(item.get("duplicate_prefix")),
            }
        )
    normalized.sort(key=lambda entry: int(entry.get("block_order") or 0))
    return normalized


def remap_cache_boundaries_for_provider(
    cache_boundaries: Any,
    provider_messages_with_internal_keys: list[dict[str, Any]],
) -> list[CacheCheckpoint]:
    normalized = normalize_cache_boundaries(cache_boundaries)
    if not normalized:
        return []

    provider_conversation = provider_messages_with_internal_keys[1:] if provider_messages_with_internal_keys else []
    checkpoints: list[CacheCheckpoint] = []
    for item in normalized:
        rendered_message_count = int(item["rendered_message_count"])
        provider_message_count = sum(
            1
            for message in provider_conversation
            if isinstance(message.get("_render_index"), int) and int(message["_render_index"]) < rendered_message_count
        )
        checkpoints.append(
            CacheCheckpoint(
                checkpoint_id=str(item["checkpoint_id"]),
                block_id=str(item["block_id"]),
                block_order=int(item["block_order"]),
                rendered_message_count=rendered_message_count,
                provider_message_count=provider_message_count,
                last_seq_in_thread=item.get("last_seq_in_thread"),
                last_role=item.get("last_role"),
                prefix_label=str(item.get("prefix_label") or ""),
                prefix_digest_raw=str(item["prefix_digest_raw"]),
                duplicate_prefix=bool(item.get("duplicate_prefix")),
            )
        )
    return checkpoints


def _choose_longest_checkpoint(checkpoints: list[CacheCheckpoint]) -> CacheCheckpoint | None:
    if not checkpoints:
        return None
    return max(
        checkpoints,
        key=lambda checkpoint: (checkpoint.provider_message_count, checkpoint.rendered_message_count, checkpoint.block_order),
    )


def gemini_ttl_seconds(ttl_preset: str | None) -> str:
    return GEMINI_TTL_PRESET_TO_SECONDS.get(str(ttl_preset or "").strip(), GEMINI_TTL_PRESET_TO_SECONDS["1h"])


def ttl_to_expiry(ttl_label: str | None) -> datetime | None:
    label = str(ttl_label or "").strip()
    if not label:
        return None
    now = datetime.utcnow()
    if label.endswith("m"):
        try:
            return now + timedelta(minutes=int(label[:-1]))
        except ValueError:
            return None
    if label.endswith("h"):
        try:
            return now + timedelta(hours=int(label[:-1]))
        except ValueError:
            return None
    if label.endswith("s"):
        try:
            return now + timedelta(seconds=int(label[:-1]))
        except ValueError:
            return None
    return None


def list_active_prompt_cache_rows(
    db: Session,
    *,
    thread_id: Any,
    provider: str,
    model: str,
    strategy: str | None = None,
) -> list[ThreadPromptCache]:
    query = db.query(ThreadPromptCache).filter(
        ThreadPromptCache.thread_id == thread_id,
        ThreadPromptCache.provider == provider,
        ThreadPromptCache.model == model,
    )
    if strategy:
        query = query.filter(ThreadPromptCache.strategy == strategy)
    rows = query.order_by(ThreadPromptCache.updated_at.desc()).all()
    now = datetime.utcnow()
    active_rows: list[ThreadPromptCache] = []
    for row in rows:
        expires_at = getattr(row, "expires_at", None)
        if expires_at is not None and expires_at <= now:
            row.status = "expired"
            continue
        if str(getattr(row, "status", "active") or "active") != "active":
            continue
        active_rows.append(row)
    return active_rows


def find_matching_prompt_cache_row(
    db: Session,
    *,
    thread_id: Any,
    provider: str,
    model: str,
    strategy: str,
    checkpoints: list[CacheCheckpoint],
) -> tuple[ThreadPromptCache | None, CacheCheckpoint | None]:
    if not checkpoints:
        return None, None
    rows = list_active_prompt_cache_rows(
        db,
        thread_id=thread_id,
        provider=provider,
        model=model,
        strategy=strategy,
    )
    by_digest = {str(row.prefix_digest): row for row in rows}
    ordered = sorted(
        checkpoints,
        key=lambda checkpoint: (
            checkpoint.provider_message_count,
            checkpoint.rendered_message_count,
            checkpoint.block_order,
        ),
        reverse=True,
    )
    for checkpoint in ordered:
        row = by_digest.get(checkpoint.prefix_digest_raw)
        if row is not None:
            return row, checkpoint
    return None, None


def upsert_thread_prompt_cache(
    db: Session,
    *,
    thread_id: Any,
    user_id: Any,
    project_id: Any,
    provider: str,
    model: str,
    checkpoint_id: str,
    prefix_digest: str,
    strategy: str,
    external_handle: str | None,
    ttl_label: str | None,
    status: str = "active",
    meta: dict[str, Any] | None = None,
) -> ThreadPromptCache:
    row = (
        db.query(ThreadPromptCache)
        .filter(
            ThreadPromptCache.thread_id == thread_id,
            ThreadPromptCache.provider == provider,
            ThreadPromptCache.model == model,
            ThreadPromptCache.prefix_digest == prefix_digest,
        )
        .first()
    )
    before = snapshot_thread_prompt_cache_row(row)
    expires_at = ttl_to_expiry(ttl_label)
    if row is None:
        row = ThreadPromptCache(
            thread_id=thread_id,
            user_id=user_id,
            project_id=project_id,
            provider=provider,
            model=model,
            checkpoint_id=checkpoint_id,
            prefix_digest=prefix_digest,
            strategy=strategy,
            external_handle=external_handle,
            ttl_label=ttl_label,
            expires_at=expires_at,
            last_hit_at=datetime.utcnow(),
            status=status,
            meta=meta,
        )
        db.add(row)
    else:
        row.checkpoint_id = checkpoint_id
        row.strategy = strategy
        row.external_handle = external_handle
        row.ttl_label = ttl_label
        row.expires_at = expires_at
        row.last_hit_at = datetime.utcnow()
        row.status = status
        row.meta = meta
    db.flush()
    after = snapshot_thread_prompt_cache_row(row)
    apply_project_usage_delta(
        db,
        user_id=user_id,
        project_id=project_id,
        delta=build_thread_prompt_cache_delta(before, after),
        enforce_quota=False,
    )
    return row


def touch_thread_prompt_cache(row: ThreadPromptCache | None) -> None:
    if row is None:
        return
    row.last_hit_at = datetime.utcnow()


def build_prepared_cache_plan(
    *,
    db: Session,
    thread_id: Any,
    provider: str,
    model: str,
    cache_settings: dict[str, Any],
    cache_boundaries: Any,
    provider_messages_with_internal_keys: list[dict[str, Any]],
) -> PreparedCachePlan:
    enabled = bool(cache_settings.get("enabled", False))
    checkpoints = remap_cache_boundaries_for_provider(cache_boundaries, provider_messages_with_internal_keys)

    if not enabled:
        return PreparedCachePlan(
            provider=provider,
            provider_strategy="disabled",
            enabled=False,
            cache_settings=dict(cache_settings),
            checkpoints=checkpoints,
            thread_cache_key=str(thread_id),
            applied_checkpoint_ids=[],
            dropped_checkpoint_ids=[],
        )

    if provider == "openai":
        return PreparedCachePlan(
            provider=provider,
            provider_strategy="automatic_hints",
            enabled=True,
            cache_settings=dict(cache_settings),
            checkpoints=checkpoints,
            thread_cache_key=str(thread_id),
            applied_checkpoint_ids=[],
            dropped_checkpoint_ids=[],
            ttl_label=str(cache_settings.get("retention") or "default"),
        )

    if provider == "xai":
        return PreparedCachePlan(
            provider=provider,
            provider_strategy="automatic_hints",
            enabled=True,
            cache_settings=dict(cache_settings),
            checkpoints=checkpoints,
            thread_cache_key=str(thread_id),
            applied_checkpoint_ids=[],
            dropped_checkpoint_ids=[],
        )

    if provider == "claude":
        if not checkpoints:
            return PreparedCachePlan(
                provider=provider,
                provider_strategy="claude_automatic",
                enabled=True,
                cache_settings=dict(cache_settings),
                checkpoints=[],
                thread_cache_key=str(thread_id),
                applied_checkpoint_ids=[],
                dropped_checkpoint_ids=[],
                ttl_label=str(cache_settings.get("ttl") or "5m"),
            )
        applied = checkpoints[:4]
        dropped = checkpoints[4:]
        return PreparedCachePlan(
            provider=provider,
            provider_strategy="claude_explicit",
            enabled=True,
            cache_settings=dict(cache_settings),
            checkpoints=checkpoints,
            thread_cache_key=str(thread_id),
            applied_checkpoint_ids=[checkpoint.checkpoint_id for checkpoint in applied],
            dropped_checkpoint_ids=[checkpoint.checkpoint_id for checkpoint in dropped],
            ttl_label=str(cache_settings.get("ttl") or "5m"),
        )

    if provider == "gemini":
        implicit_enabled = bool(cache_settings.get("implicit", True))
        explicit_enabled = bool(cache_settings.get("explicit", True))
        if not explicit_enabled or not checkpoints:
            return PreparedCachePlan(
                provider=provider,
                provider_strategy="gemini_implicit" if implicit_enabled else "gemini_passthrough",
                enabled=True,
                cache_settings=dict(cache_settings),
                checkpoints=checkpoints,
                thread_cache_key=str(thread_id),
                applied_checkpoint_ids=[],
                dropped_checkpoint_ids=[],
                ttl_label=str(cache_settings.get("explicit_ttl_preset") or "1h"),
            )
        matched_row, matched_checkpoint = find_matching_prompt_cache_row(
            db,
            thread_id=thread_id,
            provider=provider,
            model=model,
            strategy="gemini_cached_content",
            checkpoints=checkpoints,
        )
        selected = matched_checkpoint or _choose_longest_checkpoint(checkpoints)
        return PreparedCachePlan(
            provider=provider,
            provider_strategy="gemini_explicit",
            enabled=True,
            cache_settings=dict(cache_settings),
            checkpoints=checkpoints,
            thread_cache_key=str(thread_id),
            selected_checkpoint_id=selected.checkpoint_id if selected else None,
            selected_prefix_digest=selected.prefix_digest_raw if selected else None,
            selected_provider_message_count=selected.provider_message_count if selected else None,
            selected_cache_row_id=str(matched_row.id) if matched_row is not None else None,
            selected_cache_handle=str(matched_row.external_handle) if matched_row and matched_row.external_handle else None,
            applied_checkpoint_ids=[selected.checkpoint_id] if selected else [],
            dropped_checkpoint_ids=[
                checkpoint.checkpoint_id for checkpoint in checkpoints if selected is not None and checkpoint.checkpoint_id != selected.checkpoint_id
            ],
            ttl_label=str(cache_settings.get("explicit_ttl_preset") or "1h"),
        )

    if provider == "nanogpt":
        if not checkpoints:
            return PreparedCachePlan(
                provider=provider,
                provider_strategy="nanogpt_automatic",
                enabled=True,
                cache_settings=dict(cache_settings),
                checkpoints=[],
                thread_cache_key=str(thread_id),
                applied_checkpoint_ids=[],
                dropped_checkpoint_ids=[],
                ttl_label=str(cache_settings.get("ttl") or "5m"),
            )
        matched_row, matched_checkpoint = find_matching_prompt_cache_row(
            db,
            thread_id=thread_id,
            provider=provider,
            model=model,
            strategy="logical_prefix",
            checkpoints=checkpoints,
        )
        selected = matched_checkpoint or _choose_longest_checkpoint(checkpoints)
        return PreparedCachePlan(
            provider=provider,
            provider_strategy="nanogpt_single_checkpoint",
            enabled=True,
            cache_settings=dict(cache_settings),
            checkpoints=checkpoints,
            thread_cache_key=str(thread_id),
            selected_checkpoint_id=selected.checkpoint_id if selected else None,
            selected_prefix_digest=selected.prefix_digest_raw if selected else None,
            selected_provider_message_count=selected.provider_message_count if selected else None,
            selected_cache_row_id=str(matched_row.id) if matched_row is not None else None,
            applied_checkpoint_ids=[selected.checkpoint_id] if selected else [],
            dropped_checkpoint_ids=[
                checkpoint.checkpoint_id for checkpoint in checkpoints if selected is not None and checkpoint.checkpoint_id != selected.checkpoint_id
            ],
            ttl_label=str(cache_settings.get("ttl") or "5m"),
        )

    return PreparedCachePlan(
        provider=provider,
        provider_strategy="unsupported",
        enabled=False,
        cache_settings=dict(cache_settings),
        checkpoints=checkpoints,
        thread_cache_key=str(thread_id),
        applied_checkpoint_ids=[],
        dropped_checkpoint_ids=[],
    )
