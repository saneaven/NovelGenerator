from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .object_service import ObjectService
from .object_version_language_service import latest_payload_with_fallback
from .patch_utils import apply_single_replacement
from .rich_text import tree_to_markdown


@dataclass
class BatchState:
    manuscript_id: UUID
    project_id: UUID
    language: str
    create_new_version: bool
    user_request: str
    markdown: str
    touched_call_ids: set[str] = field(default_factory=set)


@dataclass
class FlushStatus:
    success: bool
    reason: str | None = None


class ManuscriptBatch:
    """Batches patch/replace operations for manuscript updates."""

    def __init__(self) -> None:
        self._states: dict[str, BatchState] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    @property
    def has_pending(self) -> bool:
        return bool(self._states)

    @staticmethod
    def make_key(manuscript_id: UUID, language: str, create_new_version: bool) -> str:
        return f"{manuscript_id}:{language}:{'new' if create_new_version else 'in_place'}"

    def lock_for(self, key: str) -> asyncio.Lock:
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    async def get_or_load_markdown(
        self,
        *,
        db: Session,
        manuscript_id: UUID,
        project_id: UUID,
        language: str,
        create_new_version: bool,
        user_request: str,
    ) -> tuple[str, str]:
        key = self.make_key(manuscript_id, language, create_new_version)
        existing = self._states.get(key)
        if existing is not None:
            return key, existing.markdown

        current = latest_payload_with_fallback(
            db,
            "manuscript",
            manuscript_id,
            language,
            for_update=True,
        )
        if current is None:
            raise ValueError("MANUSCRIPT_EMPTY")

        _latest, lang_row = current
        lang_data = lang_row.data if lang_row is not None and isinstance(lang_row.data, dict) else None
        if not isinstance(lang_data, dict):
            raise ValueError("MANUSCRIPT_EMPTY")

        content = lang_data.get("content")
        if not isinstance(content, dict):
            raise ValueError("MANUSCRIPT_EMPTY")

        markdown = tree_to_markdown(content)
        self._states[key] = BatchState(
            manuscript_id=manuscript_id,
            project_id=project_id,
            language=language,
            create_new_version=create_new_version,
            user_request=user_request,
            markdown=markdown,
        )
        return key, markdown

    async def apply_patch(
        self,
        *,
        db: Session,
        manuscript_id: UUID,
        project_id: UUID,
        language: str,
        old_text: str,
        new_text: str,
        call_id: str,
        create_new_version: bool,
        user_request: str,
    ) -> dict[str, Any]:
        key = self.make_key(manuscript_id, language, create_new_version)
        lock = self.lock_for(key)
        async with lock:
            try:
                key, markdown = await self.get_or_load_markdown(
                    db=db,
                    manuscript_id=manuscript_id,
                    project_id=project_id,
                    language=language,
                    create_new_version=create_new_version,
                    user_request=user_request,
                )
            except ValueError as exc:
                return {"success": False, "code": str(exc), "reason": str(exc)}

            rr = apply_single_replacement(markdown, old_text, new_text)
            if not rr.success:
                return {"success": False, "code": rr.code, "reason": rr.reason}

            state = self._states[key]
            state.markdown = rr.content
            state.touched_call_ids.add(call_id)
            return {"success": True, "buffered": True, "key": key, "replace_count": 1}

    async def apply_replace(
        self,
        *,
        manuscript_id: UUID,
        project_id: UUID,
        language: str,
        content: str,
        call_id: str,
        create_new_version: bool,
        user_request: str,
    ) -> dict[str, Any]:
        key = self.make_key(manuscript_id, language, create_new_version)
        lock = self.lock_for(key)
        async with lock:
            state = self._states.get(key)
            if state is None:
                state = BatchState(
                    manuscript_id=manuscript_id,
                    project_id=project_id,
                    language=language,
                    create_new_version=create_new_version,
                    user_request=user_request,
                    markdown=content,
                )
                self._states[key] = state
            else:
                state.markdown = content
            state.touched_call_ids.add(call_id)
            return {"success": True, "buffered": True, "key": key}

    async def flush_all(
        self,
        *,
        db: Session,
        object_service: ObjectService,
        created_by: UUID | None,
    ) -> tuple[dict[str, FlushStatus], dict[str, set[str]]]:
        results: dict[str, FlushStatus] = {}
        key_to_call_ids: dict[str, set[str]] = {}

        for key, state in list(self._states.items()):
            key_to_call_ids[key] = set(state.touched_call_ids)
            try:
                object_service.update_object(
                    db=db,
                    project_id=state.project_id,
                    object_type="manuscript",
                    object_id=state.manuscript_id,
                    data={"content": state.markdown},
                    language=state.language,
                    rich_text_format="markdown",
                    metadata=None,
                    user_request=state.user_request,
                    create_new_version=state.create_new_version,
                    created_by=created_by,
                )
                results[key] = FlushStatus(success=True)
            except Exception as exc:
                results[key] = FlushStatus(success=False, reason=str(exc))

        self._states.clear()
        return results, key_to_call_ids
