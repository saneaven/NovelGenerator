from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.orm import Session

from .patch_utils import apply_single_replacement
from .tool_engine.modules.object_access import extract_lang_data, read_object

if TYPE_CHECKING:
    from .object_service import ObjectService


@dataclass
class ObjectPatchState:
    object_type: str
    object_id: UUID
    project_id: UUID
    language: str
    create_new_version: bool
    user_id: UUID | None
    data: dict[str, Any]
    metadata: dict[str, Any] | None = None
    touched_call_ids: set[str] = field(default_factory=set)


@dataclass
class FlushStatus:
    success: bool
    reason: str | None = None


class ObjectPatchBatch:
    """Batches patch operations for project objects and outlines.

    Caches object data in memory so N patches on the same object
    result in 1 DB read + N in-memory replacements + 1 DB write
    instead of N × (read + write).
    """

    def __init__(self) -> None:
        self._states: dict[str, ObjectPatchState] = {}

    @property
    def has_pending(self) -> bool:
        return bool(self._states)

    @staticmethod
    def make_key(object_type: str, object_id: UUID, language: str) -> str:
        return f"{object_type}:{object_id}:{language}"

    def _get_or_load(
        self,
        *,
        db: Session,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        language: str,
        create_new_version: bool,
        user_id: UUID | None,
    ) -> ObjectPatchState:
        key = self.make_key(object_type, object_id, language)
        if key not in self._states:
            obj = read_object(
                db,
                project_id=project_id,
                object_type=object_type,
                object_id=object_id,
                language=language,
                rich_text_format="markdown",
            )
            lang_data = extract_lang_data(obj, language)
            self._states[key] = ObjectPatchState(
                object_type=object_type,
                object_id=object_id,
                project_id=project_id,
                language=language,
                create_new_version=create_new_version,
                user_id=user_id,
                data=dict(lang_data),
            )
        return self._states[key]

    def apply_patch(
        self,
        *,
        db: Session,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        language: str,
        field: str,
        old_text: str,
        new_text: str,
        call_id: str,
        create_new_version: bool,
        user_id: UUID | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = self._get_or_load(
            db=db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            language=language,
            create_new_version=create_new_version,
            user_id=user_id,
        )
        if metadata:
            state.metadata = {**(state.metadata or {}), **metadata}

        current_value = str(state.data.get(field) or "")
        result = apply_single_replacement(current_value, old_text, new_text)
        if not result.success:
            return {"success": False, "reason": result.reason or result.code or "Patch failed"}

        state.data[field] = result.content
        state.touched_call_ids.add(call_id)
        return {"success": True}

    def apply_replace(
        self,
        *,
        db: Session,
        project_id: UUID,
        object_type: str,
        object_id: UUID,
        language: str,
        fields: dict[str, Any],
        call_id: str,
        create_new_version: bool,
        user_id: UUID | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = self._get_or_load(
            db=db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            language=language,
            create_new_version=create_new_version,
            user_id=user_id,
        )
        if metadata:
            state.metadata = {**(state.metadata or {}), **metadata}

        for k, v in fields.items():
            state.data[k] = v
        state.touched_call_ids.add(call_id)
        return {"success": True}

    def flush_all(
        self,
        *,
        db: Session,
        object_service: "ObjectService",
        created_by: UUID | None,
    ) -> tuple[dict[str, FlushStatus], dict[str, set[str]]]:
        results: dict[str, FlushStatus] = {}
        key_to_call_ids: dict[str, set[str]] = {}

        for key, state in list(self._states.items()):
            key_to_call_ids[key] = set(state.touched_call_ids)
            try:
                with db.begin_nested():
                    object_service.update_object(
                        db,
                        project_id=state.project_id,
                        object_type=state.object_type,
                    object_id=state.object_id,
                    data=state.data,
                    language=state.language,
                    rich_text_format="markdown",
                    metadata=state.metadata,
                    user_request="tool:patch_batch",
                        created_by=created_by,
                        create_new_version=state.create_new_version,
                    )
                results[key] = FlushStatus(success=True)
            except Exception as exc:  # noqa: BLE001
                results[key] = FlushStatus(success=False, reason=str(exc))

        self._states.clear()
        return results, key_to_call_ids
