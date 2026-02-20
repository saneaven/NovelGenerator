from __future__ import annotations

import inspect
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, SubAgentDefinitionModel, Thread, UserSettings
from ..settings_service import settings_service
from ..sidecar_client import sidecar_client
from .contexts import ToolExecutionContext, ToolOfferContext, ToolValidationContext
from .contracts import ToolOffer, ToolSetName, ValidationResult
from .registry import ToolRegistry
from .result_utils import invalid_result, valid_result
from .schema_validation import validate_args_is_object, validate_schema_required_enum_additional_properties


class ToolEngineService:
    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry

    @staticmethod
    def tool_set_for_run(
        thread: Thread,
        run: RunModel,
        *,
        input_payload: dict[str, Any],
    ) -> ToolSetName:
        if thread.thread_type == "journey":
            journey_kind = (thread.journey_kind or "").strip()
            if journey_kind == "objectTranslation":
                return "objectTranslation"
            if journey_kind == "objectEdit":
                category = str(input_payload.get("category") or "").strip()
                if category == "manuscript":
                    return "manuscript"
                if category in {"outline", "act", "chapter"}:
                    return "outline"
                return "storyObject"
            return "storyObject"

        if thread.thread_type == "subAgent":
            return "agent_agent_mode"

        if run.run_mode == "planMode":
            return "agent_plan_mode"
        return "agent_agent_mode"

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
        if thread.thread_type != "subAgent" or thread.owner_id is None:
            return None, None

        definition = (
            db.query(SubAgentDefinitionModel)
            .filter(
                SubAgentDefinitionModel.id == thread.owner_id,
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
        rag_search_enabled: bool,
        tool_set_name: ToolSetName,
    ) -> ToolOffer:
        invocation_mode = self.invocation_mode_for_run(thread, run)
        allowed_tool_names, allowed_sub_agent_ids = self._resolve_sub_agent_permissions(
            db,
            thread=thread,
            user_id=user_id,
        )

        offer_ctx = ToolOfferContext(
            db=db,
            thread=thread,
            run=run,
            settings=settings,
            preset_id=preset_id,
            user_id=user_id,
            project_id=project_id,
            input_payload=input_payload,
            rag_search_enabled=rag_search_enabled,
            tool_set_name=tool_set_name,
            invocation_mode=invocation_mode,
            allowed_tool_names=allowed_tool_names,
            allowed_sub_agent_ids=allowed_sub_agent_ids,
        )
        return self._registry.build_offer(offer_ctx)

    @staticmethod
    async def _await_if_needed(value: Any) -> Any:
        if inspect.isawaitable(value):
            return await value
        return value

    @staticmethod
    def _candidate_tool_sets_for_execution(
        thread: Thread,
        run: RunModel,
        *,
        tool_name: str,
    ) -> list[ToolSetName]:
        if tool_name.startswith("call_"):
            return ["agent_agent_mode", "agent_plan_mode"]

        inferred = ToolEngineService.tool_set_for_run(thread, run, input_payload={})
        candidates: list[ToolSetName] = [inferred]
        fallback: tuple[ToolSetName, ...] = (
            "agent_agent_mode",
            "agent_plan_mode",
            "storyObject",
            "outline",
            "manuscript",
            "objectTranslation",
        )
        for tool_set_name in fallback:
            if tool_set_name not in candidates:
                candidates.append(tool_set_name)
        return candidates

    async def validate_tool_call(
        self,
        *,
        db: Session,
        thread: Thread,
        run: RunModel,
        tool_name: str,
        args: Any,
        offer: ToolOffer,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID | None,
    ) -> ValidationResult:
        base = validate_args_is_object(args)
        if not base.valid:
            return base

        arg_map = args if isinstance(args, dict) else {}

        spec = offer.specs_by_name.get(tool_name)
        if spec is None:
            return invalid_result("validate_tool_is_in_offer", f"Tool not available in this session: {tool_name}")

        schema_result = validate_schema_required_enum_additional_properties(arg_map, spec.parameters)
        if not schema_result.valid:
            return schema_result

        allowed_tool_names, allowed_sub_agent_ids = self._resolve_sub_agent_permissions(
            db,
            thread=thread,
            user_id=user_id,
        )

        validation_ctx = ToolValidationContext(
            db=db,
            thread=thread,
            run=run,
            user_id=user_id,
            project_id=project_id,
            language=language,
            offer=offer,
            sidecar=sidecar_client,
            preset_id=preset_id,
            invocation_mode=self.invocation_mode_for_run(thread, run),
            allowed_tool_names=allowed_tool_names,
            allowed_sub_agent_ids=allowed_sub_agent_ids,
        )

        for validator in spec.validators:
            outcome = await self._await_if_needed(validator(arg_map, validation_ctx))
            if not isinstance(outcome, ValidationResult):
                return invalid_result(
                    "validate_tool_module_validator",
                    f"Validator returned invalid type for tool {tool_name}",
                )
            if not outcome.valid:
                return outcome

        return valid_result()

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
            spec = None
            for tool_set_name in self._candidate_tool_sets_for_execution(
                thread,
                run,
                tool_name=tool_name,
            ):
                offer = self.build_offer_for_run(
                    db,
                    thread=thread,
                    run=run,
                    settings=settings,
                    preset_id=preset_id,
                    user_id=user_id,
                    project_id=effective_project_id,
                    input_payload={},
                    rag_search_enabled=bool(getattr(settings, "rag_search_enabled", False)),
                    tool_set_name=tool_set_name,
                )
                spec = offer.specs_by_name.get(tool_name)
                if spec is not None:
                    break

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
                tool_call_row=tool_call,
                user_id=user_id,
                project_id=effective_project_id,
                language=language,
                sidecar=sidecar_client,
                preset_id=preset_id,
                invocation_mode=self.invocation_mode_for_run(thread, run),
                allowed_tool_names=allowed_tool_names,
                allowed_sub_agent_ids=allowed_sub_agent_ids,
            )

            result = await spec.executor(args, exec_ctx)

            if tool_call.status == "processing" and isinstance(result, dict) and result.get("child_thread_id"):
                # Sub-agent calls remain processing until child thread run completes.
                if not isinstance(tool_call.result, dict):
                    tool_call.result = {
                        "child_thread_id": result.get("child_thread_id"),
                        "agent_name": result.get("agent_name"),
                    }
                tool_call.reason = None
                tool_call.updated_at = datetime.utcnow()
            else:
                tool_call.status = "applied"
                tool_call.result = result
                tool_call.reason = None
                tool_call.updated_at = datetime.utcnow()

            db.flush()
            db.commit()
            db.refresh(tool_call)
            return {"tool_call": tool_call, "result": result}

        except Exception as exc:  # noqa: BLE001
            db.rollback()
            row = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
            if row is not None:
                row.status = "failed"
                row.reason = str(exc)
                row.result = {"success": False, "message": str(exc), "error": str(exc)}
                row.updated_at = datetime.utcnow()
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
        if thread.thread_type != "subAgent" or run.status != "done":
            return

        parent_tc = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.child_thread_id == thread.id)
            .first()
        )
        if parent_tc is None or parent_tc.status != "processing":
            return

        final_msg = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.run_id == run.id, RunMessageModel.role == "assistant")
            .order_by(RunMessageModel.seq.desc())
            .first()
        )

        result_text = ""
        if final_msg and isinstance(final_msg.data, dict):
            final_data = final_msg.data.get("_final", {})
            parts = final_data.get("contentParts", [])
            result_text = "\n".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "content")

        parent_tc.status = "applied"
        parent_tc.result = {"success": True, "content": result_text}
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

        if any(s == "pending" for s in statuses):
            parent_run.status = "waiting"
            parent_thread.status = "waiting"
        elif any(s in {"streaming", "validating", "processing"} for s in statuses):
            parent_run.status = "processing"
            parent_thread.status = "processing"
        elif any(s == "rejected" for s in statuses):
            parent_run.status = "paused"
            parent_thread.status = "paused"
        else:
            parent_run.status = "done"
            parent_thread.status = "done"

        db.commit()

        await emit(
            project_id=parent_thread.project_id,
            thread_id=parent_thread.id,
            event_name="tool_call:status",
            data={
                "run_id": str(parent_tc.run_id),
                "tool_call_id": str(parent_tc.id),
                "status": parent_tc.status,
                "reason": parent_tc.reason,
                "result": parent_tc.result if isinstance(parent_tc.result, dict) else None,
                "child_thread_id": str(parent_tc.child_thread_id) if parent_tc.child_thread_id else None,
            },
        )
        await emit(
            project_id=parent_thread.project_id,
            thread_id=parent_thread.id,
            event_name="run:status",
            data={
                "run_id": str(parent_run.id),
                "status": parent_run.status,
                "error": parent_run.error,
            },
        )
