from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ..models.memory_models import MessageMemorySummary, MessageRagChunk, MessageRagSource
from ..models.db_models import Agent, RunModel, RunMessageModel
from .credential_service import credential_service
from .embedding_config_service import get_embedding_profile, set_embedding_dimensions
from .rag_embedding_service import embed_many
from .rag_chunker import merge_blocks_by_length, split_plaintext_blocks


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def wipe_memory_index(db: Session, *, user_id: UUID) -> None:
    """Delete all message-memory embeddings for a user (sources + chunks via cascade)."""
    db.query(MessageRagSource).filter(MessageRagSource.user_id == user_id).delete(synchronize_session=False)


def _extract_message_text(data: Dict[str, Any], language: str) -> str:
    if not isinstance(data, dict):
        return ""

    lang_blob = data.get(language)
    if not isinstance(lang_blob, dict) or "contentParts" not in lang_blob:
        # Fallback: first available language
        for v in data.values():
            if isinstance(v, dict) and "contentParts" in v:
                lang_blob = v
                break

    if not isinstance(lang_blob, dict):
        return ""

    parts = lang_blob.get("contentParts")
    if not isinstance(parts, list):
        return ""

    out: List[str] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        if p.get("type") == "content":
            out.append(str(p.get("text") or ""))
    return "".join(out)

_WS_RE = re.compile(r"[ \t]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")


