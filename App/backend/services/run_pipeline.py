"""Core run pipeline — identical for agent / subAgent / journey.

Implements the user's spec:
  dispatch()  → single entry point (start or resume)
  resume()    → explicit resume after tool decisions
  _pipeline_loop() → capture/reuse history → memory+cut → LLM → tool staging
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, replace as dc_replace
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ..database import short_session
from ..models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread
from ..providers.contracts import FinalSnapshot
from .credential_service import credential_service
from .history_service import history_service
from .llm_client import llm_client
from .memory_service import search_memory
from .prompt_runtime.conversation_builder import ConversationBuildOptions, conversation_builder
from .prompt_runtime.prompt_manager import prompt_manager
from .run_event_emitter import RunEventContext, run_event_emitter
from .run_type_resolver import ResolvedRunConfig, run_type_resolver
from .settings_service import settings_service
from .sidecar_client import sidecar_client
from .summary_service import SummaryMessage, summary_service
from .token_count_service import count_text_tokens
from .tool_call_executor import RawToolCall, get_tool_call_executor

logger = logging.getLogger(__name__)


@dataclass
class StepResult:
    waiting_for_decision: bool
    completed: bool
    output_text: str | None = None


class RunPipeline:
    MAX_CONTEXT_CUT_ITERATIONS = 6

    def __init__(self) -> None:
        self._active_tasks: dict[UUID, asyncio.Task] = {}
        self._run_locks: dict[UUID, asyncio.Lock] = {}

    def _run_lock(self, run_id: UUID) -> asyncio.Lock:
        lock = self._run_locks.get(run_id)
        if lock is None:
            lock = asyncio.Lock()
            self._run_locks[run_id] = lock
        return lock

    # ── Public API ──

    async def dispatch(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        thread: Thread,
        input_text: str,
        language: str,
        run_mode: str | None = None,
        surface: str | None = None,
        context_object_ids: list[str] | None = None,
        input_payload: dict[str, Any] | None = None,
        journey_target_ids: list[str] | None = None,
        client_message_id: str | None = None,
    ) -> UUID:
        """Single entry point. Creates a new run with a user message."""
        trimmed_input = input_text.strip()
        if not trimmed_input:
            raise ValueError("Dispatch requires non-empty input_text")

        with short_session() as db:
            db.add(thread)

            run_seq = int(thread.next_run_seq or 1)
            thread.next_run_seq = run_seq + 1

            run = RunModel(
                thread_id=thread.id,
                user_id=user_id,
                project_id=project_id,
                status="running",
                run_seq=run_seq,
                language=language,
                input_text=trimmed_input,
                input_payload=input_payload or {},
                run_mode=run_mode,
                surface=surface,
                context_object_ids=list(context_object_ids or []),
                journey_target_ids=list(journey_target_ids or []),
                next_message_seq=1,
            )
            db.add(run)
            db.flush()

            msg_seq = run.next_message_seq
            user_msg = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=msg_seq,
                seq_in_thread=self._next_thread_seq(db, thread),
                role="user",
                data={
                    language: {
                        "contentParts": [{"type": "content", "text": run.input_text}],
                        "thinkingDetails": [],
                    }
                },
            )
            run.next_message_seq = msg_seq + 1
            db.add(user_msg)

            thread.status = "running"
            db.commit()

            run_id = run.id
            event_ctx = RunEventContext.from_run(run)
            user_message_payload = {
                "id": str(user_msg.id),
                "thread_id": str(user_msg.thread_id),
                "seq": int(user_msg.seq),
                "seq_in_thread": int(user_msg.seq_in_thread) if user_msg.seq_in_thread is not None else None,
                "role": str(user_msg.role),
                "data": user_msg.data or {},
                "created_at": user_msg.created_at.isoformat() if user_msg.created_at else datetime.now(timezone.utc).isoformat(),
            }

        await run_event_emitter.emit_status(event_ctx, "running")
        await run_event_emitter.emit(
            "thread:user_message_created",
            event_ctx,
            {
                "client_message_id": client_message_id,
                "message": user_message_payload,
            },
        )
        await self._launch_loop(run_id, user_id)
        return run_id

    async def resume(self, *, user_id: UUID, thread_id: UUID) -> None:
        """Resume the latest run on a thread, regardless of current status."""
        with short_session() as db:
            thread = db.query(Thread).filter(
                Thread.id == thread_id, Thread.user_id == user_id,
            ).with_for_update().first()
            if thread is None:
                raise ValueError("Thread not found")

            run = (
                db.query(RunModel)
                .filter(RunModel.thread_id == thread_id)
                .order_by(RunModel.run_seq.desc().nullslast())
                .first()
            )
            if run is None:
                raise ValueError("No run found for this thread")

            # Already running — no-op
            if run.status == "running":
                return

            # Check for non-terminal children before resuming
            running_children = (
                db.query(RunToolCallModel)
                .filter(RunToolCallModel.run_id == run.id, RunToolCallModel.status == "running")
                .count()
            )
            if running_children > 0:
                return  # Children still running — don't resume yet

            run_id = run.id
            event_ctx = RunEventContext.from_run(run)

            run.status = "running"
            thread.status = "running"
            db.commit()

        await run_event_emitter.emit_status(event_ctx, "running")
        await self._launch_loop(run_id, user_id)

    async def apply_decisions(
        self,
        *,
        user_id: UUID,
        thread_id: UUID,
        message_id: UUID,
        decisions: dict[str, str],
        options: dict[str, Any] | None = None,
    ) -> dict:
        """Apply user tool-call decisions. Returns tool call results for the frontend."""
        with short_session() as db:
            thread = db.query(Thread).filter(
                Thread.id == thread_id, Thread.user_id == user_id,
            ).first()
            if thread is None:
                raise ValueError("Thread not found")

            run = (
                db.query(RunModel)
                .filter(
                    RunModel.thread_id == thread_id,
                    RunModel.status.in_(["waiting", "running", "paused"]),
                )
                .order_by(RunModel.run_seq.desc().nullslast())
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("No active run found")

            executor = get_tool_call_executor(sidecar_client)
            applied = await executor.apply_tool_calls(
                db, run, message_id, decisions, options,
            )

            run_id = run.id
            event_ctx = RunEventContext.from_run(run)
            tool_rows = [
                {
                    "id": str(row.llm_call_id),
                    "tool_name": row.tool_name,
                    "status": row.status,
                    "reason": row.reason,
                    "result": row.result,
                    "child_thread_id": str(row.child_thread_id) if row.child_thread_id else None,
                    "child_run_id": str(row.child_run_id) if row.child_run_id else None,
                }
                for row in applied.rows
            ]

            # Build tool result message
            lines: list[str] = []
            for item in tool_rows:
                status = item["status"]
                if status == "accepted":
                    msg = (item.get("result") or {}).get("message") if isinstance(item.get("result"), dict) else None
                    lines.append(str(msg or f"{item['tool_name']}: accepted"))
                elif status == "rejected":
                    lines.append(f"{item['tool_name']}: rejected ({item.get('reason') or 'user'})")
                elif status == "cancelled":
                    lines.append(f"{item['tool_name']}: cancelled ({item.get('reason') or 'error'})")
                elif status == "running":
                    lines.append(f"{item['tool_name']}: running ({item.get('reason') or 'in progress'})")

            if lines:
                tool_message = RunMessageModel(
                    thread_id=thread.id,
                    run_id=run_id,
                    seq=run.next_message_seq,
                    seq_in_thread=self._next_thread_seq(db, thread),
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

            db.commit()

        await run_event_emitter.emit(
            "thread:tool_calls_executed", event_ctx,
            {"message_id": str(message_id), "tool_calls": tool_rows},
        )

        # Launch child pipelines for any call_sub_agent that returned "running"
        for row_info in tool_rows:
            if row_info["status"] == "running":
                await self._launch_child_if_needed(user_id, thread_id, message_id, row_info["id"])

        await self._emit_tools_all_terminal_if_ready(
            run_id=run_id,
            user_id=user_id,
            target_message_id=message_id,
        )

        return {"tool_calls": tool_rows}

    async def pause(self, *, user_id: UUID, thread_id: UUID) -> None:
        with short_session() as db:
            thread = db.query(Thread).filter(
                Thread.id == thread_id, Thread.user_id == user_id,
            ).with_for_update().first()
            if thread is None:
                raise ValueError("Thread not found")

            run = (
                db.query(RunModel)
                .filter(RunModel.thread_id == thread_id, RunModel.status.in_(["running", "waiting"]))
                .order_by(RunModel.run_seq.desc().nullslast())
                .with_for_update()
                .first()
            )
            if run is not None:
                run.status = "paused"
            thread.status = "paused"
            db.commit()

            if run is not None:
                await run_event_emitter.emit_status(RunEventContext.from_run(run), "paused")

    async def cancel(self, *, user_id: UUID, thread_id: UUID) -> None:
        with short_session() as db:
            thread = db.query(Thread).filter(
                Thread.id == thread_id, Thread.user_id == user_id,
            ).with_for_update().first()
            if thread is None:
                raise ValueError("Thread not found")

            run = (
                db.query(RunModel)
                .filter(
                    RunModel.thread_id == thread_id,
                    RunModel.status.notin_(["completed", "cancelled"]),
                )
                .order_by(RunModel.run_seq.desc().nullslast())
                .with_for_update()
                .first()
            )
            is_child_run = run is not None and run.parent_run_id is not None
            if run is not None:
                run.status = "cancelled"
            thread.status = "idle"
            db.commit()

            if run is not None:
                if is_child_run:
                    await self._handle_child_terminal(run.id, user_id, "cancelled")
                await run_event_emitter.emit_status(RunEventContext.from_run(run), "cancelled")

    # ── Thread-seq helper ──

    @staticmethod
    def _next_thread_seq(db: Session, thread: Thread) -> int:
        """Compute next seq_in_thread by counting existing messages."""
        from sqlalchemy import func
        max_seq = (
            db.query(func.max(RunMessageModel.seq_in_thread))
            .filter(RunMessageModel.thread_id == thread.id)
            .scalar()
        )
        return (max_seq or 0) + 1

    # ── Task management ──

    async def _launch_loop(self, run_id: UUID, user_id: UUID) -> None:
        existing = self._active_tasks.get(run_id)
        if existing is not None and not existing.done():
            return

        async def _runner() -> None:
            try:
                await self._run_loop(run_id, user_id)
            except Exception as exc:
                logger.exception(
                    "Run loop failed",
                    extra={"run_id": str(run_id), "user_id": str(user_id)},
                )
                error_text = str(exc).strip() or f"{exc.__class__.__name__}: unknown error"
                await self._handle_run_error(run_id, user_id, error_text)
            finally:
                self._active_tasks.pop(run_id, None)

        task = asyncio.create_task(_runner())
        self._active_tasks[run_id] = task

    async def _handle_run_error(self, run_id: UUID, user_id: UUID, error_text: str) -> None:
        is_child_run = False
        normalized_error = (error_text or "").strip() or "Run failed with unknown error."
        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is not None and run.status not in {"completed", "cancelled"}:
                run.status = "error"
                run.error = normalized_error
                thread = db.query(Thread).filter(Thread.id == run.thread_id).with_for_update().first()
                if thread is not None:
                    thread.status = "error"
                is_child_run = run.parent_run_id is not None
                db.commit()
                event_ctx = RunEventContext.from_run(run)
                if is_child_run:
                    await self._handle_child_terminal(run.id, user_id, "error")
                await run_event_emitter.emit_status(event_ctx, "error", error=normalized_error)
                await run_event_emitter.emit("thread:error", event_ctx, {"error": normalized_error})

    # ── Main loop ──

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
                        thread = db.query(Thread).filter(Thread.id == run.thread_id).with_for_update().first()
                        if thread is not None:
                            thread.status = "waiting_tools"
                        db.commit()
                        event_ctx = RunEventContext.from_run(run)
                        await run_event_emitter.emit_status(event_ctx, "waiting")
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
                        run.status = "completed"
                        run.final_output = step.output_text or ""
                        thread = db.query(Thread).filter(Thread.id == run.thread_id).with_for_update().first()
                        if thread is not None:
                            thread.status = "idle"
                        db.commit()
                        event_ctx = RunEventContext.from_run(run)
                        if run.parent_run_id is not None:
                            await self._handle_child_terminal(run.id, user_id, "completed")
                        await run_event_emitter.emit_status(event_ctx, "completed")
                        await run_event_emitter.emit("thread:complete", event_ctx, {"final_output": run.final_output})
                    return

                # step returned no tool calls and not completed — continue looping

    # ── Execute single LLM step ──

    async def _execute_step(self, run_id: UUID, user_id: UUID) -> StepResult:
        with short_session() as db:
            run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == user_id).first()
            if run is None:
                raise ValueError("Run not found")

            thread = run.thread
            event_ctx = RunEventContext.from_run(run)

            cfg = await run_type_resolver.resolve(db, run, user_id)
            provider_config = credential_service.get_provider_config(db, user_id, cfg.provider)
            cfg.provider_config = provider_config
            cfg.sidecar_client = sidecar_client  # type: ignore[attr-defined]

            # Build history: capture/reuse previous runs, then append current run messages.
            captured = history_service.resolve(db, thread, run, run.language)
            current_msgs = history_service.build_current_run_messages(db, run, run.language)
            all_history = captured.messages + current_msgs

            # Build prompt bundle & conversation blocks
            memory_context = await self._build_memory_context(db, run, thread, cfg, all_history)
            prompt_context = self._build_prompt_context(db, run, thread, memory_context)
            bundle = await prompt_manager.generate_prompt_bundle(db, cfg, prompt_context, user_id, cfg.preset_id)
            thread.captured_history_system_prompt = bundle.system_prompt
            thread.captured_history_prefill = bundle.prefill
            db.flush()

            settings = settings_service._get_settings(db, user_id)
            tool_limit = int(getattr(settings, "tool_call_history_limit", 5) or 5)
            thinking_limit = int(getattr(settings, "thinking_history_limit", 5) or 5)

            build_opts = ConversationBuildOptions(
                tool_call_history_limit=tool_limit,
                thinking_history_limit=thinking_limit,
                include_prefill=True,
            )

            blocks = await self._memory_and_cut_loop(
                db, user_id, run, thread, cfg, all_history, bundle, build_opts,
            )

            tool_specs = [
                {"name": t.name, "description": t.description, "parameters": t.parameters}
                for t in cfg.tools
            ] or None
            await run_event_emitter.emit(
                "thread:prompt_prepared",
                event_ctx,
                {
                    "provider": cfg.provider,
                    "model": cfg.model,
                    "request": {
                        "messages": blocks,
                        "tools": tool_specs,
                        "temperature": cfg.temperature,
                        "max_tokens": cfg.max_output_tokens,
                        "thinking_mode": cfg.thinking_mode,
                        "thinking_config": cfg.thinking_config,
                        "thinking_format": cfg.thinking_format,
                        "request_format": cfg.request_format,
                        "tool_choice": "auto",
                        "native_tool_call": False,
                    },
                    "rendered_prompts": {
                        "system_prompt": bundle.system_prompt,
                        "memory_prompt": bundle.memory_prompt,
                        "prefill": bundle.prefill,
                    },
                },
            )

        # Stream LLM
        delta_seq = 0

        async def _on_delta(delta: Any) -> None:
            nonlocal delta_seq
            delta_seq += 1
            await run_event_emitter.emit(
                "thread:llm_delta",
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
            tools=tool_specs,
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

        # Save assistant message + handle tool calls
        with short_session() as db:
            run = (
                db.query(RunModel)
                .filter(RunModel.id == run_id, RunModel.user_id == user_id)
                .with_for_update()
                .first()
            )
            if run is None:
                raise ValueError("Run not found")

            thread = run.thread

            assistant_message = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=run.next_message_seq,
                seq_in_thread=self._next_thread_seq(db, thread),
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
                "thread:llm_final",
                event_ctx,
                {
                    "message_id": str(assistant_message.id),
                    "language": run.language,
                    "content_parts": snapshot.content_parts,
                    "thinking_details": snapshot.thinking_details,
                    "tool_calls": [
                        {"id": tc.id, "tool_name": tc.tool_name, "arguments": tc.arguments}
                        for tc in snapshot.tool_calls
                    ],
                },
            )

            if snapshot.tool_calls:
                return await self._handle_tool_calls(
                    db, run, thread, assistant_message, snapshot, cfg, user_id, event_ctx,
                )

            # No tool calls — completed
            output = "".join(
                str(part.get("text") or "")
                for part in snapshot.content_parts
                if part.get("type") == "content"
            )
            db.commit()
            return StepResult(waiting_for_decision=False, completed=True, output_text=output)

    async def _handle_tool_calls(
        self,
        db: Session,
        run: RunModel,
        thread: Thread,
        assistant_message: RunMessageModel,
        snapshot: FinalSnapshot,
        cfg: ResolvedRunConfig,
        user_id: UUID,
        event_ctx: RunEventContext,
    ) -> StepResult:
        """Stage tool calls, auto-approve if policy allows, return step result."""
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
                thread_id=thread.id,
                run_id=run.id,
                message_id=assistant_message.id,
                call_seq=item.call_seq,
                llm_call_id=item.llm_call_id,
                tool_name=item.tool_name,
                arguments=item.arguments,
                status=item.status,
                reason=item.reason,
                result=None,
            )
            db.add(row)
            staged_rows.append(row)

        db.flush()

        await run_event_emitter.emit(
            "thread:tool_calls",
            event_ctx,
            {
                "message_id": str(assistant_message.id),
                "tool_calls": [
                    {
                        "id": row.llm_call_id,
                        "tool_name": row.tool_name,
                        "arguments": row.arguments,
                        "status": row.status,
                        "reason": row.reason,
                    }
                    for row in staged_rows
                ],
            },
        )

        # Always wait for frontend decisions (auto-approve handled by frontend)
        db.commit()
        return StepResult(waiting_for_decision=True, completed=False)

    # ── Memory & Context Cut Loop ──

    @staticmethod
    def _serialize_blocks_for_counting(blocks: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for block in blocks:
            role = str(block.get("role") or "")
            lines.append(f"[{role}]")
            parts = block.get("content_parts")
            if isinstance(parts, list):
                for part in parts:
                    if isinstance(part, dict):
                        text = part.get("text")
                        if isinstance(text, str) and text:
                            lines.append(text)
            tool_calls = block.get("tool_calls")
            if isinstance(tool_calls, list):
                for tc in tool_calls:
                    if isinstance(tc, dict):
                        function = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                        name = function.get("name")
                        args = function.get("arguments")
                        if isinstance(name, str) and name:
                            lines.append(f"tool:{name}")
                        if isinstance(args, str) and args:
                            lines.append(args)
                        elif isinstance(args, dict):
                            lines.append(json.dumps(args, ensure_ascii=False, separators=(",", ":")))
        return "\n".join(lines)

    async def _count_prompt_tokens(
        self,
        *,
        db: Session,
        user_id: UUID,
        blocks: list[dict[str, Any]],
        cfg: ResolvedRunConfig,
    ) -> int:
        payload_text = self._serialize_blocks_for_counting(blocks)
        result = await count_text_tokens(
            db,
            user_id=user_id,
            provider=cfg.provider,
            model=cfg.model,
            text=payload_text,
            tokenizer_override=cfg.tokenizer_override,
            allow_custom_base_url=True,
        )
        return result.token_count

    @staticmethod
    def _last_user_assistant_text(history: list[Any]) -> tuple[str | None, str | None]:
        last_user: str | None = None
        last_assistant: str | None = None
        for msg in reversed(history):
            role = getattr(msg, "role", None)
            if role == "user" and last_user is None:
                last_user = history_service.message_text(msg)
            elif role == "assistant" and last_assistant is None:
                last_assistant = history_service.message_text(msg)
            if last_user is not None and last_assistant is not None:
                break
        return last_user, last_assistant

    async def _build_memory_context(
        self,
        db: Session,
        run: RunModel,
        thread: Thread,
        cfg: ResolvedRunConfig,
        history: list[Any],
    ) -> dict[str, Any]:
        from ..models.memory_models import MessageMemorySummary

        owner_id = thread.owner_id
        summaries: list[dict[str, Any]] = []
        relevant: list[dict[str, Any]] = []

        if not cfg.memory_enabled or owner_id is None:
            return {
                "enabled": cfg.memory_enabled,
                "previous_summaries": summaries,
                "relevant_chats": relevant,
            }

        rows = (
            db.query(MessageMemorySummary)
            .filter(
                MessageMemorySummary.user_id == run.user_id,
                MessageMemorySummary.project_id == run.project_id,
                MessageMemorySummary.owner_id == owner_id,
                MessageMemorySummary.language == run.language,
            )
            .order_by(MessageMemorySummary.created_at.desc())
            .limit(5)
            .all()
        )
        summaries = [
            {
                "toMessageId": str(row.to_message_id) if row.to_message_id else None,
                "summaryText": row.summary_text or "",
                "createdAt": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]

        last_user, last_assistant = self._last_user_assistant_text(history)
        queries = [q for q in [last_user, last_assistant] if isinstance(q, str) and q.strip()]
        if queries:
            try:
                rows = await search_memory(
                    db,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    owner_id=owner_id,
                    language=run.language,
                    queries=queries,
                    top_k_per_query=8,
                )
                relevant = [
                    {
                        "messageId": str(item.get("message_id")) if item.get("message_id") is not None else None,
                        "role": str(item.get("role") or ""),
                        "content": str(item.get("content") or ""),
                        "createdAt": (
                            item.get("created_at").isoformat()
                            if hasattr(item.get("created_at"), "isoformat")
                            else None
                        ),
                        "distance": item.get("distance"),
                    }
                    for item in rows
                ]
            except Exception as exc:
                logger.warning("Memory search failed; continuing without relevant chats: %s", exc)

        return {
            "enabled": cfg.memory_enabled,
            "previous_summaries": summaries,
            "relevant_chats": relevant,
        }

    @staticmethod
    def _render_memory_block(
        *,
        base_memory_prompt: str,
        memory_context: dict[str, Any],
        previous_summary: str | None,
    ) -> str:
        sections: list[str] = []
        if previous_summary:
            sections.append(f"[Conversation Summary]\n{previous_summary}")

        relevant = memory_context.get("relevant_chats")
        if isinstance(relevant, list) and relevant:
            lines = ["[Relevant Chats]"]
            for item in relevant[:8]:
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role") or "unknown")
                content = str(item.get("content") or "")
                if content:
                    lines.append(f"- ({role}) {content}")
            if len(lines) > 1:
                sections.append("\n".join(lines))

        if base_memory_prompt.strip():
            sections.append(base_memory_prompt)
        return "\n\n".join(section for section in sections if section.strip())

    async def _memory_and_cut_loop(
        self,
        db: Session,
        user_id: UUID,
        run: RunModel,
        thread: Thread,
        cfg: ResolvedRunConfig,
        all_history: list,
        bundle: Any,
        build_opts: ConversationBuildOptions,
    ) -> list[dict[str, Any]]:
        """Build Memory + Context Cut loop.

        If conversation fits in context window, returns blocks directly.
        Otherwise: summarize recent messages → cut conversation in half → rebuild → repeat.
        """
        max_tokens = cfg.context_window_tokens or 32000
        output_reserve = cfg.max_output_tokens or 4096
        available = max_tokens - output_reserve

        logger.info(
            "Memory+cut loop start: available=%d, history=%d messages",
            available, len(all_history),
        )

        previous_summary: str | None = None
        conversation = list(all_history)

        for iteration in range(self.MAX_CONTEXT_CUT_ITERATIONS):
            memory_context = await self._build_memory_context(db, run, thread, cfg, conversation)
            memory_prompt = self._render_memory_block(
                base_memory_prompt=bundle.memory_prompt,
                memory_context=memory_context,
                previous_summary=previous_summary,
            )
            augmented_bundle = dc_replace(bundle, memory_prompt=memory_prompt)

            blocks = conversation_builder.build_conversation_blocks(
                conversation, augmented_bundle, build_opts,
            )
            estimated = await self._count_prompt_tokens(
                db=db,
                user_id=user_id,
                blocks=blocks,
                cfg=cfg,
            )
            if estimated <= available:
                return blocks

            # Summarize current conversation scope (user/assistant only).
            summary_scope = [m for m in conversation if m.role in ("user", "assistant")]

            if summary_scope:
                summary_msgs = [
                    SummaryMessage(
                        message_id=str(m.id),
                        role=m.role,
                        content=history_service.message_text(m),
                        created_at="",
                    )
                    for m in summary_scope
                ]
                previous_summary = await summary_service.generate_summary(
                    db, user_id,
                    language=run.language,
                    previous_summary=previous_summary,
                    messages=summary_msgs,
                )

            # Cut conversation in half.
            half = max(1, len(conversation) // 2)
            conversation = conversation[half:]

            logger.info(
                "Context cut iteration %d: estimated=%d tokens, messages=%d",
                iteration + 1, estimated, len(conversation),
            )

        # Last resort fallback: build with whatever remains after cut loop.
        memory_context = await self._build_memory_context(db, run, thread, cfg, conversation)
        final_memory = self._render_memory_block(
            base_memory_prompt=bundle.memory_prompt,
            memory_context=memory_context,
            previous_summary=previous_summary,
        )
        final_bundle = dc_replace(bundle, memory_prompt=final_memory)
        return conversation_builder.build_conversation_blocks(conversation, final_bundle, build_opts)

    # ── Prompt context builder ──

    def _build_prompt_context(
        self,
        db: Session,
        run: RunModel,
        thread: Thread,
        memory_context: dict[str, Any],
    ) -> dict[str, Any]:
        """Build the prompt_context dict consumed by prompt_manager."""
        from ..models.db_models import Agent

        agent = None
        owner_id = thread.owner_id
        if thread.thread_type == "agent" and owner_id:
            agent = db.query(Agent).filter(Agent.id == owner_id).first()

        return {
            "run": {
                "id": str(run.id),
                "project_id": str(run.project_id),
                "user_id": str(run.user_id),
                "run_type": thread.thread_type,
                "run_mode": run.run_mode,
                "surface": run.surface,
                "journey_kind": thread.journey_kind,
                "language": run.language,
                "input_text": run.input_text,
                "input_payload": run.input_payload if isinstance(run.input_payload, dict) else {},
                "context_object_ids": run.context_object_ids if isinstance(run.context_object_ids, list) else [],
                "journey_target_ids": run.journey_target_ids if isinstance(run.journey_target_ids, list) else [],
            },
            "agent": {
                "id": str(agent.id) if agent else None,
                "name": agent.name if agent else None,
            },
            "memory": {
                "enabled": bool(memory_context.get("enabled", False)),
                "previous_summaries": memory_context.get("previous_summaries") or [],
                "relevant_chats": memory_context.get("relevant_chats") or [],
            },
            "project_data": None,  # prompt_manager will fetch fresh via build_project_data
        }

    # ── Child (sub-agent) terminal handling ──

    async def _handle_child_terminal(self, child_run_id: UUID, user_id: UUID, terminal_status: str) -> None:
        """When a child run reaches terminal state, update parent's tool call row."""
        parent_run_id: UUID | None = None
        with short_session() as db:
            child = (
                db.query(RunModel)
                .filter(RunModel.id == child_run_id, RunModel.user_id == user_id)
                .first()
            )
            if child is None or child.parent_run_id is None:
                return
            if child.parent_run_message_id is None or not child.parent_run_tool_call_id:
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
            if call_row is None or call_row.status != "running":
                return

            if terminal_status == "completed":
                call_row.status = "accepted"
                call_row.reason = None
                call_row.result = {
                    "success": True,
                    "message": child.final_output or "",
                    "data": {"child_run_id": str(child.id)},
                }
                call_row.accepted_at = datetime.utcnow()
            else:
                call_row.status = "cancelled"
                call_row.reason = f"EXECUTION::call_sub_agent::{terminal_status}"
                call_row.result = {"success": False, "message": child.error or f"Sub-agent {terminal_status}"}
                call_row.accepted_at = None
            call_row.updated_at = datetime.utcnow()

            # Add tool result message to parent
            parent_thread = parent.thread
            if call_row.status == "accepted":
                summary = str((call_row.result or {}).get("message") or f"{call_row.tool_name}: accepted")
            else:
                summary = f"{call_row.tool_name}: cancelled ({call_row.reason or 'error'})"

            tool_msg = RunMessageModel(
                thread_id=parent_thread.id,
                run_id=parent.id,
                seq=parent.next_message_seq,
                seq_in_thread=self._next_thread_seq(db, parent_thread),
                role="tool",
                data={
                    parent.language: {
                        "contentParts": [{"type": "content", "text": summary}],
                        "thinkingDetails": [],
                    }
                },
            )
            parent.next_message_seq += 1
            db.add(tool_msg)
            db.commit()

            parent_ctx = RunEventContext.from_run(parent)
            await run_event_emitter.emit(
                "thread:child_end",
                parent_ctx,
                {"child_run_id": str(child.id), "output": child.final_output or ""},
            )
            await run_event_emitter.emit(
                "thread:tool_calls_executed",
                parent_ctx,
                {
                    "message_id": str(child.parent_run_message_id),
                    "tool_calls": [
                        {
                            "id": str(call_row.llm_call_id),
                            "tool_name": call_row.tool_name,
                            "status": call_row.status,
                            "reason": call_row.reason,
                            "result": call_row.result,
                            "child_thread_id": str(call_row.child_thread_id) if call_row.child_thread_id else None,
                            "child_run_id": str(call_row.child_run_id) if call_row.child_run_id else None,
                        }
                    ],
                },
            )

        # Resume parent if all tool calls for the message are terminal
        if parent_run_id is not None:
            await self._maybe_notify_parent_ready(parent_run_id, user_id)

    async def _maybe_notify_parent_ready(self, parent_run_id: UUID, user_id: UUID) -> None:
        await self._emit_tools_all_terminal_if_ready(run_id=parent_run_id, user_id=user_id, target_message_id=None)

    async def _emit_tools_all_terminal_if_ready(
        self,
        *,
        run_id: UUID,
        user_id: UUID,
        target_message_id: UUID | None,
    ) -> None:
        """Emit readiness event when the latest assistant tool-call set is terminal."""
        terminal_statuses = {"accepted", "rejected", "cancelled"}

        with short_session() as db:
            run = db.query(RunModel).filter(RunModel.id == run_id, RunModel.user_id == user_id).first()
            if run is None or run.status not in {"waiting", "running"}:
                return

            latest = (
                db.query(RunMessageModel.id)
                .join(RunToolCallModel, RunToolCallModel.message_id == RunMessageModel.id)
                .filter(
                    RunMessageModel.run_id == run.id,
                    RunMessageModel.role == "assistant",
                )
                .order_by(RunMessageModel.seq.desc(), RunMessageModel.created_at.desc())
                .first()
            )
            if latest is None:
                return
            latest_message_id = latest[0]

            if target_message_id is not None and target_message_id != latest_message_id:
                return
            message_id = target_message_id or latest_message_id

            rows = (
                db.query(RunToolCallModel.status)
                .filter(
                    RunToolCallModel.run_id == run.id,
                    RunToolCallModel.message_id == message_id,
                )
                .all()
            )
            if not rows:
                return

            statuses = [str(row[0]) for row in rows]
            if any(status not in terminal_statuses for status in statuses):
                return

            event_ctx = RunEventContext.from_run(run)
            await run_event_emitter.emit("thread:tools_all_terminal", event_ctx, {})

    async def _launch_child_if_needed(
        self,
        user_id: UUID,
        parent_thread_id: UUID,
        message_id: UUID,
        llm_call_id: str,
    ) -> None:
        """Launch pipeline for a child thread/run created by _dispatch_call_sub_agent."""
        with short_session() as db:
            call_row = (
                db.query(RunToolCallModel)
                .filter(
                    RunToolCallModel.message_id == message_id,
                    RunToolCallModel.llm_call_id == llm_call_id,
                    RunToolCallModel.status == "running",
                )
                .first()
            )
            if call_row is None or call_row.child_run_id is None:
                return
            child_run_id = call_row.child_run_id

        await self._launch_loop(child_run_id, user_id)


run_pipeline = RunPipeline()
