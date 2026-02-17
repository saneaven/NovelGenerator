from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .prompt_runtime.prompt_renderer import PromptRenderer
from .credential_service import credential_service
from .memory_service import search_memory
from .rag_search_service import search_project
from .settings_service import settings_service


async def build_memory_prompt(
    db: Session,
    *,
    renderer: PromptRenderer,
    task_type: str,
    prompt_name: str,
    project_data: dict[str, Any],
    extra_vars: dict[str, Any],
    user_id: UUID,
    project_id: UUID,
    owner_id: UUID | None,
    language: str,
    last_user_text: str,
    last_assistant_text: str,
    rag_enabled: bool,
) -> str | None:
    queries = [q.strip() for q in [last_user_text, last_assistant_text] if isinstance(q, str) and q.strip()]
    if not queries:
        return None

    rag_items: list[dict[str, Any]] = []
    if rag_enabled:
        try:
            rag_cfg = settings_service.get_rag_settings(db, user_id)
            embed_cfg = settings_service.get_embedding_config(db, user_id, "ragSearch")
            if embed_cfg.provider and embed_cfg.model:
                provider_config = credential_service.get_provider_config(db, user_id, embed_cfg.provider)
                rag_items = await search_project(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    queries=queries,
                    provider_config=provider_config,
                    top_k_per_query=rag_cfg.top_k_per_query,
                    neighbor_window=rag_cfg.neighbor_window,
                )
        except Exception:
            rag_items = []

    memory_items: list[dict[str, Any]] = []
    if owner_id is not None:
        try:
            memory_cfg = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
            memory_items = await search_memory(
                db,
                user_id=user_id,
                project_id=project_id,
                owner_id=owner_id,
                language=language,
                queries=queries,
                top_k_per_query=int(getattr(memory_cfg, "agent_memory_top_k_per_query", 20)),
            )
        except Exception:
            memory_items = []

    if not rag_items and not memory_items:
        return None

    rag_rows: list[dict[str, Any]] = []
    rag_lines: list[str] = []
    if rag_items:
        for idx, item in enumerate(rag_items[:20], start=1):
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            object_type = str(item.get("object_type") or "unknown")
            rag_rows.append(
                {
                    "index": idx,
                    "object_type": object_type,
                    "text": text,
                    "raw": item,
                }
            )
            rag_lines.append(f"{idx}. ({object_type}) {text}")

    history_rows: list[dict[str, Any]] = []
    history_lines: list[str] = []
    if memory_items:
        for idx, item in enumerate(memory_items[:20], start=1):
            text = str(item.get("content") or "").strip()
            if not text:
                continue
            role = str(item.get("role") or "assistant")
            history_rows.append(
                {
                    "index": idx,
                    "role": role,
                    "text": text,
                    "raw": item,
                }
            )
            history_lines.append(f"{idx}. ({role}) {text}")

    if not rag_rows and not history_rows:
        return None

    xml_lines: list[str] = ["<memory>"]
    if rag_lines:
        xml_lines.append("[rag]")
        xml_lines.extend(rag_lines)
    if history_lines:
        xml_lines.append("[history]")
        xml_lines.extend(history_lines)
    xml_lines.append("</memory>")

    memory_block = {
        "rag_items": rag_rows,
        "history_items": history_rows,
        "rag_text": "\n".join(rag_lines),
        "history_text": "\n".join(history_lines),
        "xml": "\n".join(xml_lines),
    }
    rendered = renderer.render_memory_prompt(
        task_type=task_type,
        prompt_name=prompt_name,
        project_data=project_data,
        extra_vars={
            **(extra_vars or {}),
            "memory": memory_block,
            "memoryRagItems": rag_rows,
            "memoryHistoryItems": history_rows,
            "memoryRagText": memory_block["rag_text"],
            "memoryHistoryText": memory_block["history_text"],
            "memoryXml": memory_block["xml"],
        },
    )
    rendered = rendered.strip()
    return rendered or None
