from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import Agent, RunMessageModel, RunModel, RunToolCallModel
from ..models.memory_models import MessageMemorySummary
from .memory_service import archive_until, search_memory
from .run_type_resolver import ResolvedRunConfig
from .settings_service import settings_service


@dataclass
class HistoryToolCall:
    id: str
    tool_name: str
    arguments: dict[str, Any]
    status: str
    reason: str | None
    failure_type: str | None
    result: dict[str, Any] | None


@dataclass
class HistoryMessage:
    id: UUID
    role: str
    content_parts: list[dict[str, Any]]
    thinking_details: list[dict[str, Any]]
    tool_calls: list[HistoryToolCall]


@dataclass
class RunContext:
    run: RunModel
    history: list[HistoryMessage]
    prompt_context: dict[str, Any]


class RunContextBuilder:
    def _extract_lang_entry(self, message: RunMessageModel, language: str) -> dict[str, Any]:
        blob = message.data if isinstance(message.data, dict) else {}
        entry = blob.get(language)
        if isinstance(entry, dict):
            return entry
        for value in blob.values():
            if isinstance(value, dict):
                return value
        return {}

    def _extract_content_parts(self, entry: dict[str, Any]) -> list[dict[str, Any]]:
        parts = entry.get("contentParts")
        if not isinstance(parts, list):
            return []
        out: list[dict[str, Any]] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")
            text = part.get("text")
            if ptype in {"content", "thinking"} and isinstance(text, str):
                out.append({"type": ptype, "text": text})
        return out

    def _extract_thinking_details(self, entry: dict[str, Any]) -> list[dict[str, Any]]:
        details = entry.get("thinkingDetails")
        if not isinstance(details, list):
            return []
        out: list[dict[str, Any]] = []
        for item in details:
            if isinstance(item, dict):
                out.append(item)
        return out

    def _message_text_from_entry(self, entry: dict[str, Any]) -> str:
        parts = entry.get("contentParts")
        if not isinstance(parts, list):
            return ""
        chunks: list[str] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if part.get("type") != "content":
                continue
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
        return "".join(chunks)

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        if not text:
            return 0
        # Lightweight estimator to avoid per-step tokenizer overhead.
        return max(1, (len(text) + 3) // 4)

    def _estimate_memory_tokens(
        self,
        *,
        run: RunModel,
        query_text: str,
        active_rows: list[RunMessageModel],
        summaries: list[dict[str, Any]],
        relevant: list[dict[str, Any]],
        tool_by_message: dict[UUID, list[RunToolCallModel]],
    ) -> int:
        total = self._estimate_tokens(query_text or "")
        for row in active_rows:
            entry = self._extract_lang_entry(row, run.language)
            text = self._message_text_from_entry(entry)
            total += self._estimate_tokens(text) + 6

            tool_rows = tool_by_message.get(row.id, [])
            for tc in tool_rows:
                total += self._estimate_tokens(tc.tool_name or "")
                total += self._estimate_tokens(tc.reason or "")
                if isinstance(tc.result, dict):
                    total += self._estimate_tokens(str(tc.result)[:1200])

        for item in summaries:
            total += self._estimate_tokens(str(item.get("summaryText") or ""))
        for item in relevant:
            total += self._estimate_tokens(str(item.get("content") or ""))
        return total

    def _compute_memory_budget(self, db: Session, user_id: UUID, cfg: ResolvedRunConfig) -> int:
        task_cfg = settings_service.get_task_config(db, user_id, cfg.task_type)
        context_window = int(task_cfg.context_window_tokens or 32000)
        reserved_output = int(cfg.max_output_tokens or max(1024, context_window // 8))
        safety = 1500
        budget = context_window - reserved_output - safety
        return max(2048, budget)

    def _build_run_history(self, db: Session, run: RunModel) -> list[RunMessageModel]:
        if run.run_type == "agent":
            runs = (
                db.query(RunModel.id)
                .filter(RunModel.agent_id == run.agent_id, RunModel.run_type == "agent")
                .order_by(RunModel.root_run_seq.asc().nullslast(), RunModel.created_at.asc(), RunModel.id.asc())
                .all()
            )
            run_ids = [r[0] for r in runs]
        elif run.run_type == "subAgent":
            runs = (
                db.query(RunModel.id)
                .filter(RunModel.sub_agent_id == run.sub_agent_id, RunModel.run_type == "subAgent")
                .order_by(RunModel.created_at.asc(), RunModel.id.asc())
                .all()
            )
            run_ids = [r[0] for r in runs]
        else:
            run_ids = [run.id]

        if not run_ids:
            return []

        messages = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.run_id.in_(run_ids))
            .order_by(RunMessageModel.created_at.asc(), RunMessageModel.seq.asc(), RunMessageModel.id.asc())
            .all()
        )
        return messages

    def _tool_calls_by_message(self, db: Session, run_ids: list[UUID]) -> dict[UUID, list[RunToolCallModel]]:
        if not run_ids:
            return {}
        rows = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.run_id.in_(run_ids))
            .order_by(RunToolCallModel.call_seq.asc(), RunToolCallModel.created_at.asc())
            .all()
        )
        out: dict[UUID, list[RunToolCallModel]] = {}
        for row in rows:
            out.setdefault(row.message_id, []).append(row)
        return out

    def _resolve_archive_boundary(self, db: Session, run: RunModel, owner_id: UUID, agent: Agent | None) -> UUID | None:
        if agent is None:
            return None
        if owner_id == agent.id:
            return agent.archived_until_message_id
        latest = (
            db.query(MessageMemorySummary)
            .filter(
                MessageMemorySummary.user_id == run.user_id,
                MessageMemorySummary.project_id == run.project_id,
                MessageMemorySummary.owner_id == owner_id,
                MessageMemorySummary.language == run.language,
            )
            .order_by(MessageMemorySummary.created_at.desc())
            .first()
        )
        return latest.to_message_id if latest else None

    def _slice_after_boundary(self, rows: list[RunMessageModel], boundary: UUID | None) -> list[RunMessageModel]:
        if boundary is None:
            return list(rows)
        for idx, row in enumerate(rows):
            if row.id == boundary:
                return rows[idx + 1 :]
        return list(rows)

    def _load_previous_summaries(self, db: Session, run: RunModel, owner_id: UUID | None) -> list[dict[str, Any]]:
        if owner_id is None:
            return []
        rows = (
            db.query(MessageMemorySummary)
            .filter(
                MessageMemorySummary.user_id == run.user_id,
                MessageMemorySummary.project_id == run.project_id,
                MessageMemorySummary.owner_id == owner_id,
                MessageMemorySummary.language == run.language,
            )
            .order_by(MessageMemorySummary.created_at.desc())
            .limit(5)
            .all()
        )
        return [
            {
                "toMessageId": str(row.to_message_id) if row.to_message_id else None,
                "summaryText": row.summary_text or "",
                "createdAt": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]

    def _build_archived_message_payload(
        self,
        *,
        row: RunMessageModel,
        language: str,
        tool_rows: list[RunToolCallModel],
    ) -> dict[str, Any]:
        entry = self._extract_lang_entry(row, language)
        content = self._message_text_from_entry(entry)
        payload_calls: list[dict[str, Any]] = []
        for tc in tool_rows:
            payload_calls.append(
                {
                    "id": tc.llm_call_id,
                    "tool_name": tc.tool_name,
                    "status": tc.status,
                    "reason": tc.reason,
                    "failure_type": tc.failure_type,
                    "result": tc.result if isinstance(tc.result, dict) else {},
                }
            )

        return {
            "message_id": row.id,
            "role": row.role,
            "content": content,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "tool_calls": payload_calls,
        }

    def _build_archive_summary(self, archived_messages: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for item in archived_messages[-24:]:
            role = str(item.get("role") or "message")
            content = str(item.get("content") or "").replace("\n", " ").strip()
            if len(content) > 200:
                content = content[:197] + "..."
            if content:
                lines.append(f"- {role}: {content}")
        if not lines:
            return "Auto-generated archive summary."
        return "Auto-generated archive summary\n" + "\n".join(lines)

    def _latest_user_query_text(self, rows: list[RunMessageModel], language: str, fallback: str) -> str:
        for row in reversed(rows):
            if row.role != "user":
                continue
            text = self._message_text_from_entry(self._extract_lang_entry(row, language)).strip()
            if text:
                return text
        return fallback

    async def _prepare_run_memory(
        self,
        *,
        db: Session,
        run: RunModel,
        cfg: ResolvedRunConfig,
        history_rows: list[RunMessageModel],
        tool_by_message: dict[UUID, list[RunToolCallModel]],
        owner_id: UUID | None,
        query_text: str,
    ) -> tuple[list[RunMessageModel], list[dict[str, Any]], list[dict[str, Any]], UUID | None]:
        if not cfg.memory_enabled or owner_id is None:
            return history_rows, [], [], None

        agent = db.query(Agent).filter(Agent.id == run.agent_id).first() if run.agent_id else None
        boundary = self._resolve_archive_boundary(db, run, owner_id, agent)
        active_rows = self._slice_after_boundary(history_rows, boundary)

        summaries = self._load_previous_summaries(db, run, owner_id)
        relevant: list[dict[str, Any]] = []
        user_settings = settings_service._get_settings(db, run.user_id)
        memory_top_k = int(getattr(user_settings, "agent_memory_top_k_per_query", 8) or 8)

        if query_text.strip():
            relevant_rows = await search_memory(
                db,
                user_id=run.user_id,
                project_id=run.project_id,
                owner_id=owner_id,
                language=run.language,
                queries=[query_text],
                top_k_per_query=memory_top_k,
            )
            relevant = [
                {
                    "messageId": str(item.get("message_id")),
                    "role": item.get("role"),
                    "content": item.get("content"),
                    "createdAt": item.get("created_at").isoformat() if item.get("created_at") else None,
                    "distance": item.get("distance"),
                }
                for item in relevant_rows
            ]

        budget = self._compute_memory_budget(db, run.user_id, cfg)
        for _ in range(3):
            estimated = self._estimate_memory_tokens(
                run=run,
                query_text=query_text,
                active_rows=active_rows,
                summaries=summaries,
                relevant=relevant,
                tool_by_message=tool_by_message,
            )
            if estimated <= budget:
                break
            if not active_rows or agent is None:
                break

            cut_count = max(1, len(active_rows) // 3)
            archived_slice = active_rows[:cut_count]
            if not archived_slice:
                break
            archive_until_row = archived_slice[-1]

            archived_payload = [
                self._build_archived_message_payload(
                    row=row,
                    language=run.language,
                    tool_rows=tool_by_message.get(row.id, []),
                )
                for row in archived_slice
            ]
            summary_text = self._build_archive_summary(archived_payload)

            await archive_until(
                db,
                user_id=run.user_id,
                project_id=run.project_id,
                agent=agent,
                owner_id=owner_id,
                language=run.language,
                archive_until_message_id=archive_until_row.id,
                summary_text=summary_text,
                archived_messages=archived_payload,
            )

            boundary = archive_until_row.id
            active_rows = active_rows[cut_count:]
            summaries = self._load_previous_summaries(db, run, owner_id)
            if query_text.strip():
                relevant_rows = await search_memory(
                    db,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    owner_id=owner_id,
                    language=run.language,
                    queries=[query_text],
                    top_k_per_query=memory_top_k,
                )
                relevant = [
                    {
                        "messageId": str(item.get("message_id")),
                        "role": item.get("role"),
                        "content": item.get("content"),
                        "createdAt": item.get("created_at").isoformat() if item.get("created_at") else None,
                        "distance": item.get("distance"),
                    }
                    for item in relevant_rows
                ]

        estimated = self._estimate_memory_tokens(
            run=run,
            query_text=query_text,
            active_rows=active_rows,
            summaries=summaries,
            relevant=relevant,
            tool_by_message=tool_by_message,
        )
        while estimated > budget and active_rows:
            active_rows = active_rows[1:]
            estimated = self._estimate_memory_tokens(
                run=run,
                query_text=query_text,
                active_rows=active_rows,
                summaries=summaries,
                relevant=relevant,
                tool_by_message=tool_by_message,
            )

        return active_rows, summaries, relevant, boundary

    def _build_prompt_context(
        self,
        db: Session,
        run: RunModel,
        cfg: ResolvedRunConfig,
        *,
        previous_summaries: list[dict[str, Any]] | None = None,
        relevant_chats: list[dict[str, Any]] | None = None,
        archived_until_message_id: UUID | None = None,
    ) -> dict[str, Any]:
        agent = db.query(Agent).filter(Agent.id == run.agent_id).first() if run.agent_id else None
        owner_id = run.agent_id
        if run.run_type == "subAgent":
            owner_id = run.sub_agent_id

        summaries = previous_summaries
        if summaries is None:
            summaries = self._load_previous_summaries(db, run, owner_id)

        boundary = archived_until_message_id
        if boundary is None and cfg.memory_enabled and owner_id is not None:
            boundary = self._resolve_archive_boundary(db, run, owner_id, agent)

        return {
            "run": {
                "id": str(run.id),
                "project_id": str(run.project_id),
                "user_id": str(run.user_id),
                "run_type": run.run_type,
                "run_mode": run.run_mode,
                "surface": run.surface,
                "journey_kind": run.journey_kind,
                "language": run.language,
                "input_text": run.input_text,
                "input_payload": run.input_payload if isinstance(run.input_payload, dict) else {},
                "context_object_ids": run.context_object_ids if isinstance(run.context_object_ids, list) else [],
                "journey_target_ids": run.journey_target_ids if isinstance(run.journey_target_ids, list) else [],
            },
            "agent": {
                "id": str(agent.id) if agent else None,
                "name": agent.name if agent else None,
                "archived_until_message_id": str(boundary) if boundary else None,
            },
            "memory": {
                "enabled": cfg.memory_enabled,
                "previous_summaries": summaries,
                "relevant_chats": relevant_chats or [],
            },
            "project_data": run.frozen_context.get("project_data") if isinstance(run.frozen_context, dict) else None,
            "frozen_context": run.frozen_context if isinstance(run.frozen_context, dict) else None,
        }

    async def build(self, db: Session, run: RunModel, cfg: ResolvedRunConfig) -> RunContext:
        history_rows = self._build_run_history(db, run)
        run_ids = sorted({m.run_id for m in history_rows})
        tool_by_message = self._tool_calls_by_message(db, run_ids)

        owner_id = run.agent_id
        if run.run_type == "subAgent":
            owner_id = run.sub_agent_id
        query_text = self._latest_user_query_text(history_rows, run.language, run.input_text)

        if cfg.memory_enabled and owner_id is not None:
            active_rows, summaries, relevant, archived_boundary = await self._prepare_run_memory(
                db=db,
                run=run,
                cfg=cfg,
                history_rows=history_rows,
                tool_by_message=tool_by_message,
                owner_id=owner_id,
                query_text=query_text,
            )
        else:
            active_rows = history_rows
            summaries = []
            relevant = []
            archived_boundary = None

        history: list[HistoryMessage] = []
        for msg in active_rows:
            entry = self._extract_lang_entry(msg, run.language)
            content_parts = self._extract_content_parts(entry)
            thinking_details = self._extract_thinking_details(entry)

            tool_calls = [
                HistoryToolCall(
                    id=row.llm_call_id,
                    tool_name=row.tool_name,
                    arguments=row.arguments if isinstance(row.arguments, dict) else {},
                    status=row.status,
                    reason=row.reason,
                    failure_type=row.failure_type,
                    result=row.result if isinstance(row.result, dict) else None,
                )
                for row in tool_by_message.get(msg.id, [])
            ]

            history.append(
                HistoryMessage(
                    id=msg.id,
                    role=msg.role,
                    content_parts=content_parts,
                    thinking_details=thinking_details,
                    tool_calls=tool_calls,
                )
            )

        prompt_context = self._build_prompt_context(
            db,
            run,
            cfg,
            previous_summaries=summaries,
            relevant_chats=relevant,
            archived_until_message_id=archived_boundary,
        )

        return RunContext(run=run, history=history, prompt_context=prompt_context)


run_context_builder = RunContextBuilder()
