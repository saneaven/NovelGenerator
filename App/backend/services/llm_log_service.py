"""Service for persisting LLM request/response logs.

All mutation helpers (create / reset / complete / fail) use their own
short-lived DB session so that log rows survive pipeline rollbacks.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import short_session
from ..models.db_models import LLMLog

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Measurement helper (mirrors storage_usage_service._measure_value)
# ---------------------------------------------------------------------------

def _measure_log_row(row: LLMLog) -> int:
    """Return approximate byte size of a single LLMLog row for storage tracking."""
    import json

    total = 0
    for value in (row.raw_input, row.raw_output, row.meta):
        if value is not None:
            total += len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    if row.error:
        total += len(row.error.encode("utf-8"))
    if row.provider:
        total += len(row.provider.encode("utf-8"))
    if row.model:
        total += len(row.model.encode("utf-8"))
    return total


def _apply_log_storage_delta(s: Session, *, user_id: UUID, project_id: UUID, delta_bytes: int) -> None:
    """Apply a storage delta for llm_log_bytes within the given session."""
    if delta_bytes == 0:
        return
    from .storage_usage_service import apply_project_usage_delta, StorageUsageDelta

    apply_project_usage_delta(
        s,
        user_id=user_id,
        project_id=project_id,
        delta=StorageUsageDelta(llm_log_bytes=delta_bytes),
        enforce_quota=False,
    )


class LLMLogService:
    # ------------------------------------------------------------------
    # Mutation helpers — each uses short_session() for isolation
    # ------------------------------------------------------------------

    def create_log(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        provider: str,
        model: str,
        raw_input: dict[str, Any],
    ) -> UUID:
        """Create a pending log row.  Returns the row id."""
        with short_session() as s:
            row = LLMLog(
                user_id=user_id,
                project_id=project_id,
                provider=provider,
                model=model,
                raw_input=raw_input,
                status="pending",
                created_at=datetime.utcnow(),
            )
            s.add(row)
            s.flush()
            row_id = row.id
            row_bytes = _measure_log_row(row)
            _apply_log_storage_delta(s, user_id=user_id, project_id=project_id, delta_bytes=row_bytes)
            s.commit()
            return row_id

    def reset_log(self, log_id: UUID, *, raw_input: dict[str, Any]) -> None:
        """On retry: overwrite raw_input and reset created_at on the existing pending row."""
        with short_session() as s:
            row = s.query(LLMLog).filter(LLMLog.id == log_id).first()
            if row is None:
                return
            old_bytes = _measure_log_row(row)
            row.raw_input = raw_input
            row.created_at = datetime.utcnow()
            row.raw_output = None
            row.error = None
            row.completed_at = None
            row.meta = None
            s.flush()
            new_bytes = _measure_log_row(row)
            _apply_log_storage_delta(s, user_id=row.user_id, project_id=row.project_id, delta_bytes=new_bytes - old_bytes)
            s.commit()

    def complete_log(
        self,
        log_id: UUID,
        *,
        raw_output: dict[str, Any] | None,
        meta: dict[str, Any] | None,
    ) -> None:
        """Mark log as done with full response."""
        with short_session() as s:
            row = s.query(LLMLog).filter(LLMLog.id == log_id).first()
            if row is None:
                return
            old_bytes = _measure_log_row(row)
            row.status = "done"
            row.raw_output = raw_output
            row.completed_at = datetime.utcnow()
            row.meta = meta
            s.flush()
            new_bytes = _measure_log_row(row)
            _apply_log_storage_delta(s, user_id=row.user_id, project_id=row.project_id, delta_bytes=new_bytes - old_bytes)
            s.commit()

    def fail_log(
        self,
        log_id: UUID,
        *,
        raw_output: dict[str, Any] | None,
        error: str,
        meta: dict[str, Any] | None,
    ) -> None:
        """Mark log as error with partial output."""
        with short_session() as s:
            row = s.query(LLMLog).filter(LLMLog.id == log_id).first()
            if row is None:
                return
            old_bytes = _measure_log_row(row)
            row.status = "error"
            row.raw_output = raw_output
            row.error = error
            row.completed_at = datetime.utcnow()
            row.meta = meta
            s.flush()
            new_bytes = _measure_log_row(row)
            _apply_log_storage_delta(s, user_id=row.user_id, project_id=row.project_id, delta_bytes=new_bytes - old_bytes)
            s.commit()

    # ------------------------------------------------------------------
    # Read / delete helpers — use caller's session
    # ------------------------------------------------------------------

    def list_logs(
        self,
        db: Session,
        *,
        user_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[LLMLog], int]:
        """Return recent logs (summary query) and total count."""
        base = db.query(LLMLog).filter(LLMLog.user_id == user_id)
        total = base.count()
        rows = (
            base.order_by(LLMLog.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return rows, total

    def get_log(self, db: Session, *, user_id: UUID, log_id: UUID) -> LLMLog | None:
        return (
            db.query(LLMLog)
            .filter(LLMLog.id == log_id, LLMLog.user_id == user_id)
            .first()
        )

    def delete_logs(self, db: Session, *, user_id: UUID) -> int:
        """Delete all logs for a user and apply negative storage delta."""
        rows = db.query(LLMLog).filter(LLMLog.user_id == user_id).all()
        if not rows:
            return 0

        # Group bytes by project for delta application
        project_bytes: dict[UUID, int] = {}
        for row in rows:
            project_bytes.setdefault(row.project_id, 0)
            project_bytes[row.project_id] += _measure_log_row(row)

        count = db.query(LLMLog).filter(LLMLog.user_id == user_id).delete()

        from .storage_usage_service import apply_project_usage_delta, StorageUsageDelta
        for pid, total_bytes in project_bytes.items():
            if total_bytes > 0:
                apply_project_usage_delta(
                    db,
                    user_id=user_id,
                    project_id=pid,
                    delta=StorageUsageDelta(llm_log_bytes=-total_bytes),
                    enforce_quota=False,
                )

        db.commit()
        return count


llm_log_service = LLMLogService()