def _normalize_for_hash(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join([line.rstrip() for line in text.split("\n")])
    text = _WS_RE.sub(" ", text)
    text = _MULTI_NL_RE.sub("\n\n", text)
    return text.strip()


def _compute_chunks_hash(chunks: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for c in chunks:
        field_path = c.get("field_path")
        chunk_index = c.get("chunk_index")
        text = c.get("text")
        if not isinstance(field_path, str) or not isinstance(chunk_index, int) or not isinstance(text, str):
            continue
        t = _normalize_for_hash(text)
        if not t:
            continue
        parts.append(f"[{field_path}:{chunk_index}]\n{t}\n")
    payload = "\n".join(parts).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _extract_string_leaves(value: Any, *, path: str = "") -> List[Tuple[str, str]]:
    """Extract (json_path, string_value) for all string leaf values."""
    out: List[Tuple[str, str]] = []

    if isinstance(value, str):
        v = value.strip()
        if v:
            out.append((path, v))
        return out

    if isinstance(value, list):
        for i, item in enumerate(value):
            child_path = f"{path}/{i}" if path else str(i)
            out.extend(_extract_string_leaves(item, path=child_path))
        return out

    if isinstance(value, dict):
        for k, item in value.items():
            key = str(k)
            child_path = f"{path}/{key}" if path else key
            out.extend(_extract_string_leaves(item, path=child_path))
        return out

    return out


def _build_memory_chunks(*, message_req: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build embedding chunks (field_path + text) for a single archived message request.

    Chunking policy matches RAG Search:
    - `merge_blocks_by_length(min_chars=200, target_chars=600, max_chars=1200)`
    - Uses plaintext block splitting to preserve raw-ish content.
    """
    MIN_CHARS = 200
    TARGET_CHARS = 600
    MAX_CHARS = 1200

    chunks: List[Dict[str, Any]] = []

    # 1) content (raw-ish)
    content = str(message_req.get("content") or "").strip()
    if content:
        blocks = split_plaintext_blocks(content)
        if not blocks:
            blocks = [content]
        merged = merge_blocks_by_length(blocks, min_chars=MIN_CHARS, target_chars=TARGET_CHARS, max_chars=MAX_CHARS)
        for text in merged:
            t = (text or "").strip()
            if t:
                chunks.append({"field_path": "content", "text": t})

    # 2) tool_calls (string-leaf extraction, grouped by tool_call_id)
    tool_calls = message_req.get("tool_calls")
    if isinstance(tool_calls, list):
        for i, tc in enumerate(tool_calls):
            if not isinstance(tc, dict):
                continue
            tc_id = str(tc.get("id") or f"index/{i}").strip() or f"index/{i}"
            field_path = f"tool_calls/{tc_id}"

            leaves = _extract_string_leaves(tc)
            # Skip obvious non-semantic fields (tool call id is already in field_path).
            blocks = [
                v for (p, v) in leaves
                if p not in {"id", "acceptedAt"}
                and not p.startswith("extra_content/")
                and v
            ]
            if not blocks:
                continue

            merged = merge_blocks_by_length(blocks, min_chars=MIN_CHARS, target_chars=TARGET_CHARS, max_chars=MAX_CHARS)
            for text in merged:
                t = (text or "").strip()
                if t:
                    chunks.append({"field_path": field_path, "text": t})

    # Assign chunk_index sequentially across all fields for this message (unique per source).
    for idx, c in enumerate(chunks):
        c["chunk_index"] = idx

    return chunks


def _select_message_range(
    *,
    ordered_ids: List[UUID],
    current_boundary: Optional[UUID],
    archive_until: UUID,
) -> Tuple[int, int]:
    """Return (start_index, end_index_inclusive) within ordered_ids.

    Raises ValueError if archive_until is not in ordered_ids.
    """
    try:
        end_idx = ordered_ids.index(archive_until)
    except ValueError:
        raise ValueError("archive_until_message_id not found in agent message history")

    start_idx = 0
    if current_boundary:
        try:
            start_idx = ordered_ids.index(current_boundary) + 1
        except ValueError:
            # Boundary message deleted; treat as no boundary.
            start_idx = 0

    return start_idx, end_idx


def get_memory_status(
    db: Session,
    *,
    user_id: UUID,
    agent: Agent,
    owner_id: UUID,
) -> Dict[str, Any]:
    summary_count = (
        db.query(MessageMemorySummary)
        .filter(MessageMemorySummary.user_id == user_id, MessageMemorySummary.owner_id == owner_id)
        .count()
    )
    last = (
        db.query(MessageMemorySummary)
        .filter(MessageMemorySummary.user_id == user_id, MessageMemorySummary.owner_id == owner_id)
        .order_by(MessageMemorySummary.created_at.desc())
        .first()
    )
    indexed = (
        db.query(MessageRagSource)
        .filter(MessageRagSource.user_id == user_id, MessageRagSource.owner_id == owner_id)
        .count()
    )

    # Archive boundary: for root agents use agent.archived_until_message_id;
    # for sub-agents use the latest summary's to_message_id.
    if owner_id == agent.id:
        archived_until = agent.archived_until_message_id
    else:
        archived_until = getattr(last, "to_message_id", None) if last else None

    return {
        "hasMemory": summary_count > 0,
        "summaryCount": int(summary_count),
        "lastSummaryText": getattr(last, "summary_text", None) if last else None,
        "archivedUntilMessageId": archived_until,
        "indexedMessageCount": int(indexed),
    }


async def archive_until(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    agent: Agent,
    owner_id: UUID,
    language: str,
    archive_until_message_id: UUID,
    summary_text: str,
    archived_messages: List[Dict[str, Any]],
) -> Dict[str, Any]:
    # Idempotency boundary check
    # For root agents: use agent.archived_until_message_id
    # For sub-agents: use the latest summary's to_message_id
    if owner_id == agent.id:
        current_boundary = agent.archived_until_message_id
    else:
        latest_summary = (
            db.query(MessageMemorySummary)
            .filter(MessageMemorySummary.user_id == user_id, MessageMemorySummary.owner_id == owner_id)
            .order_by(MessageMemorySummary.created_at.desc())
            .first()
        )
        current_boundary = getattr(latest_summary, "to_message_id", None) if latest_summary else None

    if current_boundary == archive_until_message_id:
        return {
            "archived_until_message_id": current_boundary,
            "summary_id": None,
            "summary_text": None,
            "archived_message_ids": [],
            "indexed_count": 0,
        }

    # Determine message range to archive (by run → message ordering)
    # For root agents: use root runs. For sub-agents: filter child runs by sub_agent_id.
    if owner_id == agent.id:
        ordered_messages: List[RunMessageModel] = (
            db.query(RunMessageModel)
            .join(RunModel, RunMessageModel.run_id == RunModel.id)
            .filter(RunModel.agent_id == agent.id, RunModel.run_type == "agent")
            .order_by(RunModel.root_run_seq.asc().nullslast(), RunModel.created_at.asc(), RunMessageModel.seq.asc())
            .all()
        )
    else:
        ordered_messages = (
            db.query(RunMessageModel)
            .join(RunModel, RunMessageModel.run_id == RunModel.id)
            .filter(RunModel.sub_agent_id == owner_id, RunModel.run_type == "subAgent")
            .order_by(RunModel.created_at.asc(), RunMessageModel.seq.asc())
            .all()
        )

    ordered_ids = [m.id for m in ordered_messages]

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
            "indexed_count": 0,
        }

    msgs = ordered_messages[start_idx : end_idx + 1]
    archived_ids = [m.id for m in msgs]

    if not summary_text or not summary_text.strip():
        raise ValueError("summary_text is required")

    if not archived_messages:
        raise ValueError("archived_messages is required")

    archived_by_id: Dict[UUID, Dict[str, Any]] = {}
    for m in archived_messages:
        mid = m.get("message_id")
        if isinstance(mid, UUID):
            archived_by_id[mid] = m

    if archive_until_message_id not in archived_by_id:
        raise ValueError("archived_messages must include archive_until_message_id")

    # Index archived messages into message_rag_* (must complete before returning)
    profile = get_embedding_profile(db, user_id=user_id, feature="agentMemory")
    if not profile:
        raise ValueError("Missing agent-memory embedding profile")

    embedding_provider_cfg: Dict[str, Any] = credential_service.get_provider_config(
        db,
        user_id,
        str(profile["provider"]),
    )

    indexed_count = 0

    try:
        # Build embedding inputs (chunk-level) for messages that need (re)indexing.
        chunks_to_embed: List[Dict[str, Any]] = []
        hash_by_mid: Dict[UUID, str] = {}

        for m in msgs:
            req = archived_by_id.get(m.id)
            if req is None:
                raise ValueError(f"archived_messages missing message_id={m.id}")

            chunks = _build_memory_chunks(message_req=req)
            if not chunks:
                continue

            content_hash = _compute_chunks_hash(chunks)

            existing = (
                db.query(MessageRagSource)
                .filter(
                    MessageRagSource.user_id == user_id,
                    MessageRagSource.owner_id == owner_id,
                    MessageRagSource.message_id == m.id,
                    MessageRagSource.language == language,
                )
                .first()
            )
            if existing and existing.content_hash == content_hash and existing.index_state == "ready":
                continue

            hash_by_mid[m.id] = content_hash
            for c in chunks:
                chunks_to_embed.append(
                    {
                        "message_id": m.id,
                        "field_path": c["field_path"],
                        "chunk_index": int(c["chunk_index"]),
                        "text": c["text"],
                    }
                )

        vectors: List[List[float]] = []
        if chunks_to_embed:
            vectors = await embed_many(
                provider=profile["provider"],
                model=profile["model"],
                inputs=[c["text"] for c in chunks_to_embed],
                config=embedding_provider_cfg,
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
                set_embedding_dimensions(db, user_id=user_id, feature="agentMemory", dimensions=embedding_dim)
            elif stored_dim != embedding_dim:
                raise RuntimeError(f"Embedding dimensions mismatch (profile={stored_dim}, got={embedding_dim})")

        # Group embedded chunks by message_id
        by_mid: Dict[UUID, List[Tuple[Dict[str, Any], List[float]]]] = {}
        for c, vec in zip(chunks_to_embed, vectors):
            mid = c["message_id"]
            by_mid.setdefault(mid, []).append((c, vec))

        for mid, chunk_pairs in by_mid.items():
            source = (
                db.query(MessageRagSource)
                .filter(
                    MessageRagSource.user_id == user_id,
                    MessageRagSource.owner_id == owner_id,
                    MessageRagSource.message_id == mid,
                    MessageRagSource.language == language,
                )
                .first()
            )

            content_hash = hash_by_mid.get(mid)
            if not content_hash:
                raise RuntimeError("Missing content_hash for memory message")

            if source:
                # Replace existing chunks
                source.content_hash = content_hash
                source.index_state = "ready"
                source.indexed_at = now
                source.updated_at = now
                source.chunks = []
            else:
                source = MessageRagSource(
                    user_id=user_id,
                    project_id=project_id,
                    owner_id=owner_id,
                    message_id=mid,
                    language=language,
                    content_hash=content_hash,
                    index_state="ready",
                    indexed_at=now,
                    created_at=now,
                    updated_at=now,
                )
                db.add(source)

            # chunk_index is already unique per message/source; store in that order.
            chunk_pairs.sort(key=lambda x: int(x[0].get("chunk_index") or 0))
            for c, vec in chunk_pairs:
                chunk = MessageRagChunk(
                    chunk_index=int(c["chunk_index"]),
                    field_path=str(c["field_path"]),
                    text=str(c["text"]),
                    embedding=vec,
                    embedding_dim=len(vec),
                    created_at=now,
                )
                source.chunks.append(chunk)
                indexed_count += 1

        summary_row = MessageMemorySummary(
            user_id=user_id,
            project_id=project_id,
            owner_id=owner_id,
            language=language,
            to_message_id=archive_until_message_id,
            summary_text=summary_text.strip(),
            created_at=datetime.utcnow(),
        )
        db.add(summary_row)

        # Update boundary cache — only for root agents
        if owner_id == agent.id:
            agent.archived_until_message_id = archive_until_message_id

        db.commit()
        db.refresh(summary_row)

        return {
            "archived_until_message_id": archive_until_message_id if owner_id == agent.id else getattr(summary_row, "to_message_id", archive_until_message_id),
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


async def search_memory(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    owner_id: UUID,
    language: str,
    queries: List[str],
    top_k_per_query: int = 20,
) -> List[Dict[str, Any]]:
    if not queries:
        return []

    profile = get_embedding_profile(db, user_id=user_id, feature="agentMemory")
    if not profile:
        return []

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
        purpose="query",
    )

    best_by_message: Dict[UUID, Dict[str, Any]] = {}

    stmt = sql_text(
        """
        SELECT
          c.id AS chunk_id,
          s.message_id AS message_id,
          c.chunk_index AS chunk_index,
          c.field_path AS field_path,
          c.text AS text,
          (c.embedding <-> (:qv)::vector) AS distance
        FROM message_rag_chunks c
        JOIN message_rag_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.owner_id = :owner_id
          AND s.language = :language
          AND s.index_state = 'ready'
        ORDER BY c.embedding <-> (:qv)::vector
        LIMIT :k
        """
    )

    for qv in query_vectors:
        qv_str = _vec_to_pg(qv)
        rows = db.execute(
            stmt,
            {
                "qv": qv_str,
                "user_id": user_id,
                "project_id": project_id,
                "owner_id": owner_id,
                "language": language,
                "k": int(top_k_per_query),
            },
        ).fetchall()

        for r in rows:
            mid = r.message_id
            prev = best_by_message.get(mid)
            if prev is None or (r.distance is not None and r.distance < (prev.get("distance") or 1e18)):
                best_by_message[mid] = {
                    "message_id": mid,
                    "distance": float(r.distance) if r.distance is not None else None,
                    "chunk_index": int(r.chunk_index) if r.chunk_index is not None else None,
                    "field_path": str(r.field_path) if r.field_path is not None else None,
                    "content": str(r.text) if r.text is not None else "",
                }

    if not best_by_message:
        return []

    # Load full message rows for role/content/timestamp
    # We need to join through runs — for root agents filter by agent_id, for sub-agents by sub_agent_id
    msg_rows: List[RunMessageModel] = (
        db.query(RunMessageModel)
        .filter(RunMessageModel.id.in_(list(best_by_message.keys())))
        .all()
    )

    by_id: Dict[UUID, RunMessageModel] = {m.id: m for m in msg_rows}
    results: List[Dict[str, Any]] = []
    for mid, info in best_by_message.items():
        m = by_id.get(mid)
        if not m:
            continue
        results.append(
            {
                "message_id": m.id,
                "role": m.role,
                "content": info.get("content") or "",
                "created_at": m.created_at,
                "distance": info.get("distance"),
                "field_path": info.get("field_path"),
                "chunk_index": info.get("chunk_index"),
            }
        )

    results.sort(key=lambda r: (r["distance"] is None, r["distance"] or 0.0, r["created_at"]))
    return results
