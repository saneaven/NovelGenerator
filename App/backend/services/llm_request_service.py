"""Service for persisting LLM request tracking rows.

Mutation helpers use short-lived DB sessions so request rows survive
pipeline rollbacks.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..database import short_session
from ..models.db_models import LLMRequest


def _measure_request_row(row: LLMRequest | object) -> int:
    """Return payload bytes counted against llm_log_bytes storage."""
    total = 0
    for value in (getattr(row, "raw_input", None), getattr(row, "raw_output", None)):
        if value is not None:
            total += len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return total


def _apply_request_storage_delta(s: Session, *, user_id: UUID, project_id: UUID, delta_bytes: int) -> None:
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


def _copy_meta(meta: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(meta, dict):
        return {}
    return dict(meta)


def _merge_meta(existing: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any] | None:
    merged = _copy_meta(existing)
    if isinstance(update, dict):
        merged.update(update)
    return merged or None


class LLMRequestService:
    def create_request(
        self,
        *,
        request_id: str,
        user_id: UUID,
        project_id: UUID,
        thread_id: UUID,
        run_id: UUID,
        assistant_message_id: UUID,
        provider: str,
        model: str,
    ) -> None:
        with short_session() as s:
            row = LLMRequest(
                request_id=request_id,
                user_id=user_id,
                project_id=project_id,
                thread_id=thread_id,
                run_id=run_id,
                assistant_message_id=assistant_message_id,
                provider=provider,
                model=model,
                status="running",
                retry_count=0,
                created_at=datetime.utcnow(),
            )
            s.add(row)
            s.commit()

    def update_request(
        self,
        request_id: str,
        *,
        raw_input: dict[str, Any] | None = None,
    ) -> None:
        with short_session() as s:
            row = s.query(LLMRequest).filter(LLMRequest.request_id == request_id).first()
            if row is None:
                return
            old_bytes = _measure_request_row(row)
            if raw_input is not None:
                row.raw_input = raw_input
            row.error = None
            row.completed_at = None
            row.status = "running"
            s.flush()
            new_bytes = _measure_request_row(row)
            _apply_request_storage_delta(s, user_id=row.user_id, project_id=row.project_id, delta_bytes=new_bytes - old_bytes)
            s.commit()

    def on_retry(self, request_id: str, *, error_msg: str, error_status: int | None) -> None:
        with short_session() as s:
            row = s.query(LLMRequest).filter(LLMRequest.request_id == request_id).first()
            if row is None:
                return
            meta = _copy_meta(row.meta)
            retry_errors = meta.get("retry_errors")
            if not isinstance(retry_errors, list):
                retry_errors = []
            retry_errors.append(
                {
                    "message": error_msg,
                    "status": error_status,
                    "attempt": int(row.retry_count) + 1,
                    "ts": datetime.utcnow().isoformat(),
                }
            )
            meta["retry_errors"] = retry_errors
            row.retry_count = int(row.retry_count or 0) + 1
            row.meta = meta
            s.commit()

    def complete(
        self,
        request_id: str,
        *,
        raw_output: dict[str, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        with short_session() as s:
            row = s.query(LLMRequest).filter(LLMRequest.request_id == request_id).first()
            if row is None:
                return
            old_bytes = _measure_request_row(row)
            row.status = "done"
            if raw_output is not None:
                row.raw_output = raw_output
            row.meta = _merge_meta(row.meta, meta)
            row.completed_at = datetime.utcnow()
            s.flush()
            new_bytes = _measure_request_row(row)
            _apply_request_storage_delta(s, user_id=row.user_id, project_id=row.project_id, delta_bytes=new_bytes - old_bytes)
            s.commit()

    def fail(
        self,
        request_id: str,
        *,
        raw_output: dict[str, Any] | None = None,
        error: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        with short_session() as s:
            row = s.query(LLMRequest).filter(LLMRequest.request_id == request_id).first()
            if row is None:
                return
            old_bytes = _measure_request_row(row)
            row.status = "error"
            if raw_output is not None:
                row.raw_output = raw_output
            row.error = error
            row.meta = _merge_meta(row.meta, meta)
            row.completed_at = datetime.utcnow()
            s.flush()
            new_bytes = _measure_request_row(row)
            _apply_request_storage_delta(s, user_id=row.user_id, project_id=row.project_id, delta_bytes=new_bytes - old_bytes)
            s.commit()

    def list_requests(
        self,
        db: Session,
        *,
        user_id: UUID,
        limit: int = 50,
        offset: int = 0,
        project_id: UUID | None = None,
        thread_id: UUID | None = None,
    ) -> tuple[list[LLMRequest], int]:
        base = db.query(LLMRequest).filter(LLMRequest.user_id == user_id)
        if project_id is not None:
            base = base.filter(LLMRequest.project_id == project_id)
        if thread_id is not None:
            base = base.filter(LLMRequest.thread_id == thread_id)
        total = base.count()
        rows = (
            base.order_by(LLMRequest.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return rows, total

    def get_request(self, db: Session, *, user_id: UUID, request_id: str) -> LLMRequest | None:
        return (
            db.query(LLMRequest)
            .filter(LLMRequest.user_id == user_id, LLMRequest.request_id == request_id)
            .first()
        )

    def delete_requests(self, db: Session, *, user_id: UUID) -> int:
        rows = db.query(LLMRequest).filter(LLMRequest.user_id == user_id).all()
        if not rows:
            return 0

        project_bytes: dict[UUID, int] = {}
        for row in rows:
            project_bytes.setdefault(row.project_id, 0)
            project_bytes[row.project_id] += _measure_request_row(row)

        count = db.query(LLMRequest).filter(LLMRequest.user_id == user_id).delete()

        from .storage_usage_service import apply_project_usage_delta, StorageUsageDelta
        for pid, total_bytes in project_bytes.items():
            if total_bytes <= 0:
                continue
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=pid,
                delta=StorageUsageDelta(llm_log_bytes=-total_bytes),
                enforce_quota=False,
            )

        db.commit()
        return count


llm_request_service = LLMRequestService()
