"""Thread-level conversation history with capture / reuse caching."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread


# ── Canonical message types ──


@dataclass
class HistoryToolCall:
    id: str
    tool_name: str
    arguments: dict[str, Any]
    status: str
    reason: str | None
    result: dict[str, Any] | None


@dataclass
class HistoryMessage:
    id: UUID
    role: str
    content_parts: list[dict[str, Any]]
    thinking_details: list[dict[str, Any]]
    tool_calls: list[HistoryToolCall]


@dataclass
class CapturedHistory:
    """Pre-loaded history snapshot for a thread."""

    system_prompt: str
    conversation: list[HistoryMessage]
    prefill: str

    @property
    def messages(self) -> list[HistoryMessage]:
        # Convenience alias for call sites that only need conversation messages.
        return self.conversation


# ── Service ──


class HistoryService:
    """Manages thread-level conversation history with capture/reuse caching."""

    # ── Extract helpers (ported from run_context_builder) ──

    @staticmethod
    def extract_lang_entry(message: RunMessageModel, language: str) -> dict[str, Any]:
        blob = message.data if isinstance(message.data, dict) else {}
        entry = blob.get(language)
        if isinstance(entry, dict):
            return entry
        for value in blob.values():
            if isinstance(value, dict):
                return value
        return {}

    @staticmethod
    def extract_content_parts(entry: dict[str, Any]) -> list[dict[str, Any]]:
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

    @staticmethod
    def extract_thinking_details(entry: dict[str, Any]) -> list[dict[str, Any]]:
        details = entry.get("thinkingDetails")
        if not isinstance(details, list):
            return []
        return [item for item in details if isinstance(item, dict)]

    @staticmethod
    def message_text_from_entry(entry: dict[str, Any]) -> str:
        parts = entry.get("contentParts")
        if not isinstance(parts, list):
            return ""
        return "".join(
            str(p.get("text") or "")
            for p in parts
            if isinstance(p, dict) and p.get("type") == "content"
        )

    @staticmethod
    def message_text(msg: HistoryMessage) -> str:
        """Extract plain text content from a HistoryMessage."""
        return "".join(
            str(p.get("text") or "")
            for p in msg.content_parts
            if isinstance(p, dict) and p.get("type") == "content"
        )

    # ── DB helpers ──

    @staticmethod
    def _latest_history_run(db: Session, thread_id: UUID, exclude_run_id: UUID) -> RunModel | None:
        return (
            db.query(RunModel)
            .filter(
                RunModel.thread_id == thread_id,
                RunModel.id != exclude_run_id,
            )
            .order_by(RunModel.run_seq.desc().nullslast(), RunModel.created_at.desc())
            .first()
        )

    @staticmethod
    def _last_role_for_run(db: Session, run_id: UUID) -> str | None:
        row = (
            db.query(RunMessageModel.role)
            .filter(RunMessageModel.run_id == run_id)
            .order_by(RunMessageModel.seq.desc(), RunMessageModel.created_at.desc())
            .first()
        )
        return str(row[0]) if row else None

    def _tool_calls_by_message(
        self, db: Session, message_ids: list[UUID]
    ) -> dict[UUID, list[RunToolCallModel]]:
        if not message_ids:
            return {}
        rows = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.message_id.in_(message_ids))
            .order_by(RunToolCallModel.call_seq.asc(), RunToolCallModel.created_at.asc())
            .all()
        )
        out: dict[UUID, list[RunToolCallModel]] = {}
        for row in rows:
            out.setdefault(row.message_id, []).append(row)
        return out

    def _rows_to_history(
        self,
        rows: list[RunMessageModel],
        language: str,
        tool_by_message: dict[UUID, list[RunToolCallModel]],
    ) -> list[HistoryMessage]:
        history: list[HistoryMessage] = []
        for msg in rows:
            entry = self.extract_lang_entry(msg, language)
            content_parts = self.extract_content_parts(entry)
            thinking_details = self.extract_thinking_details(entry)
            tool_calls = [
                HistoryToolCall(
                    id=tc.llm_call_id,
                    tool_name=tc.tool_name,
                    arguments=tc.arguments if isinstance(tc.arguments, dict) else {},
                    status=tc.status,
                    reason=tc.reason,
                    result=tc.result if isinstance(tc.result, dict) else None,
                )
                for tc in tool_by_message.get(msg.id, [])
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
        return history

    # ── Serialization ──

    @staticmethod
    def _serialize(messages: list[HistoryMessage]) -> list[dict[str, Any]]:
        return [
            {
                "id": str(m.id),
                "role": m.role,
                "content_parts": m.content_parts,
                "thinking_details": m.thinking_details,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "tool_name": tc.tool_name,
                        "arguments": tc.arguments,
                        "status": tc.status,
                        "reason": tc.reason,
                        "result": tc.result,
                    }
                    for tc in m.tool_calls
                ],
            }
            for m in messages
        ]

    @staticmethod
    def _deserialize(data: list[dict[str, Any]]) -> list[HistoryMessage]:
        out: list[HistoryMessage] = []
        for item in data:
            tool_calls = [
                HistoryToolCall(
                    id=tc["id"],
                    tool_name=tc["tool_name"],
                    arguments=tc.get("arguments") or {},
                    status=tc["status"],
                    reason=tc.get("reason"),
                    result=tc.get("result"),
                )
                for tc in (item.get("tool_calls") or [])
            ]
            out.append(
                HistoryMessage(
                    id=UUID(item["id"]),
                    role=item["role"],
                    content_parts=item.get("content_parts") or [],
                    thinking_details=item.get("thinking_details") or [],
                    tool_calls=tool_calls,
                )
            )
        return out

    # ── Core API ──

    def capture(
        self, db: Session, thread: Thread, run: RunModel, language: str
    ) -> CapturedHistory:
        """Build history from previous runs, cache on thread."""
        rows = (
            db.query(RunMessageModel)
            .filter(
                RunMessageModel.thread_id == thread.id,
                RunMessageModel.run_id != run.id,
            )
            .order_by(
                RunMessageModel.seq_in_thread.asc().nullslast(),
                RunMessageModel.created_at.asc(),
                RunMessageModel.seq.asc(),
            )
            .all()
        )

        message_ids = [r.id for r in rows]
        tool_by_message = self._tool_calls_by_message(db, message_ids)
        messages = self._rows_to_history(rows, language, tool_by_message)
        latest_history_run = self._latest_history_run(db, thread.id, run.id)

        thread.captured_history_system_prompt = ""
        thread.captured_history_conversation_json = self._serialize(messages)
        thread.captured_history_prefill = ""
        thread.captured_from_run_id = latest_history_run.id if latest_history_run is not None else None
        db.flush()

        return CapturedHistory(system_prompt="", conversation=messages, prefill="")

    def load(self, thread: Thread) -> CapturedHistory | None:
        """Load cached history from thread. Returns None if no cache exists."""
        data = thread.captured_history_conversation_json
        if not isinstance(data, list):
            return None
        system_prompt = thread.captured_history_system_prompt or ""
        prefill = thread.captured_history_prefill or ""
        return CapturedHistory(
            system_prompt=system_prompt,
            conversation=self._deserialize(data),
            prefill=prefill,
        )

    def resolve(
        self, db: Session, thread: Thread, run: RunModel, language: str
    ) -> CapturedHistory:
        """Capture/reuse policy:
        - Compare latest previous run id with captured_from_run_id.
        - If equal and latest role is assistant, reuse.
        - Otherwise capture fresh.
        """
        latest_history_run = self._latest_history_run(db, thread.id, run.id)
        latest_history_run_id = latest_history_run.id if latest_history_run is not None else None

        if thread.captured_from_run_id == latest_history_run_id:
            if latest_history_run_id is None:
                cached = self.load(thread)
                if cached is not None:
                    return cached
            else:
                last_role = self._last_role_for_run(db, latest_history_run_id)
                if last_role == "assistant":
                    cached = self.load(thread)
                    if cached is not None:
                        return cached
        return self.capture(db, thread, run, language)

    def build_current_run_messages(
        self, db: Session, run: RunModel, language: str
    ) -> list[HistoryMessage]:
        """Build HistoryMessage list from the current run's messages only."""
        rows = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.run_id == run.id)
            .order_by(RunMessageModel.seq.asc(), RunMessageModel.created_at.asc())
            .all()
        )
        message_ids = [r.id for r in rows]
        tool_by_message = self._tool_calls_by_message(db, message_ids)
        return self._rows_to_history(rows, language, tool_by_message)


history_service = HistoryService()
