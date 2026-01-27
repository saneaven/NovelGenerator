from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from ..models.db_models import Agent, AgentMessage, User, UserSettings
from ..models.agent_memory_models import AgentMemorySummary, AgentRagChunk, AgentRagSource
from ..providers.registry import ProviderRegistry
from .embedding_config_service import get_embedding_profile, set_embedding_dimensions
from .credential_resolver import resolve_provider_config
from .rag_embedding_service import embed_many


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def wipe_agent_memory_index(db: Session, *, user_id: UUID) -> None:
    """Delete all agent-memory embeddings for a user (sources + chunks via cascade)."""
    db.query(AgentRagSource).filter(AgentRagSource.user_id == user_id).delete(synchronize_session=False)


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


async def _collect_streamed_content(stream: AsyncGenerator[bytes, None]) -> str:
    """Collect OpenAI-chat-completions-style SSE into a final content string."""
    buffer = ""
    parts: List[str] = []

    async for chunk in stream:
        try:
            buffer += chunk.decode("utf-8", errors="ignore")
        except Exception:
            continue

        while "\n\n" in buffer:
            frame, buffer = buffer.split("\n\n", 1)
            if not frame or frame.startswith(":"):
                continue

            if frame.startswith("event: error"):
                # Try to extract JSON error from data line
                data_line = ""
                for line in frame.splitlines():
                    if line.startswith("data:"):
                        data_line = line[5:].strip()
                        break
                if data_line:
                    try:
                        payload = json.loads(data_line)
                        msg = payload.get("message") or payload.get("error") or data_line
                    except Exception:
                        msg = data_line
                else:
                    msg = "Unknown SSE error"
                raise RuntimeError(f"LLM summary error: {msg}")

            for line in frame.splitlines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                if data == "[DONE]":
                    return "".join(parts).strip()
                try:
                    payload = json.loads(data)
                except Exception:
                    continue

                # Ignore explicit error objects
                if isinstance(payload, dict) and payload.get("error"):
                    err = payload["error"]
                    if isinstance(err, dict):
                        raise RuntimeError(err.get("message") or json.dumps(err))
                    raise RuntimeError(str(err))

                delta = None
                if isinstance(payload, dict):
                    choices = payload.get("choices")
                    if isinstance(choices, list) and choices:
                        delta = (choices[0] or {}).get("delta")
                if isinstance(delta, dict):
                    content = delta.get("content")
                    if isinstance(content, str):
                        parts.append(content)

    return "".join(parts).strip()


async def _run_summary_llm(
    *,
    db: Session,
    current_user: User,
    provider: str,
    model: str,
    temperature: float,
    summary_messages: List[Dict[str, str]],
    provider_request_config: Dict[str, Any],
    thinking_mode: Optional[str],
    thinking_config: Optional[Dict[str, Any]],
    custom_api_format: Optional[str],
    provider_preference: Optional[Dict[str, Any]],
    retry_config: Optional[Dict[str, Any]],
) -> str:
    provider_config: Dict[str, Any] = resolve_provider_config(
        provider=provider,
        request_config=provider_request_config,
        current_user=current_user,
        db=db,
    )

    instance = ProviderRegistry.get_provider(provider, provider_config)
    if not instance.validate_config():
        raise ValueError(f"Invalid configuration for provider '{provider}'")

    stream = instance.stream_chat(
        messages=summary_messages,
        model=model,
        temperature=temperature,
        tools=None,
        tool_choice=None,
        max_tokens=None,
        provider_preference=provider_preference,
        thinking_config=thinking_config,
        thinking_mode=thinking_mode,
        custom_api_format=custom_api_format,
        retry_config=retry_config,
        native_tool_call=False,
    )

    return await _collect_streamed_content(stream)


def get_memory_status(
    db: Session,
    *,
    user_id: UUID,
    agent: Agent,
) -> Dict[str, Any]:
    summary_count = (
        db.query(AgentMemorySummary)
        .filter(AgentMemorySummary.user_id == user_id, AgentMemorySummary.agent_id == agent.id)
        .count()
    )
    last = (
        db.query(AgentMemorySummary)
        .filter(AgentMemorySummary.user_id == user_id, AgentMemorySummary.agent_id == agent.id)
        .order_by(AgentMemorySummary.created_at.desc())
        .first()
    )
    indexed = (
        db.query(AgentRagSource)
        .filter(AgentRagSource.user_id == user_id, AgentRagSource.agent_id == agent.id)
        .count()
    )

    return {
        "hasMemory": summary_count > 0,
        "summaryCount": int(summary_count),
        "lastSummaryText": getattr(last, "summary_text", None) if last else None,
        "archivedUntilMessageId": agent.archived_until_message_id,
        "indexedMessageCount": int(indexed),
    }


