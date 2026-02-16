from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import RunModel, RunToolCallModel, SubAgentDefinitionModel
from .credential_service import credential_service
from .manuscript_batch import ManuscriptBatch
from .object_service import object_service
from .patch_utils import apply_single_replacement
from .rag_search_service import keyword_search_project, search_project
from .settings_service import settings_service
from .sidecar_client import SidecarClient, SidecarConversionError, SidecarUnavailableError
from .tool_schemas import ToolSchemaDef
from .validators import GLOBAL_VALIDATORS, TOOL_VALIDATORS, ValidationContext, run_validator_chain


ToolDecision = Literal["accept", "reject"]


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
    failure_type: Literal["validation"] | None = None
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
class ApplyResult:
    rows: list[RunToolCallModel]
    blocked_children: list[dict[str, str]] = field(default_factory=list)
    subagent_finalize_output: str | None = None


@dataclass
class DispatchResult:
    kind: Literal["ok", "blocked_child", "finalize_subagent", "error"]
    result: dict[str, Any] | None = None
    failure_type: Literal["execution", "partial"] | None = None
    reason: str | None = None
    child_run_id: str | None = None
    output_text: str | None = None


class ToolCallExecutor:
    RESULT_MAX_BYTES = 64 * 1024

    def __init__(self, sidecar: SidecarClient) -> None:
        self._sidecar = sidecar
        self._manuscript_batch = ManuscriptBatch()

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
                        failure_type="validation",
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
                        failure_type="validation",
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
                        failure_type="validation",
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

    async def apply_tool_calls(
        self,
        db: Session,
        run: RunModel,
        message_id: UUID,
        decisions: dict[str, ToolDecision],
        options: dict[str, Any] | None,
        *,
        run_engine: Any = None,
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

        object_cache: dict[str, dict[str, Any]] = {}
        staged_updates: dict[str, StagedUpdate] = {}
        blocked_children: list[dict[str, str]] = []
        subagent_finalize_output: str | None = None
        finalized_subagent = False

        accepted_rows: list[RunToolCallModel] = []
        for row in rows:
            if row.status in {"accepted", "rejected", "failed"}:
                continue
            if row.status != "pending":
                continue

            if finalized_subagent:
                row.status = "rejected"
                row.reason = "REJECTED::subagent_already_completed"
                row.updated_at = datetime.utcnow()
                continue

            decision = decisions.get(row.llm_call_id, "reject")
            if decision != "accept":
                row.status = "rejected"
                row.reason = row.reason or "User rejected"
                row.updated_at = datetime.utcnow()
                continue

            row.status = "running"
            row.updated_at = datetime.utcnow()

            dispatch_raw = await self._dispatch_tool_call(
                db=db,
                run=run,
                row=row,
                options=opts,
                object_cache=object_cache,
                staged_updates=staged_updates,
                run_engine=run_engine,
            )
            if isinstance(dispatch_raw, DispatchResult):
                dispatch = dispatch_raw
            else:
                result, failure_type, reason = dispatch_raw
                dispatch = (
                    DispatchResult(kind="ok", result=result)
                    if failure_type is None
                    else DispatchResult(kind="error", result=result, failure_type=failure_type, reason=reason)
                )

            if dispatch.kind == "ok":
                row.status = "accepted"
                row.failure_type = None
                row.reason = None
                row.accepted_at = datetime.utcnow()
                row.result = self._truncate_json_value(dispatch.result or {"success": True})
                accepted_rows.append(row)
            elif dispatch.kind == "finalize_subagent":
                row.status = "accepted"
                row.failure_type = None
                row.reason = None
                row.accepted_at = datetime.utcnow()
                row.result = self._truncate_json_value(dispatch.result or {"success": True})
                accepted_rows.append(row)
                subagent_finalize_output = (dispatch.output_text or "").strip()
                finalized_subagent = True
            elif dispatch.kind == "blocked_child":
                child_run_id = str(dispatch.child_run_id or "").strip()
                row.status = "running"
                row.failure_type = None
                row.reason = f"CHILD_WAITING::{child_run_id}" if child_run_id else "CHILD_WAITING"
                row.result = self._truncate_json_value(
                    dispatch.result
                    or {
                        "success": True,
                        "message": "Sub-agent run is waiting for decisions",
                        "child_run_id": child_run_id,
                    }
                )
                row.accepted_at = None
                if child_run_id:
                    blocked_children.append(
                        {
                            "llm_call_id": row.llm_call_id,
                            "child_run_id": child_run_id,
                            "parent_message_id": str(message_id),
                        }
                    )
            else:
                row.status = "failed"
                row.failure_type = dispatch.failure_type
                row.reason = dispatch.reason
                row.result = self._truncate_json_value(dispatch.result or {"success": False})

            row.updated_at = datetime.utcnow()

        # Flush manuscript batch first (it calls object_service.update_object internally)
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

        # Flush staged non-manuscript updates once per dedup key
        update_flush_failures: dict[str, str] = {}
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
            except Exception as exc:
                update_flush_failures[staged.key] = str(exc)
                for call_id in staged.call_ids:
                    failed_call_ids.add(call_id)

        if failed_call_ids:
            for row in rows:
                if row.status != "accepted":
                    continue
                if row.llm_call_id not in failed_call_ids:
                    continue
                row.status = "failed"
                row.failure_type = "partial"
                row.reason = row.reason or "EXECUTION::flush::batched flush failed"
                row.result = self._truncate_json_value({
                    "success": False,
                    "message": row.reason,
                    "flush_errors": update_flush_failures,
                })
                row.accepted_at = None
                row.updated_at = datetime.utcnow()

        if subagent_finalize_output is not None and run.run_type != "subAgent":
            # Guardrail: only subAgent runs may finalize via return_sub_agent_result.
            subagent_finalize_output = None

        db.flush()
        return ApplyResult(
            rows=rows,
            blocked_children=blocked_children,
            subagent_finalize_output=subagent_finalize_output,
        )

    async def _dispatch_tool_call(
        self,
        *,
        db: Session,
        run: RunModel,
        row: RunToolCallModel,
        options: HandlerOptions,
        object_cache: dict[str, dict[str, Any]],
        staged_updates: dict[str, StagedUpdate],
        run_engine: Any,
    ) -> DispatchResult | tuple[dict[str, Any], Literal["execution", "partial"] | None, str | None]:
        tool = row.tool_name
        args = row.arguments if isinstance(row.arguments, dict) else {}

        try:
            # Sub-agent control tools
            if tool == "return_sub_agent_result":
                if run.run_type != "subAgent":
                    return DispatchResult(
                        kind="error",
                        result={"success": False, "message": "return_sub_agent_result is only allowed in subAgent runs"},
                        failure_type="execution",
                        reason="EXECUTION::return_sub_agent_result::invalid_run_type",
                    )
                result_text = args.get("result")
                if not isinstance(result_text, str) or not result_text.strip():
                    return DispatchResult(
                        kind="error",
                        result={"success": False, "message": "Invalid result", "error": "result must be non-empty string"},
                        failure_type="execution",
                        reason="EXECUTION::return_sub_agent_result::invalid_result",
                    )
                return DispatchResult(
                    kind="finalize_subagent",
                    result={"success": True, "message": result_text, "result": result_text},
                    output_text=result_text,
                )

            if tool.startswith("call_"):
                if run_engine is None:
                    return (
                        {"success": False, "message": "Run engine unavailable"},
                        "execution",
                        "EXECUTION::call_sub_agent::run_engine_unavailable",
                    )

                agent_name = tool[5:]
                input_text = args.get("input")
                if not isinstance(input_text, str) or not input_text.strip():
                    return (
                        {"success": False, "message": "Invalid sub-agent input"},
                        "execution",
                        "EXECUTION::call_sub_agent::invalid_input",
                    )

                preset_id = settings_service.get_active_preset_id(db, run.user_id)
                if preset_id is None:
                    return (
                        {"success": False, "message": "No active preset"},
                        "execution",
                        "EXECUTION::call_sub_agent::no_active_preset",
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
                    return (
                        {"success": False, "message": f"Sub-agent not found: {agent_name}"},
                        "execution",
                        "EXECUTION::call_sub_agent::not_found",
                    )
                if not sub_agent.enabled:
                    return (
                        {"success": False, "message": f"Sub-agent disabled: {agent_name}"},
                        "execution",
                        "EXECUTION::call_sub_agent::disabled",
                    )

                caller_mode = "subAgent" if run.run_type == "subAgent" else (run.run_mode or "agentMode")
                allowed_modes = sub_agent.allowed_invocation_modes if isinstance(sub_agent.allowed_invocation_modes, list) else []
                if caller_mode not in allowed_modes:
                    return (
                        {"success": False, "message": f"Invocation not allowed from {caller_mode}"},
                        "execution",
                        "EXECUTION::call_sub_agent::not_allowed",
                    )

                outcome = await run_engine.invoke_sub_agent(
                    user_id=run.user_id,
                    project_id=run.project_id,
                    parent_run_id=run.id,
                    parent_run_message_id=row.message_id,
                    parent_run_tool_call_id=row.llm_call_id,
                    agent_id=run.agent_id,
                    sub_agent_id=sub_agent.id,
                    language=run.language,
                    input_text=input_text,
                )
                if isinstance(outcome, dict):
                    outcome_kind = str(outcome.get("kind") or "").strip()
                    child_run_id = str(outcome.get("child_run_id") or "").strip()
                    if outcome_kind == "waiting":
                        return DispatchResult(
                            kind="blocked_child",
                            child_run_id=child_run_id or None,
                            result={
                                "success": True,
                                "message": "Sub-agent is waiting for decisions",
                                "child_run_id": child_run_id,
                                "sub_agent_id": str(sub_agent.id),
                            },
                        )
                    if outcome_kind == "completed":
                        output_text = str(outcome.get("output") or "")
                        return DispatchResult(
                            kind="ok",
                            result={"success": True, "message": output_text, "data": {"sub_agent_id": str(sub_agent.id)}},
                        )
                    if outcome_kind == "failed":
                        return DispatchResult(
                            kind="error",
                            result={"success": False, "message": str(outcome.get("error") or "Sub-agent failed")},
                            failure_type="execution",
                            reason=f"EXECUTION::call_sub_agent::{outcome.get('error') or 'failed'}",
                        )
                output = str(outcome or "")
                return DispatchResult(kind="ok", result={"success": True, "message": output, "data": {"sub_agent_id": str(sub_agent.id)}})

            # CRUD handlers
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
                return ({"success": True, "message": f"Created {object_type}", "data": {"id": created.get("id")}}, None, None)

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
                return ({"success": True, "message": f"Created {object_type}", "data": {"id": created.get("id")}}, None, None)

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
                object_service.delete_object(
                    db,
                    project_id=run.project_id,
                    object_type=object_type,
                    object_id=object_id,
                    user_id=run.user_id,
                )
                return ({"success": True, "message": f"Deleted {object_type}", "data": {"id": id_raw}}, None, None)

            # Read/search handlers
            if tool in {"read_story_object", "read_outline", "read_manuscript"}:
                id_raw = args.get("id")
                if not isinstance(id_raw, str):
                    raise ValueError("id is required")
                object_id = UUID(id_raw)
                object_type = self._object_type_for_story_or_outline(tool, args)
                if object_type is None:
                    raise ValueError("Unable to resolve object type")
                obj = self._get_cached_or_fetch_object(
                    db=db,
                    run=run,
                    object_type=object_type,
                    object_id=object_id,
                    cache=object_cache,
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
                    return ({"success": True, "message": text, "data": {"raw": current}}, None, None)

                if tool == "read_outline":
                    text = f"Name: {current.get('name', '')}\nContent: {current.get('content', '')}"
                    return ({"success": True, "message": text, "data": {"raw": current}}, None, None)

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

                return ({"success": True, "message": markdown, "data": {"wordCount": current.get("wordCount")}}, None, None)

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
                return (
                    {
                        "success": True,
                        "message": f"Keyword results: {payload.get('total', 0)}",
                        "data": payload,
                    },
                    None,
                    None,
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

                results = await search_project(
                    db,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    queries=query_texts,
                    provider_config=provider_config,
                    top_k_per_query=rag_settings.top_k_per_query,
                    neighbor_window=rag_settings.neighbor_window,
                )

                message = f"RAG Results: {len(results)}"
                return ({"success": True, "message": message, "data": {"results": results}}, None, None)

            # Replace / patch handlers (dedup staged)
            if tool in {
                "replace_basic_info",
                "replace_guidelines",
                "replace_story_object",
                "replace_outline",
                "replace_outline_act",
                "replace_outline_chapter",
                "patch_basic_info",
                "patch_guidelines",
                "patch_story_object",
                "patch_outline",
                "patch_outline_act",
                "patch_outline_chapter",
            }:
                return self._handle_non_manuscript_update(
                    db=db,
                    run=run,
                    tool=tool,
                    args=args,
                    options=options,
                    row=row,
                    object_cache=object_cache,
                    staged_updates=staged_updates,
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
                    return (
                        result,
                        "execution",
                        f"PATCH_MANUSCRIPT::{result.get('code') or 'UNKNOWN'}::{result.get('reason') or 'failed'}",
                    )
                return (result, None, None)

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
                return (result, None, None)

            raise ValueError(f"Unsupported function: {tool}")

        except Exception as exc:
            return DispatchResult(
                kind="error",
                result={"success": False, "message": f"Error executing {tool}", "error": str(exc)},
                failure_type="execution",
                reason=f"EXECUTION::{tool}::{exc}",
            )

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
    ) -> tuple[dict[str, Any], Literal["execution", "partial"] | None, str | None]:
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
                    return (
                        {"success": False, "message": rr.reason or rr.code or "patch failed"},
                        "execution",
                        f"EXECUTION::{tool}::{rr.code or rr.reason}",
                    )
                new_data = dict(current)
                new_data[field] = rr.content

            self._stage_update(
                staged_updates=staged_updates,
                cache=object_cache,
                object_type="basic_info",
                object_id=object_id,
                language=language,
                create_new_version=create_new,
                data=new_data,
                metadata=None,
                user_request=user_request,
                call_id=row.llm_call_id,
            )
            return ({"success": True, "message": "Updated basic info", "data": {"id": str(object_id)}}, None, None)

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
                db=db,
                run=run,
                object_type="guidelines",
                object_id=object_id,
                cache=object_cache,
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
                    return (
                        {"success": False, "message": rr.reason or rr.code or "patch failed"},
                        "execution",
                        f"EXECUTION::{tool}::{rr.code or rr.reason}",
                    )
                new_data = dict(current)
                new_data["authorNote"] = rr.content

            self._stage_update(
                staged_updates=staged_updates,
                cache=object_cache,
                object_type="guidelines",
                object_id=object_id,
                language=language,
                create_new_version=create_new,
                data=new_data,
                metadata=None,
                user_request=user_request,
                call_id=row.llm_call_id,
            )
            return ({"success": True, "message": "Updated guidelines", "data": {"id": str(object_id)}}, None, None)

        target = self._get_cached_or_fetch_object(
            db=db,
            run=run,
            object_type=object_type,
            object_id=object_id,
            cache=object_cache,
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
                return (
                    {"success": False, "message": rr.reason or rr.code or "patch failed"},
                    "execution",
                    f"EXECUTION::{tool}::{rr.code or rr.reason}",
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
            staged_updates=staged_updates,
            cache=object_cache,
            object_type=object_type,
            object_id=object_id,
            language=language,
            create_new_version=create_new,
            data=new_data,
            metadata=metadata,
            user_request=user_request,
            call_id=row.llm_call_id,
        )
        return ({"success": True, "message": f"Updated {object_type}", "data": {"id": str(object_id)}}, None, None)


_tool_call_executor_singleton: ToolCallExecutor | None = None


def get_tool_call_executor(sidecar: SidecarClient) -> ToolCallExecutor:
    global _tool_call_executor_singleton
    if _tool_call_executor_singleton is None:
        _tool_call_executor_singleton = ToolCallExecutor(sidecar)
    return _tool_call_executor_singleton
