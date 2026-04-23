from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from ..semantic_chunker import merge_blocks_by_length, split_plaintext_blocks
from ..semantic_embedding_service import embed_many
from .errors import EmbeddingUnavailable


_WS_RE = re.compile(r"[ \t]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class ExistingSourceState:
    content_hash: str | None
    index_state: str


@dataclass(frozen=True)
class EmbeddedChunk:
    chunk_index: int
    field_path: str
    text: str
    embedding: list[float]


@dataclass(frozen=True)
class StagedVectorSource:
    message_id: UUID
    content_hash: str
    chunks: list[EmbeddedChunk]


@dataclass(frozen=True)
class VectorBatch:
    profile_dimensions: int | None
    upserts: list[StagedVectorSource]
    skipped_message_ids: list[UUID]


def _normalize_for_hash(text: str) -> str:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    normalized = "\n".join(line.rstrip() for line in normalized.split("\n"))
    normalized = _WS_RE.sub(" ", normalized)
    normalized = _MULTI_NL_RE.sub("\n\n", normalized)
    return normalized.strip()


def _compute_chunks_hash(chunks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for chunk in chunks:
        field_path = chunk.get("field_path")
        chunk_index = chunk.get("chunk_index")
        text = chunk.get("text")
        if not isinstance(field_path, str) or not isinstance(chunk_index, int) or not isinstance(text, str):
            continue
        normalized = _normalize_for_hash(text)
        if not normalized:
            continue
        parts.append(f"[{field_path}:{chunk_index}]\n{normalized}\n")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _extract_string_leaves(value: Any, *, path: str = "") -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []

    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            out.append((path, stripped))
        return out

    if isinstance(value, list):
        for idx, item in enumerate(value):
            child_path = f"{path}/{idx}" if path else str(idx)
            out.extend(_extract_string_leaves(item, path=child_path))
        return out

    if isinstance(value, dict):
        for key, item in value.items():
            child_path = f"{path}/{str(key)}" if path else str(key)
            out.extend(_extract_string_leaves(item, path=child_path))
        return out

    return out


def _build_memory_chunks(*, message_req: dict[str, Any]) -> list[dict[str, Any]]:
    min_chars = 200
    target_chars = 600
    max_chars = 1200

    chunks: list[dict[str, Any]] = []

    content = str(message_req.get("content") or "").strip()
    if content:
        blocks = split_plaintext_blocks(content) or [content]
        merged = merge_blocks_by_length(
            blocks,
            min_chars=min_chars,
            target_chars=target_chars,
            max_chars=max_chars,
        )
        for text in merged:
            stripped = (text or "").strip()
            if stripped:
                chunks.append({"field_path": "content", "text": stripped})

    tool_calls = message_req.get("tool_calls")
    if isinstance(tool_calls, list):
        for idx, tool_call in enumerate(tool_calls):
            if not isinstance(tool_call, dict):
                continue
            tc_id = str(tool_call.get("id") or f"index/{idx}").strip() or f"index/{idx}"

            allowed_paths = {
                "arguments": f"tool_calls/{tc_id}/arguments",
                "result": f"tool_calls/{tc_id}/result",
                "reason": f"tool_calls/{tc_id}/reason",
            }
            blocks_by_field: dict[str, list[str]] = {path: [] for path in allowed_paths.values()}
            tool_name = str(tool_call.get("name") or "").strip()
            if tool_name:
                blocks_by_field[allowed_paths["arguments"]].append(f"tool_name: {tool_name}")

            leaves = _extract_string_leaves(tool_call)
            for leaf_path, leaf_value in leaves:
                root = leaf_path.split("/", 1)[0]
                target_field = allowed_paths.get(root)
                if target_field and leaf_value:
                    blocks_by_field[target_field].append(leaf_value)

            for field_path, blocks in blocks_by_field.items():
                if not blocks:
                    continue
                merged = merge_blocks_by_length(
                    blocks,
                    min_chars=min_chars,
                    target_chars=target_chars,
                    max_chars=max_chars,
                )
                for text in merged:
                    stripped = (text or "").strip()
                    if stripped:
                        chunks.append({"field_path": field_path, "text": stripped})

    for chunk_index, chunk in enumerate(chunks):
        chunk["chunk_index"] = chunk_index

    return chunks


async def chunk_and_embed(
    *,
    slice_payload: dict[str, Any],
    language: str,
    embedding_profile: dict[str, Any] | None,
    provider_config: dict[str, Any],
    existing_sources: dict[UUID, ExistingSourceState] | None = None,
) -> VectorBatch:
    profile = embedding_profile or {}
    provider = str(profile.get("provider") or "").strip()
    model = str(profile.get("model") or "").strip()
    if not provider or not model:
        raise EmbeddingUnavailable("Missing agent-memory embedding profile")

    existing_by_message = existing_sources or {}
    pending_chunks: list[tuple[UUID, dict[str, Any]]] = []
    hashes_by_message_id: dict[UUID, str] = {}
    skipped_message_ids: list[UUID] = []

    for item in slice_payload.get("messages") or []:
        if not isinstance(item, dict):
            continue
        message_id = item.get("message_id")
        if not isinstance(message_id, UUID):
            continue

        chunks = _build_memory_chunks(message_req=item)
        if not chunks:
            continue

        content_hash = _compute_chunks_hash(chunks)
        existing = existing_by_message.get(message_id)
        if existing and existing.content_hash == content_hash and existing.index_state == "ready":
            skipped_message_ids.append(message_id)
            continue

        hashes_by_message_id[message_id] = content_hash
        for chunk in chunks:
            pending_chunks.append((message_id, chunk))

    vectors: list[list[float]] = []
    if pending_chunks:
        vectors = await embed_many(
            provider=provider,
            model=model,
            inputs=[chunk["text"] for _, chunk in pending_chunks],
            config=provider_config,
            dimensions=profile.get("dimensions"),
            purpose="document",
        )
        if len(vectors) != len(pending_chunks):
            raise RuntimeError(
                f"Embedding provider returned unexpected vector count (expected={len(pending_chunks)}, got={len(vectors)})"
            )

    chunks_by_message_id: dict[UUID, list[EmbeddedChunk]] = {}
    for (message_id, chunk), vector in zip(pending_chunks, vectors):
        chunks_by_message_id.setdefault(message_id, []).append(
            EmbeddedChunk(
                chunk_index=int(chunk["chunk_index"]),
                field_path=str(chunk["field_path"]),
                text=str(chunk["text"]),
                embedding=list(vector),
            )
        )

    upserts = [
        StagedVectorSource(
            message_id=message_id,
            content_hash=hashes_by_message_id[message_id],
            chunks=sorted(chunks, key=lambda item: item.chunk_index),
        )
        for message_id, chunks in chunks_by_message_id.items()
    ]

    return VectorBatch(
        profile_dimensions=int(profile["dimensions"]) if isinstance(profile.get("dimensions"), int) else None,
        upserts=upserts,
        skipped_message_ids=skipped_message_ids,
    )


__all__ = [
    "EmbeddedChunk",
    "ExistingSourceState",
    "StagedVectorSource",
    "VectorBatch",
    "_build_memory_chunks",
    "chunk_and_embed",
]