async def archive_until(
    db: Session,
    *,
    current_user: User,
    project_id: UUID,
    agent: Agent,
    language: str,
    archive_until_message_id: UUID,
    summary_messages: List[Dict[str, str]],
    summary_provider_request_config: Dict[str, Any],
    embedding_provider_request_config: Dict[str, Any],
) -> Dict[str, Any]:
    # Idempotency boundary check
    current_boundary = agent.archived_until_message_id
    if current_boundary == archive_until_message_id:
        return {
            "archived_until_message_id": current_boundary,
            "summary_id": None,
            "summary_text": None,
            "archived_message_ids": [],
            "indexed_count": 0,
        }

    # Determine message range to archive (by created_at order)
    ordered_messages: List[AgentMessage] = (
        db.query(AgentMessage)
        .filter(AgentMessage.agent_id == agent.id)
        .order_by(AgentMessage.created_at.asc())
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

    # Resolve summary config (taskConfigs.summary, fallback to taskConfigs.agent)
    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    task_configs = settings.task_configs if settings else {}
    agent_cfg = task_configs.get("agent", {}) if isinstance(task_configs, dict) else {}
    summary_cfg = task_configs.get("summary", {}) if isinstance(task_configs, dict) else {}
    if not isinstance(agent_cfg, dict):
        agent_cfg = {}
    if not isinstance(summary_cfg, dict):
        summary_cfg = {}

    provider = (summary_cfg.get("provider") or agent_cfg.get("provider") or "openrouter").strip()
    model = (summary_cfg.get("model") or agent_cfg.get("model") or "gpt-5").strip()
    temperature = float(summary_cfg.get("temperature") if summary_cfg.get("temperature") is not None else agent_cfg.get("temperature") or 0.2)

    advanced = summary_cfg.get("advanced") if isinstance(summary_cfg.get("advanced"), dict) else {}
    thinking_mode = advanced.get("thinkingMode") if isinstance(advanced.get("thinkingMode"), str) else "off"
    thinking_config = advanced.get("thinkingConfig") if isinstance(advanced.get("thinkingConfig"), dict) else None
    custom_api_format = advanced.get("customApiFormat") if isinstance(advanced.get("customApiFormat"), str) else None
    provider_preference = summary_cfg.get("providerPreference") if isinstance(summary_cfg.get("providerPreference"), dict) else None
    retry_config = settings.retry_config if settings else None

    summary_text = await _run_summary_llm(
        db=db,
        current_user=current_user,
        provider=provider,
        model=model,
        temperature=temperature,
        summary_messages=summary_messages,
        provider_request_config=summary_provider_request_config,
        thinking_mode=thinking_mode,
        thinking_config=thinking_config,
        custom_api_format=custom_api_format,
        provider_preference=provider_preference,
        retry_config=retry_config,
    )

    summary_row = AgentMemorySummary(
        user_id=current_user.id,
        project_id=project_id,
        agent_id=agent.id,
        language=language,
        to_message_id=archive_until_message_id,
        summary_text=summary_text,
        created_at=datetime.utcnow(),
    )
    db.add(summary_row)

    # Update boundary cache
    agent.archived_until_message_id = archive_until_message_id

    # Index archived messages into agent_rag_* (best-effort; summary should still persist)
    indexed_count = 0
    try:
        profile = get_embedding_profile(db, user_id=current_user.id, feature="agentMemory")
        if profile:
            embedding_provider_cfg: Dict[str, Any] = resolve_provider_config(
                provider=profile["provider"],
                request_config=embedding_provider_request_config,
                current_user=current_user,
                db=db,
            )

            # Build embedding inputs for messages that need indexing
            to_embed: List[Tuple[AgentMessage, str, str]] = []
            for m in msgs:
                text = _extract_message_text(m.data, language).strip()
                if not text:
                    continue
                content_hash = _sha256(text)

                existing = (
                    db.query(AgentRagSource)
                    .filter(
                        AgentRagSource.user_id == current_user.id,
                        AgentRagSource.agent_id == agent.id,
                        AgentRagSource.message_id == m.id,
                        AgentRagSource.language == language,
                    )
                    .first()
                )
                if existing and existing.content_hash == content_hash and existing.index_state == "ready":
                    continue
                to_embed.append((m, text, content_hash))

            if to_embed:
                vectors = await embed_many(
                    provider=profile["provider"],
                    model=profile["model"],
                    inputs=[t for (_m, t, _h) in to_embed],
                    config=embedding_provider_cfg,
                    purpose="document",
                )

                now = datetime.utcnow()
                if vectors:
                    embedding_dim = len(vectors[0])
                    stored_dim = profile.get("dimensions")
                    if stored_dim is None:
                        set_embedding_dimensions(db, user_id=current_user.id, feature="agentMemory", dimensions=embedding_dim)
                    elif stored_dim != embedding_dim:
                        raise RuntimeError(f"Embedding dimensions mismatch (profile={stored_dim}, got={embedding_dim})")

                for (m, text, content_hash), vec in zip(to_embed, vectors):
                    source = (
                        db.query(AgentRagSource)
                        .filter(
                            AgentRagSource.user_id == current_user.id,
                            AgentRagSource.agent_id == agent.id,
                            AgentRagSource.message_id == m.id,
                            AgentRagSource.language == language,
                        )
                        .first()
                    )
                    if source:
                        # Replace existing chunks
                        source.content_hash = content_hash
                        source.index_state = "ready"
                        source.indexed_at = now
                        source.updated_at = now
                        source.chunks = []
                    else:
                        source = AgentRagSource(
                            user_id=current_user.id,
                            project_id=project_id,
                            agent_id=agent.id,
                            message_id=m.id,
                            language=language,
                            content_hash=content_hash,
                            index_state="ready",
                            indexed_at=now,
                            created_at=now,
                            updated_at=now,
                        )
                        db.add(source)

                    chunk = AgentRagChunk(
                        chunk_index=0,
                        field_path="content",
                        text=text,
                        embedding=vec,
                        embedding_dim=len(vec),
                        created_at=now,
                    )
                    source.chunks.append(chunk)
                    indexed_count += 1
    except Exception:
        # Best-effort: do not fail the archive if embedding indexing fails.
        pass

    db.commit()
    db.refresh(summary_row)

    return {
        "archived_until_message_id": agent.archived_until_message_id,
        "summary_id": summary_row.id,
        "summary_text": summary_row.summary_text,
        "archived_message_ids": archived_ids,
        "indexed_count": indexed_count,
    }


def _vec_to_pg(vec: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in vec) + "]"


async def search_memory(
    db: Session,
    *,
    current_user: User,
    project_id: UUID,
    agent_id: UUID,
    language: str,
    queries: List[str],
    provider_request_config: Dict[str, Any],
    top_k_per_query: int = 20,
) -> List[Dict[str, Any]]:
    if not queries:
        return []

    profile = get_embedding_profile(db, user_id=current_user.id, feature="agentMemory")
    if not profile:
        return []

    provider_config: Dict[str, Any] = resolve_provider_config(
        provider=profile["provider"],
        request_config=provider_request_config,
        current_user=current_user,
        db=db,
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
          (c.embedding <-> (:qv)::vector) AS distance
        FROM agent_rag_chunks c
        JOIN agent_rag_sources s ON s.id = c.source_id
        WHERE s.user_id = :user_id
          AND s.project_id = :project_id
          AND s.agent_id = :agent_id
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
                "user_id": current_user.id,
                "project_id": project_id,
                "agent_id": agent_id,
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
                }

    if not best_by_message:
        return []

    # Load full message rows for role/content/timestamp
    msg_rows: List[AgentMessage] = (
        db.query(AgentMessage)
        .filter(AgentMessage.agent_id == agent_id, AgentMessage.id.in_(list(best_by_message.keys())))
        .all()
    )

    by_id: Dict[UUID, AgentMessage] = {m.id: m for m in msg_rows}
    results: List[Dict[str, Any]] = []
    for mid, info in best_by_message.items():
        m = by_id.get(mid)
        if not m:
            continue
        results.append(
            {
                "message_id": m.id,
                "role": m.role,
                "content": _extract_message_text(m.data, language),
                "created_at": m.created_at,
                "distance": info.get("distance"),
            }
        )

    results.sort(key=lambda r: (r["distance"] is None, r["distance"] or 0.0, r["created_at"]))
    return results
