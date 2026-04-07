from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import desc, text as sql_text
from sqlalchemy.orm import Session

from ..models.db_models import RunMessageModel
from ..models.memory_models import MessageMemorySummary, MessageSemanticChunk, MessageSemanticSource
from .credential_service import credential_service
from .embedding_config_service import get_embedding_profile, set_embedding_dimensions
from .semantic_chunker import merge_blocks_by_length, split_plaintext_blocks
from .semantic_embedding_service import embed_many


def wipe_memory_index(db: Session, *, user_id: UUID) -> None:
    """Delete all message-memory embeddings for a user (sources + chunks via cascade)."""
    db.query(MessageSemanticSource).filter(MessageSemanticSource.user_id == user_id).delete(synchronize_session=False)


def _extract_message_text(data: Dict[str, Any], language: str) -> str:
    if not isinstance(data, dict):
        return ""

    lang_blob = data.get(language)
    if not isinstance(lang_blob, dict) or "contentParts" not in lang_blob:
        for value in data.values():
            if isinstance(value, dict) and "contentParts" in value:
                lang_blob = value
                break

    if not isinstance(lang_blob, dict):
        return ""

    parts = lang_blob.get("contentParts")
    if not isinstance(parts, list):
        return ""

    out: List[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "content":
            out.append(str(part.get("text") or ""))
    return "".join(out)


_WS_RE = re.compile(r"[ \t]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")


def _normalize_for_hash(text: str) -> str:
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    normalized = "\n".join([line.rstrip() for line in normalized.split("\n")])
    normalized = _WS_RE.sub(" ", normalized)
    normalized = _MULTI_NL_RE.sub("\n\n", normalized)
    return normalized.strip()


def _compute_chunks_hash(chunks: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
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


def _extract_string_leaves(value: Any, *, path: str = "") -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []

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


def _build_memory_chunks(*, message_req: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build embedding chunks for one archived message payload."""
    min_chars = 200
    target_chars = 600
    max_chars = 1200

    chunks: List[Dict[str, Any]] = []

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
            blocks_by_field: Dict[str, List[str]] = {path: [] for path in allowed_paths.values()}
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


def _select_message_range(
    *,
    ordered_ids: List[UUID],
    current_boundary: Optional[UUID],
    archive_until: UUID,
) -> Tuple[int, int]:
    try:
        end_idx = ordered_ids.index(archive_until)
    except ValueError as exc:
        raise ValueError("archive_until_message_id not found in thread message history") from exc

    start_idx = 0
    if current_boundary:
        try:
            start_idx = ordered_ids.index(current_boundary) + 1
        except ValueError:
            start_idx = 0
    return start_idx, end_idx


def _latest_summary(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str | None = None,
) -> MessageMemorySummary | None:
    base_q = db.query(MessageMemorySummary).filter(
        MessageMemorySummary.user_id == user_id,
        MessageMemorySummary.project_id == project_id,
        MessageMemorySummary.thread_id == thread_id,
    )
    if language:
        preferred = (
            base_q.filter(MessageMemorySummary.language == language)
            .order_by(
                desc(MessageMemorySummary.to_seq_in_thread),
                desc(MessageMemorySummary.created_at),
            )
            .first()
        )
        if preferred is not None:
            return preferred
    return (
        base_q.order_by(
            desc(MessageMemorySummary.to_seq_in_thread),
            desc(MessageMemorySummary.created_at),
        )
        .first()
    )


def get_thread_memory_status(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
) -> Dict[str, Any]:
    summary_count = (
        db.query(MessageMemorySummary)
        .filter(
            MessageMemorySummary.user_id == user_id,
            MessageMemorySummary.project_id == project_id,
            MessageMemorySummary.thread_id == thread_id,
            MessageMemorySummary.language == language,
        )
        .count()
    )
    if summary_count == 0:
        summary_count = (
            db.query(MessageMemorySummary)
            .filter(
                MessageMemorySummary.user_id == user_id,
                MessageMemorySummary.project_id == project_id,
                MessageMemorySummary.thread_id == thread_id,
            )
            .count()
        )

    last = _latest_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
        language=language,
    )
    indexed = (
        db.query(MessageSemanticSource)
        .filter(
            MessageSemanticSource.user_id == user_id,
            MessageSemanticSource.project_id == project_id,
            MessageSemanticSource.thread_id == thread_id,
        )
        .count()
    )

    return {
        "hasMemory": summary_count > 0,
        "summaryCount": int(summary_count),
        "lastSummaryText": getattr(last, "summary_text", None) if last else None,
        "archivedUntilMessageId": getattr(last, "to_message_id", None) if last else None,
        "archivedUntilSeqInThread": int(last.to_seq_in_thread) if last and last.to_seq_in_thread is not None else None,
        "indexedMessageCount": int(indexed),
    }


async def archive_thread_until(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    archive_until_message_id: UUID,
    summary_text: str,
    archived_messages: List[Dict[str, Any]],
) -> Dict[str, Any]:
    latest_summary = _latest_summary(
        db,
        user_id=user_id,
        project_id=project_id,
        thread_id=thread_id,
    )
    current_boundary = getattr(latest_summary, "to_message_id", None) if latest_summary else None

    if current_boundary == archive_until_message_id:
        return {
            "archived_until_message_id": current_boundary,
            "summary_id": None,
            "summary_text": None,
            "archived_message_ids": [],
            "archived_until_seq_in_thread": (
                int(latest_summary.to_seq_in_thread)
                if latest_summary and latest_summary.to_seq_in_thread is not None
                else None
            ),
            "indexed_count": 0,
        }

    # Load only IDs first for range selection (avoids loading all messages into memory)
    ordered_id_rows = (
        db.query(RunMessageModel.id)
        .filter(RunMessageModel.thread_id == thread_id)
        .order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc())
        .all()
    )
    ordered_ids = [row[0] for row in ordered_id_rows]

    start_idx, end_idx = _select_message_range(
        ordered_ids=ordered_ids,
        current_boundary=current_boundary,
        archive_until=archive_until_message_id,
    )
    if end_idx < start_idx:
        return {
            "archived_until_message_id": current_boundary,
            "summary_id": None,
            "summary_text": None,
            "archived_message_ids": [],
            "archived_until_seq_in_thread": (
                int(latest_summary.to_seq_in_thread)
                if latest_summary and latest_summary.to_seq_in_thread is not None
                else None
            ),
            "indexed_count": 0,
        }

    # Load only the messages in the selected range
    range_ids = ordered_ids[start_idx : end_idx + 1]
    msgs: List[RunMessageModel] = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id.in_(range_ids))
        .order_by(RunMessageModel.seq_in_thread.asc(), RunMessageModel.created_at.asc())
        .all()
    )
    archived_ids = [msg.id for msg in msgs]
    boundary_message = msgs[-1] if msgs else None

    if not summary_text or not summary_text.strip():
        raise ValueError("summary_text is required")
    if not archived_messages:
        raise ValueError("archived_messages is required")
    if boundary_message is None:
        raise ValueError("No messages selected for archive")

    archived_by_id: Dict[UUID, Dict[str, Any]] = {}
    for item in archived_messages:
        mid = item.get("message_id")
        if isinstance(mid, UUID):
            archived_by_id[mid] = item
        elif isinstance(mid, str):
            try:
                archived_by_id[UUID(mid)] = item
            except ValueError:
                continue

    if archive_until_message_id not in archived_by_id:
        raise ValueError("archived_messages must include archive_until_message_id")

    profile = get_embedding_profile(db, user_id=user_id, feature="memory")
    if not profile:
        raise ValueError("Missing agent-memory embedding profile")

    provider_config: Dict[str, Any] = credential_service.get_provider_config(
        db,
        user_id,
        str(profile["provider"]),
    )

    indexed_count = 0
    try:
        chunks_to_embed: List[Dict[str, Any]] = []
        hash_by_mid: Dict[UUID, str] = {}

        for message in msgs:
            req = archived_by_id.get(message.id)
            if req is None:
                raise ValueError(f"archived_messages missing message_id={message.id}")

            chunks = _build_memory_chunks(message_req=req)
            if not chunks:
                continue

            content_hash = _compute_chunks_hash(chunks)
            existing = (
                db.query(MessageSemanticSource)
                .filter(
                    MessageSemanticSource.user_id == user_id,
                    MessageSemanticSource.project_id == project_id,
                    MessageSemanticSource.thread_id == thread_id,
                    MessageSemanticSource.message_id == message.id,
                    MessageSemanticSource.language == language,
                )
                .first()
            )
            if existing and existing.content_hash == content_hash and existing.index_state == "ready":
                continue

            hash_by_mid[message.id] = content_hash
            for chunk in chunks:
                chunks_to_embed.append(
                    {
                        "message_id": message.id,
                        "field_path": chunk["field_path"],
                        "chunk_index": int(chunk["chunk_index"]),
                        "text": chunk["text"],
                    }
                )

        vectors: List[List[float]] = []
        if chunks_to_embed:
            vectors = await embed_many(
                provider=profile["provider"],
                model=profile["model"],
                inputs=[chunk["text"] for chunk in chunks_to_embed],
                config=provider_config,
                dimensions=profile.get("dimensions"),
                purpose="document",
            )
            if len(vectors) != len(chunks_to_embed):
                raise RuntimeError(
                    f"Embedding provider returned unexpected vector count (expected={len(chunks_to_embed)}, got={len(vectors)})"
                )

        now = datetime.utcnow()
        if vectors:
            embedding_dim = len(vectors[0])
            stored_dim = profile.get("dimensions")
            if stored_dim is None:
                set_embedding_dimensions(db, user_id=user_id, feature="memory", dimensions=embedding_dim)
            elif stored_dim != embedding_dim:
                raise RuntimeError(f"Embedding dimensions mismatch (profile={stored_dim}, got={embedding_dim})")

        by_mid: Dict[UUID, List[Tuple[Dict[str, Any], List[float]]]] = {}
        for chunk, vec in zip(chunks_to_embed, vectors):
            mid = chunk["message_id"]
            by_mid.setdefault(mid, []).append((chunk, vec))

        for mid, chunk_pairs in by_mid.items():
            source = (
                db.query(MessageSemanticSource)
                .filter(
                    MessageSemanticSource.user_id == user_id,
                    MessageSemanticSource.project_id == project_id,
                    MessageSemanticSource.thread_id == thread_id,
                    MessageSemanticSource.message_id == mid,
                    MessageSemanticSource.language == language,
                )
                .first()
            )
            content_hash = hash_by_mid.get(mid)
            if not content_hash:
                raise RuntimeError("Missing content_hash for memory message")

            if source:
                source.content_hash = content_hash
                source.index_state = "ready"
                source.indexed_at = now
                source.updated_at = now
                source.chunks = []
            else:
                source = MessageSemanticSource(
                    user_id=user_id,
                    project_id=project_id,
                    thread_id=thread_id,
                    message_id=mid,
                    language=language,
                    content_hash=content_hash,
                    index_state="ready",
                    indexed_at=now,
                    created_at=now,
                    updated_at=now,
                )
                db.add(source)

            chunk_pairs.sort(key=lambda pair: int(pair[0].get("chunk_index") or 0))
            for chunk, vec in chunk_pairs:
                source.chunks.append(
                    MessageSemanticChunk(
                        chunk_index=int(chunk["chunk_index"]),
                        field_path=str(chunk["field_path"]),
                        text=str(chunk["text"]),
                        embedding=vec,
                        embedding_dim=len(vec),
                        created_at=now,
                    )
                )
                indexed_count += 1

        summary_row = MessageMemorySummary(
            user_id=user_id,
            project_id=project_id,
            thread_id=thread_id,
            language=language,
            to_message_id=archive_until_message_id,
            to_seq_in_thread=int(boundary_message.seq_in_thread),
            summary_text=summary_text.strip(),
            created_at=datetime.utcnow(),
        )
        db.add(summary_row)

        db.commit()
        db.refresh(summary_row)
        return {
            "archived_until_message_id": summary_row.to_message_id,
            "archived_until_seq_in_thread": int(summary_row.to_seq_in_thread) if summary_row.to_seq_in_thread is not None else None,
            "summary_id": summary_row.id,
            "summary_text": summary_row.summary_text,
            "archived_message_ids": archived_ids,
            "indexed_count": indexed_count,
        }
    except Exception:
        db.rollback()
        raise


def _vec_to_pg(vec: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


async def search_thread_memory(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    thread_id: UUID,
    language: str,
    queries: List[str],
    top_k_per_query: int = 20,
) -> List[Dict[str, Any]]:
    if not queries:
        return []

    profile = get_embedding_profile(db, user_id=user_id, feature="memory")
    if not profile:
        return []

    memory_settings = settings_service.get_memory_settings(db, user_id)
    top_k_per_query = memory_settings.retrieval.top_k_per_query
    neighbor_window = memory_settings.retrieval.neighbor_window
    max_primary_items = memory_settings.retrieval.max_primary_items
    max_total_items = memory_settings.retrieval.max_total_items

    provider_config: Dict[str, Any] = credential_service.get_provider_config(
        db,
        user_id,
        str(profile["provider"]),
    )

    query_vectors = await embed_many(
        provider=profile["provider"],
        model=profile["model"],
        inputs=queries,
        config=provider_config,
        dimensions=profile.get("dimensions"),
        purpose="query",
    )

    best_by_message: Dict[UUID, Dict[str, Any]] = {}
    stmt = sql_text(
        """
        SELECT
          s.message_id AS message_id,
          c.chunk_index AS chunk_index,
          c.field_path AS field_path,
          c.text AS text,
          (c.embedding <-> (:qv)::vector) AS distance
        FROM message_semantic_chunks c
        JOIN message_semantic_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.thread_id = :thread_id
          AND s.language = :language
          AND s.index_state = 'ready'
        ORDER BY c.embedding <-> (:qv)::vector
        LIMIT :k
        """
    )

    for query_vec in query_vectors:
        rows = db.execute(
            stmt,
            {
                "qv": _vec_to_pg(query_vec),
                "user_id": user_id,
                "project_id": project_id,
                "thread_id": thread_id,
                "language": language,
                "k": int(top_k_per_query),
            },
        ).fetchall()
        for row in rows:
            message_id = row.message_id
            previous = best_by_message.get(message_id)
            if previous is None or (
                row.distance is not None and row.distance < (previous.get("distance") or 1e18)
            ):
                best_by_message[message_id] = {
                    "message_id": message_id,
                    "distance": float(row.distance) if row.distance is not None else None,
                    "chunk_index": int(row.chunk_index) if row.chunk_index is not None else None,
                    "field_path": str(row.field_path) if row.field_path is not None else None,
                    "content": str(row.text) if row.text is not None else "",
                }

    if not best_by_message:
        return []

    msg_rows: List[RunMessageModel] = (
        db.query(RunMessageModel)
        .filter(
            RunMessageModel.thread_id == thread_id,
            RunMessageModel.id.in_(list(best_by_message.keys())),
        )
        .all()
    )
    by_row_id: Dict[UUID, RunMessageModel] = {row.id: row for row in msg_rows}

    primary_results: List[Dict[str, Any]] = []
    for message_id, info in best_by_message.items():
        row = by_row_id.get(message_id)
        if row is None:
            continue
        primary_results.append(
            {
                "message_id": row.id,
                "role": row.role,
                "content": info.get("content") or "",
                "created_at": row.created_at,
                "seq_in_thread": int(row.seq_in_thread),
                "distance": info.get("distance"),
                "field_path": info.get("field_path"),
                "chunk_index": info.get("chunk_index"),
            }
        )

    primary_results.sort(
        key=lambda item: (
            item["distance"] is None,
            item["distance"] if item["distance"] is not None else 0.0,
            item["seq_in_thread"],
        )
    )
    primary_results = primary_results[:max(1, int(max_primary_items))]

    by_message_id: Dict[UUID, Dict[str, Any]] = {
        item["message_id"]: item
        for item in primary_results
    }

    if neighbor_window > 0 and primary_results:
        target_sequences: set[int] = set()
        for item in primary_results:
            seq = int(item["seq_in_thread"])
            for candidate in range(seq - neighbor_window, seq + neighbor_window + 1):
                if candidate >= 0:
                    target_sequences.add(candidate)

        neighbor_rows: List[RunMessageModel] = (
            db.query(RunMessageModel)
            .filter(
                RunMessageModel.thread_id == thread_id,
                RunMessageModel.seq_in_thread.in_(list(target_sequences)),
            )
            .all()
        )
        for row in neighbor_rows:
            if row.id in by_message_id:
                continue
            by_message_id[row.id] = {
                "message_id": row.id,
                "role": row.role,
                "content": "",
                "created_at": row.created_at,
                "seq_in_thread": int(row.seq_in_thread),
                "distance": None,
                "field_path": None,
                "chunk_index": None,
            }

    ordered = list(by_message_id.values())
    ordered.sort(
        key=lambda item: (
            item["distance"] is None,
            item["distance"] if item["distance"] is not None else 0.0,
            item["seq_in_thread"],
        )
    )
    ordered = ordered[:max(1, int(max_total_items))]
    ordered.sort(key=lambda item: item["seq_in_thread"])
    return ordered
