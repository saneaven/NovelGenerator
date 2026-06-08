from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import event
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..utils.story_entities import STORY_ENTITY_FOLDER_TYPE
from .semantic_index_service import index_object, invalidate_object_index


_PENDING_SEMANTIC_OPS_KEY = "_pending_semantic_ops"
_SEMANTIC_EXCLUDED_TYPES = {"basic_info", "guidelines", STORY_ENTITY_FOLDER_TYPE}
_SEMANTIC_SEMAPHORE = asyncio.Semaphore(3)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PendingSemanticOp:
    user_id: UUID
    project_id: UUID
    object_type: str
    object_id: UUID


def queue_semantic_index(
    db: Session,
    *,
    user_id: UUID | None,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> None:
    if user_id is None:
        return
    if object_type in _SEMANTIC_EXCLUDED_TYPES:
        return
    pending = db.info.setdefault(_PENDING_SEMANTIC_OPS_KEY, [])
    op = _PendingSemanticOp(
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )
    if op not in pending:
        pending.append(op)


def invalidate_semantic_index(
    db: Session,
    *,
    user_id: UUID | None,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
) -> None:
    if user_id is None:
        return
    if object_type in _SEMANTIC_EXCLUDED_TYPES:
        return
    invalidate_object_index(
        db,
        user_id=user_id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
    )


async def _process_pending_semantic_op(op: _PendingSemanticOp) -> None:
    async with _SEMANTIC_SEMAPHORE:
        await _process_pending_semantic_op_inner(op)


async def _process_pending_semantic_op_inner(op: _PendingSemanticOp) -> None:
    from .credential_service import CredentialServiceError, credential_service
    from .settings_service import settings_service

    db = SessionLocal()
    try:
        if not settings_service.is_vector_storage_enabled(db, op.user_id):
            return

        embedding_cfg = settings_service.get_search_embedding_config(db, op.user_id)
        if not embedding_cfg.provider or not embedding_cfg.model:
            return

        try:
            provider_config = credential_service.get_provider_config(db, op.user_id, embedding_cfg.provider)
        except CredentialServiceError:
            return

        await index_object(
            db,
            user_id=op.user_id,
            project_id=op.project_id,
            object_type=op.object_type,
            object_id=op.object_id,
            provider_config=provider_config,
            force=False,
        )
    except Exception:
        logger.exception(
            "Semantic indexing hook failed for %s/%s",
            op.object_type,
            op.object_id,
        )
    finally:
        db.close()


@event.listens_for(Session, "after_commit")
def _dispatch_pending_semantic_ops(session: Session) -> None:
    pending = session.info.pop(_PENDING_SEMANTIC_OPS_KEY, None)
    if not pending:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Skipping queued semantic indexing hooks: no running event loop")
        return

    unique_ops = list(dict.fromkeys(pending))
    for op in unique_ops:
        loop.create_task(_process_pending_semantic_op(op))


@event.listens_for(Session, "after_rollback")
def _clear_pending_semantic_ops(session: Session) -> None:
    session.info.pop(_PENDING_SEMANTIC_OPS_KEY, None)


__all__ = ["queue_semantic_index", "invalidate_semantic_index"]
