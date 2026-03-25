from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, SubAgentDefinitionModel, Thread, UserSettings
from ..settings_service import settings_service
from ..sidecar_client import sidecar_client
from ..storage_usage_service import (
    apply_project_usage_delta,
    apply_project_usage_deltas,
    build_tool_call_delta,
    snapshot_tool_call_row,
)
from ..run_pipeline.status_logic import derive_run_status
from .contexts import ToolAccessPolicy, ToolExecutionContext, ToolGroupExecutionContext, ToolModuleContext, ToolValidationContext
from .contracts import PersistedToolMeta, ToolDecisionGroup, ToolDecisionItem, ToolExecutionOutcome, ToolExecutionResult, ToolOffer, ValidationResult
from .grant_catalog import TOOL_GRANT_CATALOG
from .registry import ToolRegistry
from .result_utils import invalid_result, valid_result
from .schema_validation import validate_args_is_object, validate_schema_required_enum_additional_properties


@dataclass(frozen=True)
class AppliedToolCallResult:
    tool_call_id: UUID
    status: str
    child_thread_id: UUID | None = None
    child_input_text: str | None = None
    image_run_id: UUID | None = None


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
    def _parse_allowed_sub_agent_ids(raw_items: Any) -> frozenset[UUID]:
        out: set[UUID] = set()
        if not isinstance(raw_items, list):
            return frozenset()
        for raw in raw_items:
            try:
                out.add(UUID(str(raw)))
            except (TypeError, ValueError):
                continue
        return frozenset(out)

    @staticmethod
    def _normalize_feature_categories(raw_items: Any) -> dict[str, frozenset[str]]:
        out: dict[str, frozenset[str]] = {}
        if not isinstance(raw_items, list):
            return out
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            feature_key = str(item.get("feature_key") or "").strip()
            if feature_key not in TOOL_GRANT_CATALOG:
                continue
            supported = {
                str(value)
                for value in (TOOL_GRANT_CATALOG[feature_key].get("supported_categories") or ())
                if isinstance(value, str) and value
            }
            categories_raw = item.get("categories")
            if not isinstance(categories_raw, list):
                continue
            categories = frozenset(
                str(value)
                for value in categories_raw
                if isinstance(value, str) and str(value) in supported
            )
            if categories:
                out[feature_key] = categories
        return out

    def build_access_policy(
        self,
        db: Session,
        *,
        thread: Thread,
        user_id: UUID,
    ) -> ToolAccessPolicy:
        if thread.thread_type != "subAgent":
            return ToolAccessPolicy(feature_categories=None, allowed_sub_agent_ids=None)

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
            return ToolAccessPolicy(feature_categories={}, allowed_sub_agent_ids=frozenset())

        return ToolAccessPolicy(
            feature_categories=self._normalize_feature_categories(definition.tool_grants),
            allowed_sub_agent_ids=self._parse_allowed_sub_agent_ids(definition.allowed_sub_agent_ids),
        )

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
        access_policy = self.build_access_policy(db, thread=thread, user_id=user_id)
        compat_allowed_sub_agents = (
            set(access_policy.allowed_sub_agent_ids)
            if access_policy.allowed_sub_agent_ids is not None
            else None
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
            access_policy=access_policy,
            allowed_sub_agent_ids=compat_allowed_sub_agents,
        )

    def _build_validation_context(
        self,
        *,
        db: Session,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID | None,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> ToolValidationContext:
        access_policy = self.build_access_policy(db, thread=thread, user_id=user_id)
        compat_allowed_sub_agents = (
            set(access_policy.allowed_sub_agent_ids)
            if access_policy.allowed_sub_agent_ids is not None
            else None
        )
        return ToolValidationContext(
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
            access_policy=access_policy,
            allowed_sub_agent_ids=compat_allowed_sub_agents,
        )

    def _build_execution_context(
        self,
        *,
        db: Session,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        tool_call_row: RunToolCallModel,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID | None,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> ToolExecutionContext:
        access_policy = self.build_access_policy(db, thread=thread, user_id=user_id)
        compat_allowed_sub_agents = (
            set(access_policy.allowed_sub_agent_ids)
            if access_policy.allowed_sub_agent_ids is not None
            else None
        )
        return ToolExecutionContext(
            db=db,
            thread=thread,
            run=run,
            settings=settings,
            tool_call_row=tool_call_row,
            user_id=user_id,
            project_id=project_id,
            language=language,
            sidecar=sidecar_client,
            preset_id=preset_id,
            input_payload=input_payload,
            vector_storage_enabled=vector_storage_enabled,
            invocation_mode=self.invocation_mode_for_run(thread, run),
            access_policy=access_policy,
            allowed_sub_agent_ids=compat_allowed_sub_agents,
        )

    def _build_group_execution_context(
        self,
        *,
        db: Session,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID | None,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> ToolGroupExecutionContext:
        access_policy = self.build_access_policy(db, thread=thread, user_id=user_id)
        return ToolGroupExecutionContext(
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
            access_policy=access_policy,
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
        offer = self.build_offer_for_run(
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
        return sorted(
            name
            for name in offer.specs_by_name
            if not (name.startswith("call_") or name.startswith("mcp__"))
        )

    @staticmethod
    def _parse_persisted_meta(raw: Any) -> PersistedToolMeta | None:
        if not isinstance(raw, dict):
            return None
        feature_key = raw.get("feature_key")
        category = raw.get("category")
        op = raw.get("op")
        target_kind = raw.get("target_kind")
        if not all(isinstance(value, str) and value for value in (feature_key, category, op, target_kind)):
            return None
        target_id = raw.get("target_id")
        if target_id is not None and not isinstance(target_id, str):
            target_id = str(target_id)
        merge_key = raw.get("merge_key")
        if merge_key is not None and not isinstance(merge_key, str):
            merge_key = str(merge_key)
        return PersistedToolMeta(
            feature_key=feature_key,
            category=category,
            op=op,
            target_kind=target_kind,
            target_id=target_id,
            merge_key=merge_key,
        )

    @staticmethod
    def _normalize_execution_outcome(raw: Any) -> ToolExecutionOutcome:
        if isinstance(raw, ToolExecutionOutcome):
            return raw
        if not isinstance(raw, dict):
            raise ValueError(f"Legacy tool execution returned invalid type: {type(raw)!r}")

        extra_content_patch = raw.get("__extra_content")
        safe_result = {k: v for k, v in raw.items() if k != "__extra_content"}

        child_thread_id: UUID | None = None
        image_run_id: UUID | None = None
        for field_name, target in (("child_thread_id", "child"), ("image_run_id", "image")):
            value = safe_result.get(field_name)
            if value is None:
                continue
            try:
                parsed = UUID(str(value))
            except (TypeError, ValueError):
                parsed = None
            if target == "child":
                child_thread_id = parsed
            else:
                image_run_id = parsed

        child_input_text = safe_result.get("input_text")
        if not isinstance(child_input_text, str):
            child_input_text = None

        return ToolExecutionOutcome(
            lifecycle="applied",
            result=safe_result,
            extra_content_patch=extra_content_patch if isinstance(extra_content_patch, dict) else None,
            child_thread_id=child_thread_id,
            child_input_text=child_input_text,
            image_run_id=image_run_id,
        )

    @staticmethod
    def _apply_execution_outcome(row: RunToolCallModel, outcome: ToolExecutionOutcome) -> None:
        base_extra = row.extra_content if isinstance(row.extra_content, dict) else {}
        if outcome.extra_content_patch:
            row.extra_content = {**base_extra, **outcome.extra_content_patch}
        elif not isinstance(row.extra_content, dict):
            row.extra_content = base_extra

        if outcome.child_thread_id is not None:
            row.child_thread_id = outcome.child_thread_id
        if outcome.image_run_id is not None:
            row.image_run_id = outcome.image_run_id

        row.status = "working" if outcome.lifecycle == "working" else "applied"
        row.result = outcome.result if isinstance(outcome.result, dict) else None
        row.reason = None
        row.updated_at = datetime.utcnow()

    @staticmethod
    def _mark_failed(row: RunToolCallModel, reason: str) -> None:
        row.status = "failed"
        row.reason = reason
        row.result = {"success": False, "message": reason, "error": reason}
        row.updated_at = datetime.utcnow()

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
        spec = offer.specs_by_name.get(tool_name)
        binding = offer.bindings_by_name.get(tool_name)
        if spec is None or binding is None:
            return invalid_result("validate_tool_is_in_offer", f"Tool not available in this session: {tool_name}")

        schema_result = validate_schema_required_enum_additional_properties(arg_map, spec.parameters)
        if not schema_result.valid:
            return schema_result

        validation_ctx = self._build_validation_context(
            db=db,
            thread=thread,
            run=run,
            settings=settings,
            user_id=user_id,
            project_id=project_id,
            language=language,
            preset_id=preset_id,
            input_payload=input_payload,
            vector_storage_enabled=vector_storage_enabled,
        )
        outcome = await binding.validate(arg_map, validation_ctx)
        if not isinstance(outcome, ValidationResult):
            return invalid_result(
                "validate_tool_module_validator",
                f"Validator returned invalid type for tool {tool_name}",
            )
        return outcome if not outcome.valid else valid_result()

    async def _execute_immediate_item(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        row: RunToolCallModel,
        item: ToolDecisionItem,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> AppliedToolCallResult:
        before = snapshot_tool_call_row(row)
        try:
            exec_ctx = self._build_execution_context(
                db=db,
                thread=thread,
                run=run,
                settings=settings,
                tool_call_row=row,
                user_id=user_id,
                project_id=project_id,
                language=language,
                preset_id=preset_id,
                input_payload=input_payload,
                vector_storage_enabled=vector_storage_enabled,
            )
            outcome = await item.binding.execute(item.args, exec_ctx)
            if not isinstance(outcome, ToolExecutionOutcome):
                outcome = self._normalize_execution_outcome(outcome)
            self._apply_execution_outcome(row, outcome)
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=project_id,
                delta=build_tool_call_delta(before, snapshot_tool_call_row(row)),
                enforce_quota=True,
            )
            db.commit()
            db.refresh(row)
            return AppliedToolCallResult(
                tool_call_id=row.id,
                status=row.status,
                child_thread_id=outcome.child_thread_id,
                child_input_text=outcome.child_input_text,
                image_run_id=outcome.image_run_id,
            )
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            failed_row = db.query(RunToolCallModel).filter(RunToolCallModel.id == row.id).first()
            if failed_row is None:
                raise
            failed_before = snapshot_tool_call_row(failed_row)
            self._mark_failed(failed_row, str(exc))
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=project_id,
                delta=build_tool_call_delta(failed_before, snapshot_tool_call_row(failed_row)),
                enforce_quota=False,
            )
            db.commit()
            db.refresh(failed_row)
            return AppliedToolCallResult(tool_call_id=failed_row.id, status=failed_row.status)

    async def _execute_group(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        settings: UserSettings,
        rows_by_id: dict[UUID, RunToolCallModel],
        group: ToolDecisionGroup,
        user_id: UUID,
        project_id: UUID,
        language: str,
        preset_id: UUID,
        input_payload: dict[str, Any],
        vector_storage_enabled: bool,
    ) -> list[AppliedToolCallResult]:
        module = self._registry.get_feature_module(group.feature_key)
        try:
            group_ctx = self._build_group_execution_context(
                db=db,
                thread=thread,
                run=run,
                settings=settings,
                user_id=user_id,
                project_id=project_id,
                language=language,
                preset_id=preset_id,
                input_payload=input_payload,
                vector_storage_enabled=vector_storage_enabled,
            )
            execution_results = await module.apply_group(group=group, ctx=group_ctx)
            deltas = []
            out: list[AppliedToolCallResult] = []
            for execution_result in execution_results:
                row = rows_by_id.get(execution_result.tool_call_id)
                if row is None:
                    continue
                before = snapshot_tool_call_row(row)
                outcome = execution_result.outcome
                self._apply_execution_outcome(row, outcome)
                deltas.append(build_tool_call_delta(before, snapshot_tool_call_row(row)))
                out.append(
                    AppliedToolCallResult(
                        tool_call_id=row.id,
                        status=row.status,
                        child_thread_id=outcome.child_thread_id,
                        child_input_text=outcome.child_input_text,
                        image_run_id=outcome.image_run_id,
                    )
                )
            if deltas:
                apply_project_usage_deltas(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    deltas=deltas,
                    enforce_quota=True,
                )
            db.commit()
            for row in rows_by_id.values():
                db.refresh(row)
            return out
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            deltas = []
            out: list[AppliedToolCallResult] = []
            for item in group.items:
                row = db.query(RunToolCallModel).filter(RunToolCallModel.id == item.tool_call_id).first()
                if row is None:
                    continue
                before = snapshot_tool_call_row(row)
                self._mark_failed(row, str(exc))
                deltas.append(build_tool_call_delta(before, snapshot_tool_call_row(row)))
                out.append(AppliedToolCallResult(tool_call_id=row.id, status=row.status))
            if deltas:
                apply_project_usage_deltas(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    deltas=deltas,
                    enforce_quota=False,
                )
            db.commit()
            return out

    async def apply_tool_call_ids(
        self,
        db_factory: Callable[[], Session],
        *,
        thread_id: UUID,
        user_id: UUID,
        tool_call_ids: list[UUID],
    ) -> list[AppliedToolCallResult]:
        if not tool_call_ids:
            return []

        ordered_ids = list(dict.fromkeys(tool_call_ids))
        db = db_factory()
        try:
            thread = db.query(Thread).filter(Thread.id == thread_id, Thread.user_id == user_id).first()
            if thread is None:
                raise ValueError("Thread not found")

            settings = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
            preset_id = settings_service.get_active_preset_id(db, user_id)
            if preset_id is None:
                raise ValueError("No active preset configured")
            vector_storage_enabled = settings_service.is_vector_storage_enabled(db, user_id)

            locked_rows = (
                db.query(RunToolCallModel)
                .with_for_update()
                .filter(
                    RunToolCallModel.thread_id == thread.id,
                    RunToolCallModel.id.in_(ordered_ids),
                )
                .all()
            )
            row_by_id = {row.id: row for row in locked_rows}

            now = datetime.utcnow()
            for tool_call_id in ordered_ids:
                row = row_by_id.get(tool_call_id)
                if row is None:
                    continue
                if row.status not in {"pending", "validating", "streaming"}:
                    continue
                row.status = "processing"
                row.reason = None
                row.accepted_at = row.accepted_at or now
                row.updated_at = now
            db.commit()

            run_ids = {
                row.run_id
                for row in db.query(RunToolCallModel)
                .filter(
                    RunToolCallModel.thread_id == thread.id,
                    RunToolCallModel.id.in_(ordered_ids),
                )
                .all()
                if row.run_id is not None
            }
            runs_by_id = (
                {
                    run.id: run
                    for run in db.query(RunModel)
                    .filter(
                        RunModel.thread_id == thread.id,
                        RunModel.id.in_(run_ids),
                    )
                    .all()
                }
                if run_ids
                else {}
            )
            results_by_id: dict[UUID, AppliedToolCallResult] = {}

            for run_id, run in runs_by_id.items():
                run_rows = (
                    db.query(RunToolCallModel)
                    .filter(
                        RunToolCallModel.thread_id == thread.id,
                        RunToolCallModel.run_id == run_id,
                        RunToolCallModel.id.in_(ordered_ids),
                    )
                    .order_by(RunToolCallModel.call_seq.asc())
                    .all()
                )
                if not run_rows:
                    continue
                input_payload = run.input_payload if isinstance(run.input_payload, dict) else {}
                effective_project_id = run.project_id
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
                module_ctx = self.build_module_context(
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

                immediate_items: list[tuple[RunToolCallModel, ToolDecisionItem]] = []
                grouped_items: dict[tuple[str, str], list[ToolDecisionItem]] = {}
                run_row_by_id = {row.id: row for row in run_rows}

                for row in run_rows:
                    if row.status not in {"processing", "pending", "validating", "streaming"}:
                        results_by_id[row.id] = AppliedToolCallResult(
                            tool_call_id=row.id,
                            status=row.status,
                        )
                        continue

                    binding = offer.bindings_by_name.get(str(row.tool_name))
                    if binding is None:
                        before = snapshot_tool_call_row(row)
                        self._mark_failed(row, f"Tool not available in this session: {row.tool_name}")
                        apply_project_usage_delta(
                            db,
                            user_id=user_id,
                            project_id=effective_project_id,
                            delta=build_tool_call_delta(before, snapshot_tool_call_row(row)),
                            enforce_quota=False,
                        )
                        db.commit()
                        results_by_id[row.id] = AppliedToolCallResult(tool_call_id=row.id, status=row.status)
                        continue

                    args = row.arguments if isinstance(row.arguments, dict) else {}
                    extra_content = row.extra_content if isinstance(row.extra_content, dict) else {}
                    persisted = self._parse_persisted_meta(extra_content.get("__tool_meta"))
                    if persisted is None:
                        persisted = binding.build_persisted_meta(module_ctx, args)
                        row.extra_content = {**extra_content, "__tool_meta": persisted.__dict__}
                        db.flush()

                    item = ToolDecisionItem(
                        tool_call_id=row.id,
                        binding=binding,
                        args=args,
                        meta=persisted,
                        call_seq=int(row.call_seq or 0),
                    )
                    if persisted.merge_key:
                        grouped_items.setdefault((persisted.feature_key, persisted.merge_key), []).append(item)
                    else:
                        immediate_items.append((row, item))

                for row, item in immediate_items:
                    results_by_id[row.id] = await self._execute_immediate_item(
                        db,
                        thread=thread,
                        run=run,
                        settings=settings,
                        row=row,
                        item=item,
                        user_id=user_id,
                        project_id=effective_project_id,
                        language=run.language,
                        preset_id=preset_id,
                        input_payload=input_payload,
                        vector_storage_enabled=vector_storage_enabled,
                    )

                for (feature_key, merge_key), items in grouped_items.items():
                    group = ToolDecisionGroup(
                        feature_key=feature_key,
                        merge_key=merge_key,
                        items=tuple(sorted(items, key=lambda item: item.call_seq)),
                    )
                    group_results = await self._execute_group(
                        db,
                        thread=thread,
                        run=run,
                        settings=settings,
                        rows_by_id=run_row_by_id,
                        group=group,
                        user_id=user_id,
                        project_id=effective_project_id,
                        language=run.language,
                        preset_id=preset_id,
                        input_payload=input_payload,
                        vector_storage_enabled=vector_storage_enabled,
                    )
                    for result in group_results:
                        results_by_id[result.tool_call_id] = result

            return [
                results_by_id.get(tool_call_id, AppliedToolCallResult(tool_call_id=tool_call_id, status="failed"))
                for tool_call_id in ordered_ids
            ]
        finally:
            db.close()

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
            row = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
            if row is None:
                raise ValueError("Tool call not found")
            thread_id = row.thread_id
        finally:
            db.close()
        results = await self.apply_tool_call_ids(
            db_factory,
            thread_id=thread_id,
            user_id=user_id,
            tool_call_ids=[tool_call_id],
        )
        db = db_factory()
        try:
            row = db.query(RunToolCallModel).filter(RunToolCallModel.id == tool_call_id).first()
            return {"tool_call": row, "result": row.result if row is not None and isinstance(row.result, dict) else None}
        finally:
            db.close()

    async def propagate_child_terminal_state_to_parent(
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

    async def complete_parent_tool_call(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        emit: Callable[..., Awaitable[None]],
    ) -> None:
        await self.propagate_child_terminal_state_to_parent(
            db,
            thread=thread,
            run=run,
            emit=emit,
        )
