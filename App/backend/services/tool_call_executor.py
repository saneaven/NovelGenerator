"""Parallel tool-call execution with same-object patch grouping."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import RunMessageModel, RunModel, RunToolCallModel, SubAgentDefinitionModel, Thread
from .credential_service import credential_service
from .deletion_service import (
    collect_act_subtree_object_ids,
    collect_chapter_subtree_object_ids,
    collect_outline_subtree_object_ids,
)
from .manuscript_batch import ManuscriptBatch
from .object_service import object_service
from .patch_utils import apply_single_replacement
from .rag_search_service import build_search_payload, keyword_search_project, search_project
from .settings_service import settings_service
from .sidecar_client import SidecarClient, SidecarConversionError, SidecarUnavailableError
from .tool_schemas import ToolSchemaDef
from .validators import GLOBAL_VALIDATORS, TOOL_VALIDATORS, ValidationContext, run_validator_chain


ToolDecision = Literal["accept", "reject", "cancel"]


@dataclass
class RawToolCall:
    llm_call_id: str
    tool_name: str
    arguments: str | dict[str, Any]


@dataclass
class StagedToolCall:
    llm_call_id: str
    call_seq: int
    tool_name: str
    arguments: dict[str, Any]
    status: Literal["pending", "failed"]
    reason: str | None = None


@dataclass
class HandlerOptions:
    create_new_version: bool = True
    user_request: str = "AI Edit"


@dataclass
class StagedUpdate:
    key: str
    object_type: str
    object_id: UUID
    language: str
    create_new_version: bool
    data: dict[str, Any]
    metadata: dict[str, Any] | None
    user_request: str
    call_ids: set[str] = field(default_factory=set)


@dataclass
class DispatchResult:
    status: Literal["accepted", "running", "failed"]
    result: dict[str, Any] | None = None
    reason: str | None = None
    child_run_id: UUID | None = None
    child_thread_id: UUID | None = None


@dataclass
class ApplyResult:
    rows: list[RunToolCallModel]
    affected_objects: list[dict[str, Any]] = field(default_factory=list)
    deleted_ids: list[dict[str, str]] = field(default_factory=list)


# ── Patch-grouping helpers ──

_PATCHABLE_TOOLS = frozenset({
    "replace_basic_info", "patch_basic_info",
    "replace_guidelines", "patch_guidelines",
    "replace_story_object", "patch_story_object",
    "replace_outline", "patch_outline",
    "replace_outline_act", "patch_outline_act",
    "replace_outline_chapter", "patch_outline_chapter",
})


def _patch_target_key(row: RunToolCallModel) -> str:
    """Return a grouping key for patchable tool calls on the same object."""
    args = row.arguments if isinstance(row.arguments, dict) else {}
    tool = row.tool_name

    if tool in {"replace_basic_info", "patch_basic_info"}:
        return "basic_info:__singleton__"
    if tool in {"replace_guidelines", "patch_guidelines"}:
        oid = args.get("id", "__singleton__")
        return f"guidelines:{oid}"

    oid = args.get("id", "__unknown__")
    if tool in {"replace_story_object", "patch_story_object"}:
        otype = args.get("type", "story")
        return f"{otype}:{oid}"
    if tool in {"replace_outline", "patch_outline"}:
        return f"outline:{oid}"
    if tool in {"replace_outline_act", "patch_outline_act"}:
        return f"act:{oid}"
    if tool in {"replace_outline_chapter", "patch_outline_chapter"}:
        return f"chapter:{oid}"

    return f"unknown:{oid}"


class ToolCallExecutor:
    RESULT_MAX_BYTES = 64 * 1024

    def __init__(self, sidecar: SidecarClient) -> None:
        self._sidecar = sidecar
        self._manuscript_batch = ManuscriptBatch()

    # ── Utility methods ──

    @staticmethod
    def _truncate_json_value(value: Any) -> Any:
        try:
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except Exception:
            return {"truncated": True, "value": str(value)[:4000]}
        if len(encoded) <= ToolCallExecutor.RESULT_MAX_BYTES:
            return value
        clipped = encoded[: ToolCallExecutor.RESULT_MAX_BYTES].decode("utf-8", errors="ignore")
        return {"truncated": True, "raw": clipped}

    @staticmethod
    def _safe_parse_arguments(arguments: str | dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        if isinstance(arguments, dict):
            return arguments, None
        if isinstance(arguments, str):
            try:
                parsed = json.loads(arguments)
            except Exception as exc:
                return None, str(exc)
            if not isinstance(parsed, dict):
                return None, "JSON arguments must be an object"
            return parsed, None
        return None, "Invalid tool arguments payload"

    @staticmethod
    def _current_data_for_language(obj: dict[str, Any], language: str) -> dict[str, Any]:
        data = obj.get("data") if isinstance(obj, dict) else None
        if not isinstance(data, dict):
            return {}
        lang_data = data.get(language)
        if isinstance(lang_data, dict):
            return dict(lang_data)
        for v in data.values():
            if isinstance(v, dict):
                return dict(v)
        return {}

    @staticmethod
    def _normalize_story_object_type(raw: str) -> str | None:
        if raw in {"character", "location", "organization", "lorebook"}:
            return raw
        return None

    @staticmethod
    def _object_type_for_story_or_outline(tool_name: str, args: dict[str, Any]) -> str | None:
        if tool_name in {"replace_story_object", "patch_story_object", "read_story_object", "delete_story_object"}:
            raw = args.get("type")
            if isinstance(raw, str):
                return raw
            return None
        if tool_name in {"replace_outline", "patch_outline", "delete_outline", "read_outline"}:
            if tool_name == "read_outline":
                raw = args.get("type")
                return raw if isinstance(raw, str) else None
            return "outline"
        if tool_name in {"replace_outline_act", "patch_outline_act", "delete_outline_act", "create_outline_act"}:
            return "act"
        if tool_name in {"replace_outline_chapter", "patch_outline_chapter", "delete_outline_chapter", "create_outline_chapter"}:
            return "chapter"
        if tool_name in {"replace_manuscript", "patch_manuscript", "read_manuscript"}:
            return "manuscript"
        if "basic_info" in tool_name:
            return "basic_info"
        if "guidelines" in tool_name:
            return "guidelines"
        return None

    @staticmethod
    def _resolve_tool_object_key(
        tool_name: str, args: dict[str, Any], result_data: dict[str, Any],
    ) -> tuple[str | None, str | None]:
        """Extract (object_type, object_id) from a tool call for affected-object tracking."""
        # Object ID: creates store ID in result.data.id, everything else in args.id
        oid: str | None = None
        if tool_name.startswith("create_"):
            oid = result_data.get("id")
            if not isinstance(oid, str):
                oid = None
        else:
            raw_id = args.get("id")
            oid = str(raw_id) if isinstance(raw_id, str) else None

        # Object type resolution
        if "basic_info" in tool_name:
            return "basic_info", oid
        if "guidelines" in tool_name:
            return "guidelines", oid
        if "story_object" in tool_name:
            raw = args.get("type")
            return (raw if isinstance(raw, str) else None), oid
        if "manuscript" in tool_name:
            return "manuscript", oid
        if "outline_act" in tool_name:
            return "act", oid
        if "outline_chapter" in tool_name:
            return "chapter", oid
        if "outline" in tool_name:
            return "outline", oid
        return None, None

    def _get_cached_or_fetch_object(
        self,
        *,
        db: Session,
        run: RunModel,
        object_type: str,
        object_id: UUID,
        cache: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        cache_key = f"{object_type}:{object_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
        obj = object_service.get_object(db, object_type, object_id, project_id=run.project_id)
        if obj is None:
            raise ValueError(f"{object_type} {object_id} not found")
        cache[cache_key] = obj
        return obj

    def _stage_update(
        self,
        *,
        staged_updates: dict[str, StagedUpdate],
        cache: dict[str, dict[str, Any]],
        object_type: str,
        object_id: UUID,
        language: str,
        create_new_version: bool,
        data: dict[str, Any],
        metadata: dict[str, Any] | None,
        user_request: str,
        call_id: str,
    ) -> None:
        key = f"{object_type}:{object_id}:{language}:{'new' if create_new_version else 'in_place'}"
        existing = staged_updates.get(key)
        if existing is None:
            staged_updates[key] = StagedUpdate(
                key=key,
                object_type=object_type,
                object_id=object_id,
                language=language,
                create_new_version=create_new_version,
                data=dict(data),
                metadata=dict(metadata) if isinstance(metadata, dict) else None,
                user_request=user_request,
                call_ids={call_id},
            )
        else:
            existing.data = dict(data)
            if isinstance(metadata, dict):
                merged_meta = dict(existing.metadata or {})
                merged_meta.update(metadata)
                existing.metadata = merged_meta
            existing.user_request = user_request
            existing.call_ids.add(call_id)

        cache_key = f"{object_type}:{object_id}"
        obj = cache.get(cache_key)
        if obj is not None:
            object_data = obj.get("data") if isinstance(obj.get("data"), dict) else {}
            next_data = dict(object_data)
            next_data[language] = data
            obj["data"] = next_data
            if metadata:
                obj_meta = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
                obj_meta = dict(obj_meta)
                obj_meta.update(metadata)
                obj["metadata"] = obj_meta

    @staticmethod
    def _remove_staged_for_object(
        *,
        staged_updates: dict[str, StagedUpdate],
        object_type: str,
        object_id: UUID,
    ) -> None:
        prefix = f"{object_type}:{object_id}:"
        for key in [k for k in staged_updates.keys() if k.startswith(prefix)]:
            del staged_updates[key]

    def _flush_staged_updates(
        self,
        db: Session,
        run: RunModel,
        staged_updates: dict[str, StagedUpdate],
    ) -> set[str]:
        """Flush staged non-manuscript updates. Returns set of failed call_ids."""
        failed_call_ids: set[str] = set()
        for staged in staged_updates.values():
            try:
                object_service.update_object(
                    db=db,
                    project_id=run.project_id,
                    object_type=staged.object_type,
                    object_id=staged.object_id,
                    data=staged.data,
                    language=staged.language,
                    metadata=staged.metadata,
                    user_request=staged.user_request,
                    create_new_version=staged.create_new_version,
                    created_by=run.user_id,
                )
            except Exception:
                for call_id in staged.call_ids:
                    failed_call_ids.add(call_id)
        return failed_call_ids

    # ── Validation / staging ──

    async def stage_tool_calls(
        self,
        db: Session,
        run: RunModel,
        raw_tool_calls: list[RawToolCall],
        allowed_tool_names: list[str] | None,
        schema_by_name: dict[str, ToolSchemaDef],
        rag_search_enabled: bool,
    ) -> list[StagedToolCall]:
        staged: list[StagedToolCall] = []
        allowed = set(allowed_tool_names) if allowed_tool_names else None

        ctx = ValidationContext(
            db=db,
            run=run,
            allowed_tool_names=allowed,
            schema_by_name=schema_by_name,
            rag_search_enabled=rag_search_enabled,
            sidecar=self._sidecar,
        )

        for idx, raw in enumerate(raw_tool_calls, start=1):
            args, parse_err = self._safe_parse_arguments(raw.arguments)
            if args is None:
                staged.append(
                    StagedToolCall(
                        llm_call_id=raw.llm_call_id,
                        call_seq=idx,
                        tool_name=raw.tool_name,
                        arguments={},
                        status="failed",
                        reason=f"VALIDATION::parse_arguments::{parse_err}",
                    )
                )
                continue

            global_result = await run_validator_chain(GLOBAL_VALIDATORS, args, raw.tool_name, ctx)
            if not global_result.valid:
                staged.append(
                    StagedToolCall(
                        llm_call_id=raw.llm_call_id,
                        call_seq=idx,
                        tool_name=raw.tool_name,
                        arguments=args,
                        status="failed",
                        reason=f"VALIDATION::{global_result.validator or 'global'}::{global_result.reason}",
                    )
                )
                continue

            per_tool_validators = TOOL_VALIDATORS.get(raw.tool_name, [])
            per_result = await run_validator_chain(per_tool_validators, args, raw.tool_name, ctx)
            if not per_result.valid:
                staged.append(
                    StagedToolCall(
                        llm_call_id=raw.llm_call_id,
                        call_seq=idx,
                        tool_name=raw.tool_name,
                        arguments=args,
                        status="failed",
                        reason=f"VALIDATION::{per_result.validator or 'tool'}::{per_result.reason}",
                    )
                )
                continue

            staged.append(
                StagedToolCall(
                    llm_call_id=raw.llm_call_id,
                    call_seq=idx,
                    tool_name=raw.tool_name,
                    arguments=args,
                    status="pending",
                )
            )

        return staged

    # ── Main entry point ──

    async def apply_tool_calls(
        self,
        db: Session,
        run: RunModel,
        message_id: UUID,
        decisions: dict[str, ToolDecision],
        options: dict[str, Any] | None,
    ) -> ApplyResult:
        opts = HandlerOptions(
            create_new_version=bool((options or {}).get("create_new_version", True)),
            user_request=str((options or {}).get("user_request") or "AI Edit"),
        )

        rows = (
            db.query(RunToolCallModel)
            .filter(
                RunToolCallModel.run_id == run.id,
                RunToolCallModel.message_id == message_id,
            )
            .order_by(RunToolCallModel.call_seq.asc())
            .all()
        )

        # ── Decision phase ──
        to_dispatch: list[RunToolCallModel] = []
        for row in rows:
            if row.status not in {"pending"}:
                continue

            decision = decisions.get(row.llm_call_id, "reject")
            if decision == "cancel":
                row.status = "rejected"
                row.reason = row.reason or "User rejected"
                row.updated_at = datetime.utcnow()
                continue
            if decision != "accept":
                row.status = "rejected"
                row.reason = row.reason or "User rejected"
                row.updated_at = datetime.utcnow()
                continue
            to_dispatch.append(row)

        # ── Group patchable tools by target object ──
        patch_groups: dict[str, list[RunToolCallModel]] = {}
        independent: list[RunToolCallModel] = []
        for row in to_dispatch:
            if row.tool_name in _PATCHABLE_TOOLS:
                key = _patch_target_key(row)
                patch_groups.setdefault(key, []).append(row)
            else:
                independent.append(row)

        # Mark all dispatching rows as running
        for row in to_dispatch:
            row.status = "running"
            row.updated_at = datetime.utcnow()

        # ── Build parallel tasks ──
        async def dispatch_single(
            r: RunToolCallModel,
        ) -> list[tuple[RunToolCallModel, DispatchResult]]:
            local_cache: dict[str, dict[str, Any]] = {}
            local_staged: dict[str, StagedUpdate] = {}
            result = await self._dispatch_tool_call(
                db=db, run=run, row=r, options=opts,
                object_cache=local_cache, staged_updates=local_staged,
            )
            failed = self._flush_staged_updates(db, run, local_staged)
            if failed and r.llm_call_id in failed and result.status == "accepted":
                result = DispatchResult(
                    status="failed",
                    result={"success": False, "message": "flush failed"},
                    reason="EXECUTION::flush::update_failed",
                )
            return [(r, result)]

        async def dispatch_group(
            group: list[RunToolCallModel],
        ) -> list[tuple[RunToolCallModel, DispatchResult]]:
            return await self._dispatch_grouped_patches(db, run, group, opts)

        tasks: list[Any] = []
        for row in independent:
            tasks.append(dispatch_single(row))
        for group in patch_groups.values():
            tasks.append(dispatch_group(group))

        # ── Execute in parallel ──
        if tasks:
            gather_results = await asyncio.gather(*tasks, return_exceptions=True)
            for outcome in gather_results:
                if isinstance(outcome, BaseException):
                    continue
                for row, dispatch in outcome:
                    if dispatch.status == "accepted":
                        row.status = "accepted"
                        row.reason = None
                        row.accepted_at = datetime.utcnow()
                        row.result = self._truncate_json_value(dispatch.result or {"success": True})
                    elif dispatch.status == "running":
                        row.status = "running"
                        row.reason = dispatch.reason
                        row.result = self._truncate_json_value(dispatch.result or {"success": True})
                        if dispatch.child_run_id:
                            row.child_run_id = dispatch.child_run_id
                        if dispatch.child_thread_id:
                            row.child_thread_id = dispatch.child_thread_id
                    else:  # failed
                        row.status = "failed"
                        row.reason = dispatch.reason
                        row.result = self._truncate_json_value(dispatch.result or {"success": False})
                    row.updated_at = datetime.utcnow()

        # ── Flush manuscript batch ──
        flush_results, key_to_call_ids = await self._manuscript_batch.flush_all(
            db=db,
            sidecar=self._sidecar,
            object_service=object_service,
            created_by=run.user_id,
        )
        failed_call_ids: set[str] = set()
        for key, status in flush_results.items():
            if status.success:
                continue
            for call_id in key_to_call_ids.get(key, set()):
                failed_call_ids.add(call_id)
        if failed_call_ids:
            for row in rows:
                if row.status != "accepted" or row.llm_call_id not in failed_call_ids:
                    continue
                row.status = "failed"
                row.reason = "EXECUTION::flush::batched flush failed"
                row.result = self._truncate_json_value({"success": False, "message": row.reason})
                row.accepted_at = None
                row.updated_at = datetime.utcnow()

        db.flush()

        # ── Collect affected objects for frontend sync ──
        affected_objects: list[dict[str, Any]] = []
        deleted_ids: list[dict[str, str]] = []
        seen_keys: set[str] = set()

        for row in rows:
            if row.status != "accepted":
                continue
            args, _ = self._safe_parse_arguments(row.arguments)
            if args is None:
                continue
            result_data = (row.result or {}).get("data") or {}
            tool = row.tool_name

            # Deletes: gather cascade IDs from result
            if tool.startswith("delete_"):
                for d in result_data.get("deleted_ids", []):
                    deleted_ids.append(d)
                continue

            # Creates/updates: re-fetch full serialized object
            obj_type, obj_id = self._resolve_tool_object_key(tool, args, result_data)
            if not obj_type or not obj_id:
                continue
            key = f"{obj_type}:{obj_id}"
            if key in seen_keys:
                continue
            seen_keys.add(key)
            try:
                obj = object_service.get_object(db, obj_type, UUID(obj_id), project_id=run.project_id)
            except Exception:
                continue
            if obj:
                affected_objects.append(obj)

        return ApplyResult(rows=rows, affected_objects=affected_objects, deleted_ids=deleted_ids)

    # ── Grouped patch dispatch ──

    async def _dispatch_grouped_patches(
        self,
        db: Session,
        run: RunModel,
        rows: list[RunToolCallModel],
        options: HandlerOptions,
    ) -> list[tuple[RunToolCallModel, DispatchResult]]:
        """Process patches on the same object sequentially, flush once."""
        results: list[tuple[RunToolCallModel, DispatchResult]] = []
        shared_cache: dict[str, dict[str, Any]] = {}
        shared_staged: dict[str, StagedUpdate] = {}

        for row in rows:
            result = await self._dispatch_tool_call(
                db=db, run=run, row=row, options=options,
                object_cache=shared_cache, staged_updates=shared_staged,
            )
            results.append((row, result))

        failed = self._flush_staged_updates(db, run, shared_staged)
        if failed:
            for i, (row, dispatch) in enumerate(results):
                if dispatch.status == "accepted" and row.llm_call_id in failed:
                    results[i] = (
                        row,
                        DispatchResult(
                            status="failed",
                            result={"success": False, "message": "flush failed"},
                            reason="EXECUTION::flush::group_update_failed",
                        ),
                    )

        return results

    # ── Single tool-call dispatch ──

    async def _dispatch_tool_call(
        self,
        *,
        db: Session,
        run: RunModel,
        row: RunToolCallModel,
        options: HandlerOptions,
        object_cache: dict[str, dict[str, Any]],
        staged_updates: dict[str, StagedUpdate],
    ) -> DispatchResult:
        tool = row.tool_name
        args = row.arguments if isinstance(row.arguments, dict) else {}

        try:
            if tool.startswith("call_"):
                return await self._dispatch_call_sub_agent(db, run, row, args)

            # ── CRUD handlers ──
            if tool == "create_story_object":
                type_raw = args.get("type")
                if not isinstance(type_raw, str):
                    raise ValueError("type is required")
                object_type = self._normalize_story_object_type(type_raw)
                if object_type is None:
                    raise ValueError(f"Unknown story object type: {type_raw}")
                payload = {
                    "name": str(args.get("name") or ""),
                    "description": str(args.get("description") or ""),
                    "content": str(args.get("content") or ""),
                }
                created = object_service.create_object(
                    db,
                    project_id=run.project_id,
                    object_type=object_type,
                    data=payload,
                    language=run.language,
                    metadata=None,
                    user_request=options.user_request,
                    create_new_version=options.create_new_version,
                    created_by=run.user_id,
                )
                return DispatchResult(
                    status="accepted",
                    result={"success": True, "message": f"Created {object_type}", "data": {"id": created.get("id")}},
                )

            if tool in {"create_outline", "create_outline_act", "create_outline_chapter"}:
                metadata: dict[str, Any] | None = None
                object_type = "outline"
                if tool == "create_outline_act":
                    object_type = "act"
                    metadata = {"outline_id": args.get("outlineId")}
                elif tool == "create_outline_chapter":
                    object_type = "chapter"
                    metadata = {"act_id": args.get("actId")}

                payload = {
                    "name": str(args.get("name") or ""),
                    "description": str(args.get("description") or ""),
                    "content": str(args.get("content") or ""),
                }
                created = object_service.create_object(
                    db,
                    project_id=run.project_id,
                    object_type=object_type,
                    data=payload,
                    language=run.language,
                    metadata=metadata,
                    user_request=options.user_request,
                    create_new_version=options.create_new_version,
                    created_by=run.user_id,
                )
                return DispatchResult(
                    status="accepted",
                    result={"success": True, "message": f"Created {object_type}", "data": {"id": created.get("id")}},
                )

            if tool in {"delete_story_object", "delete_outline", "delete_outline_act", "delete_outline_chapter"}:
                id_raw = args.get("id")
                if not isinstance(id_raw, str):
                    raise ValueError("id is required")
                object_id = UUID(id_raw)
                if tool == "delete_story_object":
                    type_raw = args.get("type")
                    if not isinstance(type_raw, str):
                        raise ValueError("type is required")
                    object_type = self._normalize_story_object_type(type_raw)
                    if object_type is None:
                        raise ValueError(f"Unknown story object type: {type_raw}")
                elif tool == "delete_outline":
                    object_type = "outline"
                elif tool == "delete_outline_act":
                    object_type = "act"
                else:
                    object_type = "chapter"

                self._remove_staged_for_object(staged_updates=staged_updates, object_type=object_type, object_id=object_id)

                # Collect all IDs that will be deleted (including cascade children)
                all_deleted: list[dict[str, str]] = [{"id": id_raw, "type": object_type}]
                if object_type == "outline":
                    for child_type, child_ids in collect_outline_subtree_object_ids(db, outline_id=object_id).items():
                        for cid in child_ids:
                            all_deleted.append({"id": str(cid), "type": child_type})
                elif object_type == "act":
                    for child_type, child_ids in collect_act_subtree_object_ids(db, act_id=object_id).items():
                        for cid in child_ids:
                            all_deleted.append({"id": str(cid), "type": child_type})
                elif object_type == "chapter":
                    for child_type, child_ids in collect_chapter_subtree_object_ids(db, chapter_id=object_id).items():
                        for cid in child_ids:
                            all_deleted.append({"id": str(cid), "type": child_type})

                object_service.delete_object(
                    db,
                    project_id=run.project_id,
                    object_type=object_type,
                    object_id=object_id,
                    user_id=run.user_id,
                )
                return DispatchResult(
                    status="accepted",
                    result={"success": True, "message": f"Deleted {object_type}", "data": {"id": id_raw, "deleted_ids": all_deleted}},
                )

            # ── Read / search ──
            if tool in {"read_story_object", "read_outline", "read_manuscript"}:
                id_raw = args.get("id")
                if not isinstance(id_raw, str):
                    raise ValueError("id is required")
                object_id = UUID(id_raw)
                object_type = self._object_type_for_story_or_outline(tool, args)
                if object_type is None:
                    raise ValueError("Unable to resolve object type")
                obj = self._get_cached_or_fetch_object(
                    db=db, run=run, object_type=object_type, object_id=object_id, cache=object_cache,
                )
                current = self._current_data_for_language(obj, run.language)

                if tool == "read_story_object":
                    type_raw = args.get("type")
                    if type_raw == "basic_info":
                        text = f"Title: {current.get('title', '')}\nLogline: {current.get('logline', '')}\nGenre: {current.get('genre', '')}"
                    elif type_raw == "guidelines":
                        text = str(current.get("authorNote") or "")
                    else:
                        text = f"Name: {current.get('name', '')}\nContent: {current.get('content', '')}"
                    return DispatchResult(status="accepted", result={"success": True, "message": text, "data": {"raw": current}})

                if tool == "read_outline":
                    text = f"Name: {current.get('name', '')}\nContent: {current.get('content', '')}"
                    return DispatchResult(status="accepted", result={"success": True, "message": text, "data": {"raw": current}})

                # read_manuscript
                doc = current.get("doc")
                if not isinstance(doc, dict):
                    raise ValueError("Manuscript doc missing")
                try:
                    markdown = await self._sidecar.doc_to_markdown(doc)
                except SidecarUnavailableError:
                    raise ValueError("SIDECAR_ERROR: unavailable")
                except SidecarConversionError as exc:
                    raise ValueError(f"SIDECAR_ERROR: {exc}")

                offset = args.get("offset")
                if isinstance(offset, dict):
                    from_value = offset.get("from")
                    to_value = offset.get("to")
                    if isinstance(from_value, int) and isinstance(to_value, int):
                        markdown = markdown[from_value:to_value]

                return DispatchResult(
                    status="accepted",
                    result={"success": True, "message": markdown, "data": {"wordCount": current.get("wordCount")}},
                )

            if tool == "keyword_search":
                keyword = args.get("keyword")
                page = args.get("page", 1)
                if not isinstance(keyword, str) or not keyword.strip():
                    raise ValueError("keyword must be a non-empty string")
                page_num = int(page) if isinstance(page, int) else 1
                rag_settings = settings_service.get_rag_settings(db, run.user_id)
                payload = keyword_search_project(
                    db,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    keyword=keyword,
                    page=max(page_num, 1),
                    page_size=rag_settings.keyword_page_size,
                )
                total = payload.get("total", 0)
                raw_results = payload.get("results", [])
                search_payload = build_search_payload(
                    db,
                    search_type="keyword",
                    results=raw_results,
                    language=run.language,
                    keyword=keyword,
                    page=max(page_num, 1),
                    page_size=rag_settings.keyword_page_size,
                    total=total,
                )
                return DispatchResult(
                    status="accepted",
                    result={"success": True, "message": f"Keyword results: {total}", "data": {"searchPayload": search_payload}},
                )

            if tool == "rag_search":
                queries = args.get("queries")
                if not isinstance(queries, list) or not queries:
                    raise ValueError("queries must be non-empty string[]")
                query_texts = [str(q) for q in queries if isinstance(q, str) and q.strip()]
                if not query_texts:
                    raise ValueError("queries must be non-empty string[]")

                embedding_cfg = settings_service.get_embedding_config(db, run.user_id, "ragSearch")
                provider_config = credential_service.get_provider_config(db, run.user_id, embedding_cfg.provider)
                rag_settings = settings_service.get_rag_settings(db, run.user_id)

                raw_results = await search_project(
                    db,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    queries=query_texts,
                    provider_config=provider_config,
                    top_k_per_query=rag_settings.top_k_per_query,
                    neighbor_window=rag_settings.neighbor_window,
                )
                search_payload = build_search_payload(
                    db,
                    search_type="rag",
                    results=raw_results,
                    language=run.language,
                    queries=query_texts,
                    total=len(raw_results),
                )
                return DispatchResult(
                    status="accepted",
                    result={"success": True, "message": f"RAG Results: {len(raw_results)}", "data": {"searchPayload": search_payload}},
                )

            # ── Replace / patch (non-manuscript) ──
            if tool in _PATCHABLE_TOOLS:
                return self._handle_non_manuscript_update(
                    db=db, run=run, tool=tool, args=args, options=options,
                    row=row, object_cache=object_cache, staged_updates=staged_updates,
                )

            if tool == "patch_manuscript":
                id_raw = args.get("id")
                old_text = args.get("old")
                new_text = args.get("new")
                if not isinstance(id_raw, str) or not isinstance(old_text, str) or new_text is None:
                    raise ValueError("patch_manuscript requires id, old, new")
                manuscript_id = UUID(id_raw)
                result = await self._manuscript_batch.apply_patch(
                    db=db,
                    manuscript_id=manuscript_id,
                    project_id=run.project_id,
                    language=run.language,
                    old_text=old_text,
                    new_text=str(new_text),
                    call_id=row.llm_call_id,
                    create_new_version=options.create_new_version,
                    user_request=options.user_request,
                    sidecar=self._sidecar,
                )
                if not result.get("success"):
                    return DispatchResult(
                        status="failed",
                        result=result,
                        reason=f"PATCH_MANUSCRIPT::{result.get('code') or 'UNKNOWN'}::{result.get('reason') or 'failed'}",
                    )
                return DispatchResult(status="accepted", result=result)

            if tool == "replace_manuscript":
                id_raw = args.get("id")
                content = args.get("content")
                if not isinstance(id_raw, str) or content is None:
                    raise ValueError("replace_manuscript requires id and content")
                manuscript_id = UUID(id_raw)
                result = await self._manuscript_batch.apply_replace(
                    manuscript_id=manuscript_id,
                    project_id=run.project_id,
                    language=run.language,
                    content=str(content),
                    call_id=row.llm_call_id,
                    create_new_version=options.create_new_version,
                    user_request=options.user_request,
                )
                return DispatchResult(status="accepted", result=result)

            raise ValueError(f"Unsupported function: {tool}")

        except Exception as exc:
            return DispatchResult(
                status="failed",
                result={"success": False, "message": f"Error executing {tool}", "error": str(exc)},
                reason=f"EXECUTION::{tool}::{exc}",
            )

    # ── Sub-agent dispatch ──

    async def _dispatch_call_sub_agent(
        self,
        db: Session,
        run: RunModel,
        row: RunToolCallModel,
        args: dict[str, Any],
    ) -> DispatchResult:
        """Create child thread + run for a sub-agent call. Non-blocking."""
        agent_name = row.tool_name[5:]  # strip "call_" prefix
        input_text = args.get("input")
        if not isinstance(input_text, str) or not input_text.strip():
            return DispatchResult(
                status="failed",
                result={"success": False, "message": "Invalid sub-agent input"},
                reason="EXECUTION::call_sub_agent::invalid_input",
            )

        preset_id = settings_service.get_active_preset_id(db, run.user_id)
        if preset_id is None:
            return DispatchResult(
                status="failed",
                result={"success": False, "message": "No active preset"},
                reason="EXECUTION::call_sub_agent::no_active_preset",
            )

        sub_agent = (
            db.query(SubAgentDefinitionModel)
            .filter(
                SubAgentDefinitionModel.user_id == run.user_id,
                SubAgentDefinitionModel.preset_id == preset_id,
                SubAgentDefinitionModel.agent_name == agent_name,
            )
            .first()
        )
        if sub_agent is None:
            return DispatchResult(
                status="failed",
                result={"success": False, "message": f"Sub-agent not found: {agent_name}"},
                reason="EXECUTION::call_sub_agent::not_found",
            )
        if not sub_agent.enabled:
            return DispatchResult(
                status="failed",
                result={"success": False, "message": f"Sub-agent disabled: {agent_name}"},
                reason="EXECUTION::call_sub_agent::disabled",
            )

        caller_mode = (
            "subAgent"
            if run.thread.thread_type == "subAgent"
            else (run.run_mode or "agentMode")
        )
        allowed_modes = (
            sub_agent.allowed_invocation_modes
            if isinstance(sub_agent.allowed_invocation_modes, list)
            else []
        )
        if caller_mode not in allowed_modes:
            return DispatchResult(
                status="failed",
                result={"success": False, "message": f"Invocation not allowed from {caller_mode}"},
                reason="EXECUTION::call_sub_agent::not_allowed",
            )

        # Create child thread + run (non-blocking)
        child_thread = Thread(
            project_id=run.project_id,
            user_id=run.user_id,
            thread_type="subAgent",
            owner_id=sub_agent.id,
            status="running",
        )
        db.add(child_thread)
        db.flush()

        child_run = RunModel(
            thread_id=child_thread.id,
            user_id=run.user_id,
            project_id=run.project_id,
            status="running",
            run_seq=1,
            language=run.language,
            input_text=input_text.strip(),
            parent_run_id=run.id,
            parent_run_message_id=row.message_id,
            parent_run_tool_call_id=row.llm_call_id,
        )
        db.add(child_run)
        db.flush()

        # Add user message to child run
        child_msg = RunMessageModel(
            thread_id=child_thread.id,
            run_id=child_run.id,
            seq=1,
            seq_in_thread=1,
            role="user",
            data={run.language: {"contentParts": [{"type": "content", "text": input_text.strip()}]}},
        )
        db.add(child_msg)

        child_thread.next_run_seq = 2
        child_run.next_message_seq = 2
        db.flush()

        # Pipeline launch handled by the caller (run_pipeline, Phase 6).
        return DispatchResult(
            status="running",
            result={
                "success": True,
                "message": "Sub-agent started",
                "data": {
                    "sub_agent_id": str(sub_agent.id),
                    "child_thread_id": str(child_thread.id),
                    "child_run_id": str(child_run.id),
                },
            },
            child_run_id=child_run.id,
            child_thread_id=child_thread.id,
        )

    # ── Non-manuscript replace / patch handler ──

    def _handle_non_manuscript_update(
        self,
        *,
        db: Session,
        run: RunModel,
        tool: str,
        args: dict[str, Any],
        options: HandlerOptions,
        row: RunToolCallModel,
        object_cache: dict[str, dict[str, Any]],
        staged_updates: dict[str, StagedUpdate],
    ) -> DispatchResult:
        language = run.language
        create_new = options.create_new_version
        user_request = options.user_request

        if tool in {"replace_basic_info", "patch_basic_info"}:
            base_obj = object_service.list_objects(db, run.project_id, "basic_info")
            if not base_obj:
                raise ValueError("No basic info found")
            target = base_obj[0]
            object_id = UUID(target["id"])
            current = self._current_data_for_language(target, language)

            if tool == "replace_basic_info":
                new_data = {
                    "title": str(args.get("title") if args.get("title") is not None else current.get("title", "")),
                    "logline": str(args.get("logline") if args.get("logline") is not None else current.get("logline", "")),
                    "genre": str(args.get("genre") if args.get("genre") is not None else current.get("genre", "")),
                }
            else:
                field = args.get("field")
                old_text = args.get("old")
                new_text = args.get("new")
                if not isinstance(field, str) or field not in {"title", "logline", "genre"}:
                    raise ValueError("patch_basic_info requires field in [title, logline, genre]")
                if not isinstance(old_text, str) or new_text is None:
                    raise ValueError("patch_basic_info requires old and new")
                current_value = str(current.get(field) or "")
                rr = apply_single_replacement(current_value, old_text, str(new_text))
                if not rr.success:
                    return DispatchResult(
                        status="failed",
                        result={"success": False, "message": rr.reason or rr.code or "patch failed"},
                        reason=f"EXECUTION::{tool}::{rr.code or rr.reason}",
                    )
                new_data = dict(current)
                new_data[field] = rr.content

            self._stage_update(
                staged_updates=staged_updates, cache=object_cache,
                object_type="basic_info", object_id=object_id,
                language=language, create_new_version=create_new,
                data=new_data, metadata=None,
                user_request=user_request, call_id=row.llm_call_id,
            )
            return DispatchResult(
                status="accepted",
                result={"success": True, "message": "Updated basic info", "data": {"id": str(object_id)}},
            )

        object_id_raw = args.get("id")
        if not isinstance(object_id_raw, str):
            raise ValueError("id is required")
        object_id = UUID(object_id_raw)

        object_type = self._object_type_for_story_or_outline(tool, args)
        if object_type is None:
            raise ValueError("Unknown object type")

        if object_type == "lorebook":
            object_type = "lorebook"

        if object_type == "guidelines":
            target = self._get_cached_or_fetch_object(
                db=db, run=run, object_type="guidelines", object_id=object_id, cache=object_cache,
            )
            current = self._current_data_for_language(target, language)
            if tool == "replace_guidelines":
                new_data = dict(current)
                new_data["authorNote"] = str(args.get("authorNote") or "")
            else:
                field = args.get("field")
                old_text = args.get("old")
                new_text = args.get("new")
                if not isinstance(field, str) or not isinstance(old_text, str) or new_text is None:
                    raise ValueError("patch_guidelines requires field, old, new")
                current_value = str(current.get("authorNote") or "")
                rr = apply_single_replacement(current_value, old_text, str(new_text))
                if not rr.success:
                    return DispatchResult(
                        status="failed",
                        result={"success": False, "message": rr.reason or rr.code or "patch failed"},
                        reason=f"EXECUTION::{tool}::{rr.code or rr.reason}",
                    )
                new_data = dict(current)
                new_data["authorNote"] = rr.content

            self._stage_update(
                staged_updates=staged_updates, cache=object_cache,
                object_type="guidelines", object_id=object_id,
                language=language, create_new_version=create_new,
                data=new_data, metadata=None,
                user_request=user_request, call_id=row.llm_call_id,
            )
            return DispatchResult(
                status="accepted",
                result={"success": True, "message": "Updated guidelines", "data": {"id": str(object_id)}},
            )

        target = self._get_cached_or_fetch_object(
            db=db, run=run, object_type=object_type, object_id=object_id, cache=object_cache,
        )
        current = self._current_data_for_language(target, language)

        metadata: dict[str, Any] | None = None
        new_data: dict[str, Any]

        if tool.startswith("replace_"):
            if object_type in {"character", "location", "organization", "lorebook", "outline", "act", "chapter"}:
                new_data = {
                    "name": str(args.get("name") if args.get("name") is not None else current.get("name", "")),
                    "description": str(args.get("description") if args.get("description") is not None else current.get("description", "")),
                    "content": str(args.get("content") if args.get("content") is not None else current.get("content", "")),
                }
            else:
                new_data = dict(current)

            if object_type == "act":
                if isinstance(args.get("order"), int):
                    metadata = {"order": args.get("order")}
            if object_type == "chapter":
                metadata = {}
                if isinstance(args.get("order"), int):
                    metadata["order"] = args.get("order")
                act_id = args.get("actId")
                if isinstance(act_id, str) and act_id:
                    metadata["act_id"] = act_id
                if not metadata:
                    metadata = None

        elif tool.startswith("patch_"):
            field = args.get("field")
            old_text = args.get("old")
            new_text = args.get("new")
            if not isinstance(field, str) or not isinstance(old_text, str) or new_text is None:
                raise ValueError(f"{tool} requires field, old, new")
            current_value = str(current.get(field) or "")
            rr = apply_single_replacement(current_value, old_text, str(new_text))
            if not rr.success:
                return DispatchResult(
                    status="failed",
                    result={"success": False, "message": rr.reason or rr.code or "patch failed"},
                    reason=f"EXECUTION::{tool}::{rr.code or rr.reason}",
                )
            new_data = dict(current)
            new_data[field] = rr.content

            if object_type == "act" and isinstance(args.get("order"), int):
                metadata = {"order": args.get("order")}
            if object_type == "chapter":
                metadata = {}
                if isinstance(args.get("order"), int):
                    metadata["order"] = args.get("order")
                act_id = args.get("actId")
                if isinstance(act_id, str) and act_id:
                    metadata["act_id"] = act_id
                if not metadata:
                    metadata = None
        else:
            raise ValueError(f"Unsupported update tool: {tool}")

        self._stage_update(
            staged_updates=staged_updates, cache=object_cache,
            object_type=object_type, object_id=object_id,
            language=language, create_new_version=create_new,
            data=new_data, metadata=metadata,
            user_request=user_request, call_id=row.llm_call_id,
        )
        return DispatchResult(
            status="accepted",
            result={"success": True, "message": f"Updated {object_type}", "data": {"id": str(object_id)}},
        )


_tool_call_executor_singleton: ToolCallExecutor | None = None


def get_tool_call_executor(sidecar: SidecarClient) -> ToolCallExecutor:
    global _tool_call_executor_singleton
    if _tool_call_executor_singleton is None:
        _tool_call_executor_singleton = ToolCallExecutor(sidecar)
    return _tool_call_executor_singleton
