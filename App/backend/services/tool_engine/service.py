from __future__ import annotations

import inspect
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, SubAgentDefinitionModel, Thread, UserSettings
from ..settings_service import settings_service
from ..sidecar_client import sidecar_client
from ..storage_usage_service import (
    apply_project_usage_delta,
    build_tool_call_delta,
    snapshot_tool_call_row,
)
from ..run_pipeline.status_logic import derive_run_status
from .contexts import ToolExecutionContext, ToolModuleContext, ToolValidationContext
from .contracts import ToolOffer, ValidationResult
from .registry import ToolRegistry
from .result_utils import invalid_result, valid_result
from .schema_validation import validate_args_is_object, validate_schema_required_enum_additional_properties


class ToolEngineService:
    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry

    @staticmethod
    def invocation_mode_for_run(thread: Thread, run: RunModel) -> str:
        if thread.thread_type == "subAgent":
            return "subAgent"
        if run.run_mode == "planMode":
            return "planMode"
        return "agentMode"

    @staticmethod
    def _resolve_sub_agent_permissions(
        db: Session,
        *,
        thread: Thread,
        user_id: UUID,
    ) -> tuple[set[str] | None, set[UUID] | None]:
        if thread.thread_type != "subAgent":
            return None, None

        definition = (
            db.query(SubAgentDefinitionModel)
            .filter(
                SubAgentDefinitionModel.id == thread.parent_id,
                SubAgentDefinitionModel.user_id == user_id,
                SubAgentDefinitionModel.enabled == True,  # noqa: E712
            )
            .first()
        )
        if definition is None:
            return set(), set()

        allowed_tool_names = {
            str(name).strip()
            for name in (definition.allowed_tool_names or [])
            if isinstance(name, str) and str(name).strip()
        }

        allowed_sub_agent_ids: set[UUID] = set()
        for raw in definition.allowed_sub_agent_ids or []:
            try:
                allowed_sub_agent_ids.add(UUID(str(raw)))
            except (TypeError, ValueError):
                continue

        return allowed_tool_names, allowed_sub_agent_ids

    def build_module_context(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        preset_id: UUID,
        user_id: UUID,
        project_id: UUID,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> ToolModuleContext:
        allowed_tool_names, allowed_sub_agent_ids = self._resolve_sub_agent_permissions(
            db,
            thread=thread,
            user_id=user_id,
        )
        return ToolModuleContext(
            db=db,
            thread=thread,
            run=run,
            settings=settings,
            preset_id=preset_id,
            user_id=user_id,
            project_id=project_id,
            input_payload=input_payload,
            vector_storage_enabled=vector_storage_enabled,
            invocation_mode=self.invocation_mode_for_run(thread, run),
            allowed_tool_names=allowed_tool_names,
            allowed_sub_agent_ids=allowed_sub_agent_ids,
        )

    def build_offer_for_run(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        preset_id: UUID,
        user_id: UUID,
        project_id: UUID,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> ToolOffer:
        ctx = self.build_module_context(
            db,
            thread=thread,
            run=run,
            settings=settings,
            preset_id=preset_id,
            user_id=user_id,
            project_id=project_id,
            input_payload=input_payload,
            vector_storage_enabled=vector_storage_enabled,
        )
        return self._registry.build_offer(ctx)

    def list_static_tool_names_for_agent(
        self,
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
    ) -> list[str]:
        settings = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
        thread = Thread(
            id=uuid4(),
            project_id=uuid4(),
            user_id=user_id,
            thread_type="agent",
            parent_id=uuid4(),
            status="waiting",
        )
        run = RunModel(
            id=uuid4(),
            thread_id=thread.id,
            user_id=user_id,
            project_id=thread.project_id,
            status="waiting",
            language=str(getattr(settings, "main_language", "English") or "English"),
            run_mode="agentMode",
            input_payload={},
        )
        ctx = self.build_module_context(
            db,
            thread=thread,
            run=run,
            settings=settings,
            preset_id=preset_id,
            user_id=user_id,
            project_id=thread.project_id,
            input_payload={},
            vector_storage_enabled=True,
        )
        return self._registry.list_static_tool_names(ctx)

    @staticmethod
    async def _await_if_needed(value: Any) -> Any:
        if inspect.isawaitable(value):
            return await value
        return value

    @staticmethod
    def _extract_execution_controls(result: Any) -> tuple[str | None, dict[str, Any] | None, Any]:
        if not isinstance(result, dict):
            return None, None, result
        continue_as_raw = result.get("__continue_as")
        continue_as = str(continue_as_raw) if isinstance(continue_as_raw, str) else None
        extra_patch = result.get("__extra_content")
        safe_result = {k: v for k, v in result.items() if k not in {"__continue_as", "__extra_content"}}
        return continue_as, extra_patch if isinstance(extra_patch, dict) else None, safe_result

    async def validate_tool_call(
        self,
        *,
        db: Session,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        tool_name: str,
        args: Any,
        offer: ToolOffer,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID | None,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> ValidationResult:
        base = validate_args_is_object(args)
        if not base.valid:
            return base

        arg_map = args if isinstance(args, dict) else {}

        module = self._registry.resolve_module(tool_name)
        if module is None:
            return invalid_result("validate_tool_prefix", f"Unknown tool prefix: {tool_name}")

        spec = offer.specs_by_name.get(tool_name)
        if spec is None:
            return invalid_result("validate_tool_is_in_offer", f"Tool not available in this session: {tool_name}")

        schema_result = validate_schema_required_enum_additional_properties(arg_map, spec.parameters)
        if not schema_result.valid:
            return schema_result

        validation_ctx = ToolValidationContext(
            db=db,
            thread=thread,
            run=run,
            settings=settings,
            user_id=user_id,
            project_id=project_id,
            language=language,
            sidecar=sidecar_client,
            preset_id=preset_id,
            input_payload=input_payload,
            vector_storage_enabled=vector_storage_enabled,
            invocation_mode=self.invocation_mode_for_run(thread, run),
            allowed_tool_names=self._resolve_sub_agent_permissions(db, thread=thread, user_id=user_id)[0],
            allowed_sub_agent_ids=self._resolve_sub_agent_permissions(db, thread=thread, user_id=user_id)[1],
        )
        outcome = await self._await_if_needed(module.validate(tool_name, arg_map, validation_ctx))
        if not isinstance(outcome, ValidationResult):
            return invalid_result(
                "validate_tool_module_validator",
                f"Validator returned invalid type for tool {tool_name}",
            )
        return outcome if not outcome.valid else valid_result()

    async def execute_tool_call_by_id(
        self,
        db_factory: Callable[[], Session],
        tool_call_id: UUID,
        *,
        user_id: UUID,
        project_id: UUID,
        language: str,
    ) -> dict[str, Any]:
        db = db_factory()
        try:
            tool_call = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
            if tool_call is None:
                raise ValueError("Tool call not found")

            thread = db.query(Thread).filter(Thread.id == tool_call.thread_id, Thread.user_id == user_id).first()
            if thread is None:
                raise ValueError("Thread not found")

            run = db.query(RunModel).filter(RunModel.id == tool_call.run_id).first()
            if run is None:
                raise ValueError("Run not found")
            effective_project_id = run.project_id

            if tool_call.status in {"applied", "failed", "rejected"}:
                return {"tool_call": tool_call}

            settings = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
            preset_id = settings_service.get_active_preset_id(db, user_id)
            if preset_id is None:
                raise ValueError("No active preset configured")

            tool_name = str(tool_call.tool_name)
            module = self._registry.resolve_module(tool_name)
            if module is None:
                raise ValueError(f"Unknown tool prefix: {tool_name}")

            vector_storage_enabled = settings_service.is_vector_storage_enabled(db, user_id)
            input_payload = run.input_payload if isinstance(run.input_payload, dict) else {}
            offer = self.build_offer_for_run(
                db,
                thread=thread,
                run=run,
                settings=settings,
                preset_id=preset_id,
                user_id=user_id,
                project_id=effective_project_id,
                input_payload=input_payload,
                vector_storage_enabled=vector_storage_enabled,
            )
            spec = offer.specs_by_name.get(tool_name)
            if spec is None:
                raise ValueError(f"Tool not available in this session: {tool_name}")

            tool_call.status = "processing"
            tool_call.accepted_at = tool_call.accepted_at or datetime.utcnow()
            tool_call.updated_at = datetime.utcnow()
            db.flush()

            args = tool_call.arguments if isinstance(tool_call.arguments, dict) else {}
            allowed_tool_names, allowed_sub_agent_ids = self._resolve_sub_agent_permissions(
                db,
                thread=thread,
                user_id=user_id,
            )
            exec_ctx = ToolExecutionContext(
                db=db,
                thread=thread,
                run=run,
                settings=settings,
                tool_call_row=tool_call,
                user_id=user_id,
                project_id=effective_project_id,
                language=language,
                sidecar=sidecar_client,
                preset_id=preset_id,
                input_payload=input_payload,
                vector_storage_enabled=vector_storage_enabled,
                invocation_mode=self.invocation_mode_for_run(thread, run),
                allowed_tool_names=allowed_tool_names,
                allowed_sub_agent_ids=allowed_sub_agent_ids,
            )

            raw_result = await module.execute(tool_name, args, exec_ctx)
            continue_as, extra_patch, result = self._extract_execution_controls(raw_result)
            before = snapshot_tool_call_row(tool_call)

            if extra_patch is not None:
                base_extra = tool_call.extra_content if isinstance(tool_call.extra_content, dict) else {}
                tool_call.extra_content = {**base_extra, **extra_patch}

            if continue_as in {"working"} and tool_call.status == "processing":
                tool_call.status = continue_as
                tool_call.result = result if isinstance(result, dict) else None
                tool_call.reason = None
                tool_call.updated_at = datetime.utcnow()
            else:
                tool_call.status = "applied"
                tool_call.result = result
                tool_call.reason = None
                tool_call.updated_at = datetime.utcnow()

            db.flush()
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=effective_project_id,
                delta=build_tool_call_delta(before, snapshot_tool_call_row(tool_call)),
                enforce_quota=True,
            )
            db.commit()
            db.refresh(tool_call)
            return {"tool_call": tool_call, "result": result}

        except Exception as exc:  # noqa: BLE001
            db.rollback()
            row = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
            if row is not None:
                before = snapshot_tool_call_row(row)
                row.status = "failed"
                row.reason = str(exc)
                row.result = {"success": False, "message": str(exc), "error": str(exc)}
                row.updated_at = datetime.utcnow()
                apply_project_usage_delta(
                    db,
                    user_id=user_id,
                    project_id=row.run.project_id if row.run is not None else project_id,
                    delta=build_tool_call_delta(before, snapshot_tool_call_row(row)),
                    enforce_quota=False,
                )
                db.commit()
                db.refresh(row)
                return {"tool_call": row, "result": row.result}
            raise
        finally:
            db.close()

    async def complete_parent_tool_call(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        emit: Callable[..., Awaitable[None]],
    ) -> None:
        if thread.thread_type != "subAgent":
            return
        if run.status not in ("done", "canceled"):
            return

        parent_tc = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.child_thread_id == thread.id)
            .first()
        )
        if parent_tc is None or parent_tc.status != "working":
            return
        parent_tc_before = snapshot_tool_call_row(parent_tc)

        if run.status == "done":
            final_msg = (
                db.query(RunMessageModel)
                .filter(RunMessageModel.run_id == run.id, RunMessageModel.role == "assistant")
                .order_by(RunMessageModel.seq.desc())
                .first()
            )

            result_text = ""
            if final_msg and isinstance(final_msg.data, dict):
                final_data = final_msg.data.get(run.language) or next(
                    (v for v in final_msg.data.values() if isinstance(v, dict)), {}
                )
                parts = final_data.get("contentParts", [])
                result_text = "\n".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "content")

            parent_tc.status = "applied"
            parent_tc.result = {"success": True, "message": result_text}
        else:
            error_message = run.error or "Sub-agent canceled"
            parent_tc.status = "failed"
            parent_tc.reason = error_message
            parent_tc.result = {"success": False, "message": error_message}
        parent_tc.updated_at = datetime.utcnow()

        parent_thread = db.query(Thread).filter(Thread.id == parent_tc.thread_id).first()
        parent_run = db.query(RunModel).filter(RunModel.id == parent_tc.run_id).first()
        if not parent_thread or not parent_run:
            db.commit()
            return

        statuses = [
            s
            for (s,) in db.query(RunToolCallModel.status)
            .filter(RunToolCallModel.run_id == parent_run.id)
            .all()
        ]

        parent_status = derive_run_status(current_status=parent_run.status, tool_call_statuses=statuses)
        parent_run.status = parent_status
        parent_thread.status = parent_status

        apply_project_usage_delta(
            db,
            user_id=parent_run.user_id,
            project_id=parent_thread.project_id,
            delta=build_tool_call_delta(parent_tc_before, snapshot_tool_call_row(parent_tc)),
            enforce_quota=False,
        )
        db.commit()

        await emit(
            user_id=parent_run.user_id,
            project_id=parent_thread.project_id,
            thread_id=parent_thread.id,
            event_name="tool_call:status",
            data={
                "run_id": str(parent_tc.run_id),
                "tool_call_id": str(parent_tc.id),
                "status": parent_tc.status,
                "reason": parent_tc.reason,
                "result": parent_tc.result if isinstance(parent_tc.result, dict) else None,
                "extra_content": parent_tc.extra_content if isinstance(parent_tc.extra_content, dict) else None,
                "child_thread_id": str(parent_tc.child_thread_id) if parent_tc.child_thread_id else None,
                "assistant_message_id": str(parent_tc.assistant_message_id) if parent_tc.assistant_message_id else None,
            },
        )
        await emit(
            user_id=parent_run.user_id,
            project_id=parent_thread.project_id,
            thread_id=parent_thread.id,
            event_name="run:status",
            data={
                "run_id": str(parent_run.id),
                "status": parent_run.status,
                "error": parent_run.error,
            },
        )
