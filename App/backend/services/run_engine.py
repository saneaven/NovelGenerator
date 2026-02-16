from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..database import short_session
from ..models.db_models import RunMessageModel, RunModel, RunToolCallModel, SubAgentDefinitionModel
from ..providers.contracts import FinalSnapshot
from .auto_approve_policy_service import auto_approve_policy_service
from .credential_service import credential_service
from .llm_client import llm_client
from .prompt_runtime.conversation_builder import ConversationBuildOptions, conversation_builder
from .prompt_runtime.prompt_manager import prompt_manager
from .prompt_runtime.project_data_builder import build_project_data
from .run_context_builder import run_context_builder
from .run_event_emitter import RunEventContext, run_event_emitter
from .run_type_resolver import run_type_resolver
from .settings_service import settings_service
from .sidecar_client import sidecar_client
from .tool_call_executor import RawToolCall, get_tool_call_executor
from .tool_schemas import get_auto_approve_category


@dataclass
class StepResult:
    waiting_for_decision: bool
    completed: bool
    output_text: str | None = None
    pause_without_status_change: bool = False


class RunEngine:
    MAX_SUB_AGENT_DEPTH = 3

    def __init__(self) -> None:
        self._active_runs: dict[UUID, asyncio.Task] = {}
        self._run_locks: dict[UUID, asyncio.Lock] = {}

    def _run_lock(self, run_id: UUID) -> asyncio.Lock:
        lock = self._run_locks.get(run_id)
        if lock is None:
            lock = asyncio.Lock()
            self._run_locks[run_id] = lock
        return lock

    async def _launch_loop(self, run_id: UUID, user_id: UUID) -> None:
        existing = self._active_runs.get(run_id)
        if existing is not None and not existing.done():
            return

        async def _runner() -> None:
            try:
                await self._run_loop(run_id, user_id)
            except Exception as exc:
                error_text = str(exc)
                child_terminal_run_id: UUID | None = None
                with short_session() as db:
                    run = (
                        db.query(RunModel)
                        .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                        .with_for_update()
                        .first()
                    )
                    if run is not None and run.status not in {"completed", "cancelled"}:
                        run.status = "error"
                        run.error = error_text
                        db.commit()
                        event_ctx = RunEventContext.from_run(run)
                        await run_event_emitter.emit_status(event_ctx, "error", error=error_text)
                        await run_event_emitter.emit("run:error", event_ctx, {"error": error_text})
                        if run.run_type == "subAgent":
                            child_terminal_run_id = run.id
                if child_terminal_run_id is not None:
                    await self._handle_child_terminal_state(child_terminal_run_id, user_id, "error")
            finally:
                self._active_runs.pop(run_id, None)

        task = asyncio.create_task(_runner())
        self._active_runs[run_id] = task

    async def _ensure_project(self, db: Session, *, user_id: UUID, project_id: UUID) -> None:
        from ..models.db_models import Project

        project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
        if project is None:
            raise ValueError("Project not found")

    async def _freeze_context(self, db: Session, *, user_id: UUID, project_id: UUID, language: str) -> dict[str, Any]:
        preset_id = settings_service.get_active_preset_id(db, user_id)
        sub_agents = []
        if preset_id is not None:
            defs = (
                db.query(SubAgentDefinitionModel)
                .filter(
                    SubAgentDefinitionModel.user_id == user_id,
                    SubAgentDefinitionModel.preset_id == preset_id,
                    SubAgentDefinitionModel.enabled == True,
                )
                .all()
            )
            sub_agents = [
                {
                    "id": str(d.id),
                    "agent_name": d.agent_name,
                    "display_name": d.display_name,
                    "description": d.description,
                    "allowed_invocation_modes": d.allowed_invocation_modes,
                    "allowed_tool_names": d.allowed_tool_names,
                    "allowed_sub_agent_ids": d.allowed_sub_agent_ids,
                }
                for d in defs
            ]

        project_data = await build_project_data(db, project_id, language, sidecar_client)

        return {
            "project_data": project_data,
            "sub_agent_definitions": sub_agents,
            "settings_snapshot": {
                "agent": settings_service.get_task_config(db, user_id, "agent").__dict__,
                "subAgent": settings_service.get_task_config(db, user_id, "subAgent").__dict__,
            },
            "captured_at": datetime.utcnow().isoformat(),
        }

    async def start_run(self, user_id: UUID, project_id: UUID, req: Any) -> UUID:
        with short_session() as db:
            await self._ensure_project(db, user_id=user_id, project_id=project_id)

            run = RunModel(
                user_id=user_id,
                project_id=project_id,
                run_type=req.run_type,
                status="running",
                language=req.language,
                input_text=req.input_text or "",
                input_payload=getattr(req, "input_payload", {}) or {},
                final_output=None,
                error=None,
                agent_id=getattr(req, "agent_id", None),
                sub_agent_id=None,
                run_mode=getattr(req, "run_mode", None),
                surface=getattr(req, "surface", None),
                context_object_ids=list(getattr(req, "context_object_ids", []) or []),
                journey_kind=getattr(req, "journey_kind", None),
                journey_target_ids=list(getattr(req, "journey_target_ids", []) or []),
                parent_run_id=None,
                parent_run_message_id=None,
                parent_run_tool_call_id=None,
                next_message_seq=1,
            )

            if run.run_type == "agent":
                from ..models.db_models import Agent

                agent = (
                    db.query(Agent)
                    .filter(Agent.id == run.agent_id, Agent.project_id == project_id)
                    .with_for_update()
                    .first()
                )
                if agent is None:
                    raise ValueError("Agent not found")
                root_seq = int(getattr(agent, "next_root_run_seq", 1) or 1)
                agent.next_root_run_seq = root_seq + 1
                run.root_run_seq = root_seq

            run.frozen_context = await self._freeze_context(
                db,
                user_id=user_id,
                project_id=project_id,
                language=req.language,
            )

            db.add(run)
            db.flush()

            if run.input_text.strip():
                user_message = RunMessageModel(
                    run_id=run.id,
                    seq=run.next_message_seq,
                    role="user",
                    data={
                        run.language: {
                            "contentParts": [{"type": "content", "text": run.input_text}],
                            "thinkingDetails": [],
                        }
                    },
                )
                run.next_message_seq += 1
                db.add(user_message)

            db.commit()
            run_id = run.id

        with short_session() as db:
            created = db.query(RunModel).filter(RunModel.id == run_id).first()
            if created:
                await run_event_emitter.emit_status(RunEventContext.from_run(created), "running")

        await self._launch_loop(run_id, user_id)
        return run_id

    async def apply_decisions(self, user_id: UUID, run_id: UUID, req: Any) -> None:
        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("Run not found")

            executor = get_tool_call_executor(sidecar_client)
            applied = await executor.apply_tool_calls(
                db,
                run,
                req.message_id,
                req.decisions,
                req.options,
                run_engine=self,
            )

            event_ctx = RunEventContext.from_run(run)
            tool_rows = [
                {
                    "id": str(row.llm_call_id),
                    "tool_name": row.tool_name,
                    "status": row.status,
                    "reason": row.reason,
                    "failure_type": row.failure_type,
                    "result": row.result,
                }
                for row in applied.rows
            ]

            lines: list[str] = []
            for item in tool_rows:
                status = item["status"]
                if status == "accepted":
                    msg = (item.get("result") or {}).get("message") if isinstance(item.get("result"), dict) else None
                    lines.append(str(msg or f"{item['tool_name']}: accepted"))
                elif status == "rejected":
                    lines.append(f"{item['tool_name']}: rejected ({item.get('reason') or 'user'})")
                elif status == "failed":
                    lines.append(f"{item['tool_name']}: failed ({item.get('reason') or 'error'})")
                elif status == "running":
                    lines.append(f"{item['tool_name']}: running ({item.get('reason') or 'in progress'})")

            if lines:
                tool_message = RunMessageModel(
                    run_id=run.id,
                    seq=run.next_message_seq,
                    role="tool",
                    data={
                        run.language: {
                            "contentParts": [{"type": "content", "text": "\n".join(lines)}],
                            "thinkingDetails": [],
                        }
                    },
                )
                run.next_message_seq += 1
                db.add(tool_message)

            if run.status in {"waiting", "paused"}:
                run.status = "running"
            db.commit()

            await run_event_emitter.emit(
                "run:tool_calls_executed",
                event_ctx,
                {"message_id": str(req.message_id), "tool_calls": tool_rows},
            )

            if applied.subagent_finalize_output is not None and run.run_type == "subAgent":
                with short_session() as db2:
                    sub_run = (
                        db2.query(RunModel)
                        .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                        .with_for_update()
                        .first()
                    )
                    if sub_run is not None and sub_run.status not in {"completed", "cancelled"}:
                        sub_run.status = "completed"
                        sub_run.final_output = applied.subagent_finalize_output
                        db2.commit()
                        final_ctx = RunEventContext.from_run(sub_run)
                        await run_event_emitter.emit_status(final_ctx, "completed")
                        await run_event_emitter.emit("run:complete", final_ctx, {"final_output": sub_run.final_output or ""})
                        await self._handle_child_terminal_state(sub_run.id, user_id, "completed")
                return

            if applied.blocked_children:
                await run_event_emitter.emit("run:step_completed", event_ctx, {"should_continue": False})
                return

        await self._launch_loop(run_id, user_id)

    async def resume_run(self, user_id: UUID, run_id: UUID) -> None:
        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("Run not found")
            if run.status in {"paused", "waiting", "error"}:
                run.status = "running"
            db.commit()
            await run_event_emitter.emit_status(RunEventContext.from_run(run), run.status)

        await self._launch_loop(run_id, user_id)

    async def pause_run(self, user_id: UUID, run_id: UUID) -> None:
        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("Run not found")
            if run.status not in {"completed", "error", "cancelled"}:
                run.status = "paused"
            db.commit()
            await run_event_emitter.emit_status(RunEventContext.from_run(run), run.status)

    async def cancel_run(self, user_id: UUID, run_id: UUID) -> None:
        cancelled_child = False
        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("Run not found")
            if run.status not in {"completed", "error", "cancelled"}:
                run.status = "cancelled"
                cancelled_child = run.run_type == "subAgent"
            db.commit()
            await run_event_emitter.emit_status(RunEventContext.from_run(run), run.status)
        if cancelled_child:
            await self._handle_child_terminal_state(run_id, user_id, "cancelled")

    async def invoke_sub_agent(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        parent_run_id: UUID,
        parent_run_message_id: UUID,
        parent_run_tool_call_id: str,
        agent_id: UUID,
        sub_agent_id: UUID,
        language: str,
        input_text: str,
    ) -> dict[str, str]:
        depth = 0
        with short_session() as db:
            current = db.query(RunModel).filter(RunModel.id == parent_run_id, RunModel.user_id == user_id).first()
            while current is not None and current.parent_run_id is not None:
                depth += 1
                current = db.query(RunModel).filter(RunModel.id == current.parent_run_id, RunModel.user_id == user_id).first()
            if depth >= self.MAX_SUB_AGENT_DEPTH:
                raise ValueError("SubAgent depth exceeded")

        with short_session() as db:
            child_run = RunModel(
                user_id=user_id,
                project_id=project_id,
                run_type="subAgent",
                status="running",
                language=language,
                input_text=input_text,
                input_payload={},
                final_output=None,
                error=None,
                agent_id=agent_id,
                sub_agent_id=sub_agent_id,
                run_mode=None,
                surface=None,
                context_object_ids=[],
                journey_kind=None,
                journey_target_ids=[],
                parent_run_id=parent_run_id,
                parent_run_message_id=parent_run_message_id,
                parent_run_tool_call_id=parent_run_tool_call_id,
                next_message_seq=1,
                frozen_context=await self._freeze_context(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    language=language,
                ),
            )
            db.add(child_run)
            db.flush()

            child_user_message = RunMessageModel(
                run_id=child_run.id,
                seq=child_run.next_message_seq,
                role="user",
                data={
                    language: {
                        "contentParts": [{"type": "content", "text": input_text}],
                        "thinkingDetails": [],
                    }
                },
            )
            child_run.next_message_seq += 1
            db.add(child_user_message)
            db.commit()
            child_id = child_run.id

        with short_session() as db:
            parent = db.query(RunModel).filter(RunModel.id == parent_run_id, RunModel.user_id == user_id).first()
            child = db.query(RunModel).filter(RunModel.id == child_id, RunModel.user_id == user_id).first()
            if parent and child:
                parent_ctx = RunEventContext.from_run(parent)
                child_ctx = RunEventContext.from_run(child)
                await run_event_emitter.emit("run:child_start", parent_ctx, {"child_run_id": str(child.id), "sub_agent_id": str(sub_agent_id)})
                await run_event_emitter.emit_status(child_ctx, "running")

        await self._run_loop(child_id, user_id)

        with short_session() as db:
            child = db.query(RunModel).filter(RunModel.id == child_id, RunModel.user_id == user_id).first()
            parent = db.query(RunModel).filter(RunModel.id == parent_run_id, RunModel.user_id == user_id).first()
            if child is None:
                raise ValueError("Sub-agent run not found")

            if child.status == "waiting":
                if parent is not None:
                    parent_ctx = RunEventContext.from_run(parent)
                    await run_event_emitter.emit(
                        "run:child_waiting",
                        parent_ctx,
                        {
                            "child_run_id": str(child.id),
                            "parent_run_tool_call_id": parent_run_tool_call_id,
                            "parent_message_id": str(parent_run_message_id),
                        },
                    )
                return {"kind": "waiting", "child_run_id": str(child.id)}

            if parent is not None:
                parent_ctx = RunEventContext.from_run(parent)
                await run_event_emitter.emit(
                    "run:child_end",
                    parent_ctx,
                    {"child_run_id": str(child.id), "output": child.final_output or ""},
                )

            if child.status != "completed":
                return {
                    "kind": "failed",
                    "child_run_id": str(child.id),
                    "error": child.error or f"Sub-agent run ended with status {child.status}",
                }
            return {"kind": "completed", "child_run_id": str(child.id), "output": child.final_output or ""}

    async def _handle_child_terminal_state(self, child_run_id: UUID, user_id: UUID, terminal_status: str) -> None:
        parent_run_id: UUID | None = None
        with short_session() as db:
            child = (
                db.query(RunModel)
                .filter(RunModel.id == child_run_id, RunModel.user_id == user_id, RunModel.run_type == "subAgent")
                .first()
            )
            if child is None:
                return
            if child.parent_run_id is None or child.parent_run_message_id is None or not child.parent_run_tool_call_id:
                return
            parent_run_id = child.parent_run_id

            parent = (
                db.query(RunModel)
                .filter(RunModel.id == child.parent_run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if parent is None:
                return

            call_row = (
                db.query(RunToolCallModel)
                .filter(
                    RunToolCallModel.run_id == parent.id,
                    RunToolCallModel.message_id == child.parent_run_message_id,
                    RunToolCallModel.llm_call_id == child.parent_run_tool_call_id,
                )
                .with_for_update()
                .first()
            )
            if call_row is None:
                return

            updated = False
            if call_row.status == "running" and (call_row.reason or "").startswith("CHILD_WAITING::"):
                if terminal_status == "completed":
                    call_row.status = "accepted"
                    call_row.failure_type = None
                    call_row.reason = None
                    call_row.result = {
                        "success": True,
                        "message": child.final_output or "",
                        "data": {"child_run_id": str(child.id), "sub_agent_id": str(child.sub_agent_id) if child.sub_agent_id else None},
                    }
                    call_row.accepted_at = datetime.utcnow()
                else:
                    call_row.status = "failed"
                    call_row.failure_type = "execution"
                    call_row.reason = f"EXECUTION::call_sub_agent::{terminal_status}"
                    call_row.result = {"success": False, "message": child.error or f"Sub-agent {terminal_status}"}
                    call_row.accepted_at = None
                call_row.updated_at = datetime.utcnow()

                summary_text = ""
                if call_row.status == "accepted":
                    summary_text = str((call_row.result or {}).get("message") or f"{call_row.tool_name}: accepted")
                elif call_row.status == "failed":
                    summary_text = f"{call_row.tool_name}: failed ({call_row.reason or 'error'})"

                if summary_text:
                    tool_message = RunMessageModel(
                        run_id=parent.id,
                        seq=parent.next_message_seq,
                        role="tool",
                        data={
                            parent.language: {
                                "contentParts": [{"type": "content", "text": summary_text}],
                                "thinkingDetails": [],
                            }
                        },
                    )
                    parent.next_message_seq += 1
                    db.add(tool_message)
                updated = True

            db.commit()

            if not updated:
                return

            parent_ctx = RunEventContext.from_run(parent)
            await run_event_emitter.emit(
                "run:child_end",
                parent_ctx,
                {"child_run_id": str(child.id), "output": child.final_output or ""},
            )
            await run_event_emitter.emit(
                "run:tool_calls_executed",
                parent_ctx,
                {
                    "message_id": str(child.parent_run_message_id),
                    "tool_calls": [
                        {
                            "id": str(call_row.llm_call_id),
                            "tool_name": call_row.tool_name,
                            "status": call_row.status,
                            "reason": call_row.reason,
                            "failure_type": call_row.failure_type,
                            "result": call_row.result,
                        }
                    ],
                },
            )

        if parent_run_id is not None:
            await self._launch_loop(parent_run_id, user_id)

    async def _run_loop(self, run_id: UUID, user_id: UUID) -> None:
        lock = self._run_lock(run_id)
        async with lock:
            while True:
                with short_session() as db:
                    run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == user_id).first()
                    if run is None:
                        return
                    if run.status in {"completed", "error", "cancelled"}:
                        return
                    if run.status in {"waiting", "paused"}:
                        return

                step = await self._execute_step(run_id, user_id)

                if step.pause_without_status_change:
                    with short_session() as db:
                        run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == user_id).first()
                        if run is not None:
                            await run_event_emitter.emit("run:step_completed", RunEventContext.from_run(run), {"should_continue": False})
                    return

                if step.waiting_for_decision:
                    with short_session() as db:
                        run = (
                            db.query(RunModel)
                            .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                            .with_for_update()
                            .first()
                        )
                        if run is None:
                            return
                        run.status = "waiting"
                        db.commit()
                        event_ctx = RunEventContext.from_run(run)
                        await run_event_emitter.emit_status(event_ctx, "waiting")
                        await run_event_emitter.emit("run:step_completed", event_ctx, {"should_continue": False})
                    return

                if step.completed:
                    with short_session() as db:
                        run = (
                            db.query(RunModel)
                            .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                            .with_for_update()
                            .first()
                        )
                        if run is None:
                            return
                        if run.status == "completed":
                            return
                        run.status = "completed"
                        run.final_output = step.output_text or ""
                        db.commit()
                        event_ctx = RunEventContext.from_run(run)
                        await run_event_emitter.emit_status(event_ctx, "completed")
                        await run_event_emitter.emit("run:complete", event_ctx, {"final_output": run.final_output})
                        if run.run_type == "subAgent":
                            await self._handle_child_terminal_state(run.id, user_id, "completed")
                    return

                with short_session() as db:
                    run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == user_id).first()
                    if run is not None:
                        await run_event_emitter.emit("run:step_completed", RunEventContext.from_run(run), {"should_continue": True})

    def _build_auto_decisions(self, staged_rows: list[RunToolCallModel], policy: dict[str, bool]) -> dict[str, str] | None:
        pending = [row for row in staged_rows if row.status == "pending"]
        if not pending:
            return None

        decisions: dict[str, str] = {}
        for row in pending:
            category = get_auto_approve_category(row.tool_name)
            if category is None or not bool(policy.get(category, False)):
                return None
            decisions[row.llm_call_id] = "accept"
        return decisions

    async def _execute_step(self, run_id: UUID, user_id: UUID) -> StepResult:
        with short_session() as db:
            run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == user_id).first()
            if run is None:
                raise ValueError("Run not found")
            event_ctx = RunEventContext.from_run(run)

            cfg = await run_type_resolver.resolve(db, run, user_id)
            provider_config = credential_service.get_provider_config(db, user_id, cfg.provider)
            cfg.provider_config = provider_config
            cfg.sidecar_client = sidecar_client  # type: ignore[attr-defined]

            ctx = await run_context_builder.build(db, run, cfg)
            bundle = await prompt_manager.generate_prompt_bundle(db, cfg, ctx.prompt_context, user_id, cfg.preset_id)
            settings = settings_service._get_settings(db, user_id)  # internal helper use for limits
            tool_limit = int(getattr(settings, "tool_call_history_limit", 5) or 5)
            thinking_limit = int(getattr(settings, "thinking_history_limit", 5) or 5)
            blocks = conversation_builder.build_conversation_blocks(
                ctx.history,
                bundle,
                ConversationBuildOptions(tool_call_history_limit=tool_limit, thinking_history_limit=thinking_limit, include_prefill=True),
            )

        delta_seq = 0

        async def _on_delta(delta: Any) -> None:
            nonlocal delta_seq
            delta_seq += 1
            await run_event_emitter.emit(
                "run:llm_delta",
                event_ctx,
                {
                    "seq": delta_seq,
                    "content_delta": delta.content_delta,
                    "thinking_delta": delta.thinking_delta,
                    "tool_call_deltas": delta.tool_call_deltas,
                    "thinking_details_delta": delta.thinking_details_delta,
                },
            )

        stream_result = await llm_client.stream_and_collect(
            provider=cfg.provider,
            provider_config=cfg.provider_config,
            model=cfg.model,
            messages=blocks,
            temperature=cfg.temperature,
            tools=[{"name": t.name, "description": t.description, "parameters": t.parameters} for t in cfg.tools] or None,
            max_tokens=cfg.max_output_tokens,
            thinking_mode=cfg.thinking_mode,
            thinking_config=cfg.thinking_config,
            thinking_format=cfg.thinking_format,
            request_format=cfg.request_format,
            provider_preference=None,
            tool_choice="auto",
            retry_config=cfg.retry_config,
            native_tool_call=False,
            on_delta=_on_delta,
        )

        snapshot: FinalSnapshot = stream_result.snapshot

        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("Run not found")

            assistant_message = RunMessageModel(
                run_id=run.id,
                seq=run.next_message_seq,
                role="assistant",
                data={
                    run.language: {
                        "contentParts": snapshot.content_parts,
                        "thinkingDetails": snapshot.thinking_details,
                    }
                },
            )
            run.next_message_seq += 1
            db.add(assistant_message)
            db.flush()

            await run_event_emitter.emit(
                "run:llm_final",
                RunEventContext.from_run(run),
                {
                    "message_id": str(assistant_message.id),
                    "content_parts": snapshot.content_parts,
                    "thinking_details": snapshot.thinking_details,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "tool_name": tc.tool_name,
                            "arguments": tc.arguments,
                        }
                        for tc in snapshot.tool_calls
                    ],
                },
            )

            if snapshot.tool_calls:
                executor = get_tool_call_executor(sidecar_client)
                staged = await executor.stage_tool_calls(
                    db,
                    run,
                    [RawToolCall(llm_call_id=tc.id, tool_name=tc.tool_name, arguments=tc.arguments) for tc in snapshot.tool_calls],
                    cfg.allowed_tool_names,
                    {t.name: t for t in cfg.tools},
                    rag_search_enabled=settings_service.get_rag_settings(db, run.user_id).enabled,
                )

                staged_rows: list[RunToolCallModel] = []
                for item in staged:
                    row = RunToolCallModel(
                        run_id=run.id,
                        message_id=assistant_message.id,
                        call_seq=item.call_seq,
                        llm_call_id=item.llm_call_id,
                        tool_name=item.tool_name,
                        arguments=item.arguments,
                        status=item.status,
                        failure_type=item.failure_type,
                        reason=item.reason,
                        result=None,
                    )
                    db.add(row)
                    staged_rows.append(row)

                db.flush()

                await run_event_emitter.emit(
                    "run:tool_calls",
                    RunEventContext.from_run(run),
                    {
                        "message_id": str(assistant_message.id),
                        "tool_calls": [
                            {
                                "id": row.llm_call_id,
                                "tool_name": row.tool_name,
                                "arguments": row.arguments,
                                "status": row.status,
                                "failure_type": row.failure_type,
                                "reason": row.reason,
                            }
                            for row in staged_rows
                        ],
                    },
                )

                policy = auto_approve_policy_service.get_effective_policy(db, run.user_id, override=None)
                auto_decisions = self._build_auto_decisions(staged_rows, policy)

                if auto_decisions:
                    applied = await executor.apply_tool_calls(
                        db,
                        run,
                        assistant_message.id,
                        auto_decisions,
                        {
                            "create_new_version": cfg.handler_default_options.create_new_version,
                            "user_request": cfg.handler_default_options.user_request,
                        },
                        run_engine=self,
                    )

                    tool_rows = [
                        {
                            "id": str(row.llm_call_id),
                            "tool_name": row.tool_name,
                            "status": row.status,
                            "reason": row.reason,
                            "failure_type": row.failure_type,
                            "result": row.result,
                        }
                        for row in applied.rows
                    ]
                    await run_event_emitter.emit(
                        "run:tool_calls_executed",
                        RunEventContext.from_run(run),
                        {"message_id": str(assistant_message.id), "tool_calls": tool_rows},
                    )

                    # append tool message
                    lines = []
                    for item in tool_rows:
                        if item["status"] == "accepted":
                            msg = (item.get("result") or {}).get("message") if isinstance(item.get("result"), dict) else None
                            lines.append(str(msg or f"{item['tool_name']}: accepted"))
                        elif item["status"] == "rejected":
                            lines.append(f"{item['tool_name']}: rejected ({item.get('reason') or 'user'})")
                        elif item["status"] == "failed":
                            lines.append(f"{item['tool_name']}: failed ({item.get('reason') or 'error'})")
                        elif item["status"] == "running":
                            lines.append(f"{item['tool_name']}: running ({item.get('reason') or 'in progress'})")

                    if lines:
                        tool_message = RunMessageModel(
                            run_id=run.id,
                            seq=run.next_message_seq,
                            role="tool",
                            data={
                                run.language: {
                                    "contentParts": [{"type": "content", "text": "\n".join(lines)}],
                                    "thinkingDetails": [],
                                }
                            },
                        )
                        run.next_message_seq += 1
                        db.add(tool_message)
                    if applied.subagent_finalize_output is not None and run.run_type == "subAgent":
                        run.status = "completed"
                        run.final_output = applied.subagent_finalize_output
                        db.commit()
                        sub_ctx = RunEventContext.from_run(run)
                        await run_event_emitter.emit_status(sub_ctx, "completed")
                        await run_event_emitter.emit("run:complete", sub_ctx, {"final_output": run.final_output or ""})
                        await self._handle_child_terminal_state(run.id, user_id, "completed")
                        return StepResult(waiting_for_decision=False, completed=True, output_text=run.final_output or "")

                    if applied.blocked_children:
                        db.commit()
                        return StepResult(waiting_for_decision=False, completed=False, pause_without_status_change=True)

                    db.commit()
                    return StepResult(waiting_for_decision=False, completed=False)

                db.commit()
                return StepResult(waiting_for_decision=True, completed=False)

            output = "".join(str(part.get("text") or "") for part in snapshot.content_parts if part.get("type") == "content")
            if run.run_type == "subAgent":
                # Sub-agent completion must be explicit via return_sub_agent_result.
                db.commit()
                raise ValueError("Sub-agent must call return_sub_agent_result before completion")

            db.commit()
            return StepResult(waiting_for_decision=False, completed=True, output_text=output)


run_engine = RunEngine()
