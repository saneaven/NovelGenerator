from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from ..providers.contracts import (
    DeltaPayload,
    MetaPayload,
    ProviderErrorPayload,
    extract_native_tool_calls_from_snapshot,
    merge_meta_payload,
    patch_snapshot_with_meta,
)
from ..providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ..providers.registry import ProviderRegistry
from ..services.credential_service import credential_service
from ..services.history_service import capture_history, reuse_history, should_capture_or_reuse
from ..services.memory_builder import build_memory_prompt
from ..services.prompt_runtime.conversation_builder import build_from_runs
from ..services.prompt_runtime.prompt_manager import PromptManager
from ..services.prompt_runtime.project_data_builder import build_project_data
from ..services.prompt_runtime.prompt_renderer import PromptRenderer
from ..services.settings_service import settings_service
from ..services.sidecar_client import sidecar_client
from ..services.tool_schemas import ToolSchemaDef, get_dynamic_call_tools, get_tools_for_set
from ..services.token_count_service import count_text_tokens
from ..services.context_manager import fit_to_context_window
from ..services.validators import GLOBAL_VALIDATORS, TOOL_VALIDATORS, ValidationContext, run_validator_chain
from ..services.runtime_event_dispatcher import RuntimeEventDispatcher, runtime_event_dispatcher

# Ensure providers are registered.
from ..providers import async_openai_provider as _register_openai  # noqa: F401
from ..providers import claude_provider as _register_claude  # noqa: F401
from ..providers import gemini_provider as _register_gemini  # noqa: F401
from ..providers import openai_responses_provider as _register_openai_responses  # noqa: F401
from ..providers import openrouter as _register_openrouter  # noqa: F401
from ..providers import xai_provider as _register_xai  # noqa: F401
from ..providers import custom as _register_custom  # noqa: F401


TERMINAL_TOOL_STATUSES = {"applied", "failed", "rejected"}


@dataclass
class _ToolDeltaState:
    llm_call_id: str
    name: str
    raw_arguments: str


class RunPipeline:
    def __init__(self, db_factory: Callable[[], Session], event_dispatcher: RuntimeEventDispatcher):
        self._db_factory = db_factory
        self._event_dispatcher = event_dispatcher
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._task_lock = asyncio.Lock()
        self._thread_locks: dict[UUID, asyncio.Lock] = {}

    def _thread_lock(self, thread_id: UUID) -> asyncio.Lock:
        lock = self._thread_locks.get(thread_id)
        if lock is None:
            lock = asyncio.Lock()
            self._thread_locks[thread_id] = lock
        return lock

    async def _emit(
        self,
        *,
        project_id: UUID,
        thread_id: UUID,
        event_name: str,
        data: dict[str, Any],
    ) -> None:
        await self._event_dispatcher.emit_runtime_event(
            project_id=project_id,
            thread_id=thread_id,
            event_name=event_name,
            data=data,
        )

    async def _spawn_task(self, run_id: UUID) -> None:
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is not None and not existing.done():
                return

            task = asyncio.create_task(self.execute_loop(run_id))
            self._tasks[run_id] = task

            def _cleanup(done_task: asyncio.Task) -> None:
                _ = done_task
                self._tasks.pop(run_id, None)

            task.add_done_callback(_cleanup)

    def _toolset_for_run(self, thread: Thread, run: RunModel) -> str:
        if thread.thread_type == "journey":
            journey_kind = (thread.journey_kind or "").strip()
            if journey_kind == "translation":
                return "translateObjects"
            if journey_kind == "imagePrompt":
                return "storyObject"
            return "agent_agent_mode"

        if thread.thread_type == "subAgent":
            return "agent_agent_mode"

        if run.run_mode == "planMode":
            return "agent_plan_mode"
        return "agent_agent_mode"

    async def _materialize_resume_tool_results(self, db: Session, run: RunModel, thread: Thread) -> None:
        language = run.language
        rows = (
            db.query(RunToolCallModel)
            .filter(
                RunToolCallModel.run_id == run.id,
                RunToolCallModel.result_message_id.is_(None),
                RunToolCallModel.status.in_(list(TERMINAL_TOOL_STATUSES)),
            )
            .order_by(RunToolCallModel.call_seq.asc())
            .all()
        )
        for row in rows:
            content = ""
            if isinstance(row.result, dict):
                content = json.dumps(row.result, ensure_ascii=False)
            if not content:
                content = str(row.reason or row.status)

            msg = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=run.next_message_seq,
                seq_in_thread=thread.next_message_seq,
                role="tool_result",
                data={
                    language: {
                        "contentParts": [{"type": "content", "text": content}],
                        "toolResult": {
                            "tool_call_id": str(row.id),
                            "tool_name": row.tool_name,
                            "content": content,
                        },
                    },
                    "_final": {
                        "contentParts": [{"type": "content", "text": content}],
                        "toolResult": {
                            "tool_call_id": str(row.id),
                            "tool_name": row.tool_name,
                            "content": content,
                        },
                    },
                },
            )
            db.add(msg)
            db.flush()

            row.result_message_id = msg.id
            row.updated_at = datetime.utcnow()
            run.next_message_seq += 1
            thread.next_message_seq += 1

    def _provider_tools(self, tool_defs: list[ToolSchemaDef]) -> list[dict[str, Any]]:
        return [
            {
                "name": d.name,
                "description": d.description,
                "parameters": d.parameters,
            }
            for d in tool_defs
        ]

    async def _count_tokens(
        self,
        db: Session,
        *,
        user_id: UUID,
        provider: str,
        model: str,
        text: str,
        tokenizer_override: str | None,
    ) -> int:
        result = await count_text_tokens(
            db,
            user_id=user_id,
            provider=provider,
            model=model,
            text=text,
            tokenizer_override=tokenizer_override,
        )
        return int(result.token_count)

    def _extract_last_texts(self, conversation: list[dict[str, Any]]) -> tuple[str, str]:
        last_user = ""
        last_assistant = ""
        for msg in conversation:
            role = msg.get("role")
            parts = msg.get("content_parts")
            if not isinstance(parts, list):
                continue
            text = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict) and p.get("type") == "content")
            if role == "user" and text.strip():
                last_user = text
            if role == "assistant" and text.strip():
                last_assistant = text
        return last_user, last_assistant

    async def start_run(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
        input_text: str,
        input_payload: dict[str, Any] | None,
        run_mode: str | None,
        surface: str | None,
        context_object_ids: list[UUID],
        journey_target_ids: list[UUID],
        language: str | None,
    ) -> RunModel:
        text = (input_text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="input_text is required for create run")

        async with self._thread_lock(thread_id):
            db = self._db_factory()
            try:
                thread = (
                    db.query(Thread)
                    .filter(Thread.id == thread_id, Thread.user_id == user_id)
                    .with_for_update()
                    .first()
                )
                if thread is None:
                    raise HTTPException(status_code=404, detail="Thread not found")

                has_pending_tool = (
                    db.query(RunToolCallModel.id)
                    .filter(RunToolCallModel.thread_id == thread.id, RunToolCallModel.status == "pending")
                    .first()
                    is not None
                )
                if has_pending_tool:
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                settings = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
                resolved_language = language or settings.main_language

                latest = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
                if latest is not None and latest.status in {"running", "waiting", "processing"}:
                    latest.status = "canceled"

                normalized_input_payload = input_payload if isinstance(input_payload, dict) else {}
                run = RunModel(
                    thread_id=thread.id,
                    user_id=user_id,
                    project_id=thread.project_id,
                    status="running",
                    run_seq=thread.next_run_seq,
                    language=resolved_language,
                    input_text=text,
                    input_payload=normalized_input_payload,
                    run_mode=run_mode,
                    surface=surface,
                    context_object_ids=[str(x) for x in context_object_ids],
                    journey_target_ids=[str(x) for x in journey_target_ids],
                )
                db.add(run)
                db.flush()

                msg = RunMessageModel(
                    thread_id=thread.id,
                    run_id=run.id,
                    seq=run.next_message_seq,
                    seq_in_thread=thread.next_message_seq,
                    role="user",
                    data={
                        resolved_language: {"contentParts": [{"type": "content", "text": text}]},
                        "_final": {"contentParts": [{"type": "content", "text": text}]},
                    },
                )
                db.add(msg)

                run.next_message_seq += 1
                thread.next_message_seq += 1
                thread.next_run_seq += 1
                thread.status = "running"
                db.commit()
                db.refresh(run)
                _ = run.thread  # eager-load before session closes
            finally:
                db.close()

        await self._spawn_task(run.id)
        return run

    async def resume_run(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
        input_payload: dict[str, Any] | None,
        run_mode: str | None,
        surface: str | None,
        context_object_ids: list[UUID],
        journey_target_ids: list[UUID],
        language: str | None,
    ) -> RunModel:
        async with self._thread_lock(thread_id):
            db = self._db_factory()
            try:
                thread = (
                    db.query(Thread)
                    .filter(Thread.id == thread_id, Thread.user_id == user_id)
                    .with_for_update()
                    .first()
                )
                if thread is None:
                    raise HTTPException(status_code=404, detail="Thread not found")

                has_pending_tool = (
                    db.query(RunToolCallModel.id)
                    .filter(RunToolCallModel.thread_id == thread.id, RunToolCallModel.status == "pending")
                    .first()
                    is not None
                )
                if has_pending_tool:
                    raise HTTPException(status_code=409, detail="Pending tool call exists in thread")

                run = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
                if run is None:
                    raise HTTPException(status_code=409, detail="No run exists to resume")

                if run_mode is not None:
                    run.run_mode = run_mode
                if surface is not None:
                    run.surface = surface
                if context_object_ids:
                    run.context_object_ids = [str(x) for x in context_object_ids]
                if journey_target_ids:
                    run.journey_target_ids = [str(x) for x in journey_target_ids]
                if language is not None:
                    run.language = language
                if input_payload is not None:
                    run.input_payload = input_payload if isinstance(input_payload, dict) else {}

                run.status = "running"
                run.error = None
                thread.status = "running"
                db.commit()
                db.refresh(run)
                _ = run.thread  # eager-load before session closes
            finally:
                db.close()

        await self._spawn_task(run.id)
        return run

    async def cancel_run(self, *, thread_id: UUID, run_id: UUID, user_id: UUID) -> None:
        async with self._task_lock:
            task = self._tasks.get(run_id)
            if task is not None and not task.done():
                task.cancel()

        db = self._db_factory()
        project_id: UUID | None = None
        try:
            run = (
                db.query(RunModel)
                .join(Thread, Thread.id == RunModel.thread_id)
                .filter(RunModel.id == run_id, Thread.id == thread_id, Thread.user_id == user_id)
                .first()
            )
            if run is None:
                raise HTTPException(status_code=404, detail="Run not found")

            thread = run.thread
            project_id = run.project_id
            run.status = "canceled"
            thread.status = "canceled"
            db.commit()
        finally:
            db.close()

        if project_id is not None:
            await self._emit(
                project_id=project_id,
                thread_id=thread_id,
                event_name="run:canceled",
                data={"run_id": str(run_id)},
            )
            await self._emit(
                project_id=project_id,
                thread_id=thread_id,
                event_name="run:status",
                data={"run_id": str(run_id), "status": "canceled"},
            )

    async def _persist_tool_calls(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        assistant_message: RunMessageModel,
        tool_calls: list[Any],
        schema_by_name: dict[str, ToolSchemaDef],
        rag_search_enabled: bool,
    ) -> list[RunToolCallModel]:
        out: list[RunToolCallModel] = []

        for idx, tc in enumerate(tool_calls):
            llm_call_id = str(tc.id or f"tool_call_{idx}")
            tool_name = str(tc.tool_name or "")
            arguments = tc.arguments if isinstance(tc.arguments, dict) else {}

            tool_call_text = json.dumps(
                {
                    "id": llm_call_id,
                    "tool_name": tool_name,
                    "arguments": arguments,
                },
                ensure_ascii=False,
            )
            tool_msg = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=run.next_message_seq,
                seq_in_thread=thread.next_message_seq,
                role="tool_call",
                data={
                    run.language: {"contentParts": [{"type": "content", "text": tool_call_text}]},
                    "_final": {"contentParts": [{"type": "content", "text": tool_call_text}]},
                },
            )
            db.add(tool_msg)
            db.flush()
            run.next_message_seq += 1
            thread.next_message_seq += 1

            row = RunToolCallModel(
                thread_id=thread.id,
                run_id=run.id,
                message_id=tool_msg.id,
                assistant_message_id=assistant_message.id,
                call_seq=idx,
                llm_call_id=llm_call_id,
                tool_name=tool_name,
                arguments=arguments,
                status="validating",
            )
            db.add(row)
            db.flush()

            validation_ctx = ValidationContext(
                db=db,
                run=run,
                allowed_tool_names=None,
                schema_by_name=schema_by_name,
                rag_search_enabled=rag_search_enabled,
                sidecar=sidecar_client,
            )
            validators = GLOBAL_VALIDATORS + TOOL_VALIDATORS.get(tool_name, [])
            validation = await run_validator_chain(validators, arguments, tool_name, validation_ctx)
            if validation.valid:
                row.status = "pending"
                row.reason = None
            else:
                row.status = "failed"
                row.reason = f"[{validation.validator}] {validation.reason}" if validation.validator else validation.reason

            out.append(row)

            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:end",
                data={
                    "run_id": str(run.id),
                    "tool_call_id": str(row.id),
                    "message_id": str(tool_msg.id),
                    "assistant_message_id": str(assistant_message.id),
                    "index": idx,
                    "name": tool_name,
                    "arguments": arguments,
                },
            )
            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:status",
                data={
                    "run_id": str(run.id),
                    "tool_call_id": str(row.id),
                    "status": row.status,
                    "reason": row.reason,
                    "result": row.result,
                },
            )

        return out

    async def execute_loop(self, run_id: UUID) -> None:
        db = self._db_factory()
        try:
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is None:
                return
            thread = db.query(Thread).filter(Thread.id == run.thread_id).first()
            if thread is None:
                return

            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:status",
                data={"run_id": str(run.id), "status": "running"},
            )

            await self._materialize_resume_tool_results(db, run, thread)

            settings: UserSettings = settings_service._get_settings(db, run.user_id)  # pylint: disable=protected-access
            preset_id = settings_service.get_active_preset_id(db, run.user_id)
            if preset_id is None:
                raise RuntimeError("No active preset selected")

            renderer = PromptRenderer(db, user_id=run.user_id, preset_id=preset_id)
            prompt_manager = PromptManager(renderer)
            project_data = await build_project_data(db, run.project_id, run.language, sidecar_client)

            has_prior_user_messages = (
                db.query(RunMessageModel.id)
                .join(RunModel, RunModel.id == RunMessageModel.run_id)
                .filter(
                    RunModel.thread_id == thread.id,
                    RunModel.run_seq < run.run_seq,
                    RunMessageModel.role == "user",
                )
                .first()
                is not None
            )
            prompt_bundle = prompt_manager.build_prompt_bundle(
                db,
                user_id=run.user_id,
                preset_id=preset_id,
                thread=thread,
                run=run,
                project_data=project_data,
                has_prior_user_messages=has_prior_user_messages,
            )

            previous_run = (
                db.query(RunModel)
                .filter(RunModel.thread_id == thread.id, RunModel.run_seq < run.run_seq)
                .order_by(RunModel.run_seq.desc())
                .first()
            )
            strategy = should_capture_or_reuse(db, thread=thread, previous_run=previous_run)
            if strategy == "reuse" and thread.captured_history_system_prompt:
                history = reuse_history(thread)
            else:
                history = capture_history(
                    db,
                    thread=thread,
                    up_to_run=run,
                    system_prompt=prompt_bundle.system_prompt,
                    prefill=prompt_bundle.prefill,
                    language=run.language,
                    tool_call_history_limit=int(getattr(settings, "tool_call_history_limit", 5)),
                    thinking_history_limit=int(getattr(settings, "thinking_history_limit", 5)),
                )

            recent = build_from_runs(
                db,
                thread_id=thread.id,
                language=run.language,
                tool_call_history_limit=int(getattr(settings, "tool_call_history_limit", 5)),
                thinking_history_limit=int(getattr(settings, "thinking_history_limit", 5)),
                include_run_ids=[run.id],
            )

            if run.input_text and run.input_text.strip():
                recent = [msg for msg in recent if msg.get("role") != "user"]
                recent.insert(
                    0,
                    {
                        "role": "user",
                        "content_parts": [{"type": "content", "text": prompt_bundle.user_prompt}],
                    },
                )

            system_prompt = history.system_prompt
            conversation = list(history.conversation) + recent
            prefill = history.prefill

            last_user_text, last_assistant_text = self._extract_last_texts(conversation)
            memory_prompt = await build_memory_prompt(
                db,
                prompt_manager=prompt_manager,
                prompt_bundle=prompt_bundle,
                user_id=run.user_id,
                project_id=run.project_id,
                owner_id=thread.owner_id,
                language=run.language,
                last_user_text=last_user_text,
                last_assistant_text=last_assistant_text,
                rag_enabled=bool(getattr(settings, "rag_search_enabled", False)),
            )
            memory_message_ref: dict[str, Any] | None = None
            if memory_prompt:
                memory_message_ref = {
                    "role": "user",
                    "content_parts": [{"type": "content", "text": memory_prompt}],
                }
                conversation.insert(0, memory_message_ref)

            task_type = prompt_bundle.target.task_type
            task_config = settings_service.get_task_config(db, run.user_id, task_type)
            tokenizer_override = task_config.advanced.get("tokenizer_override") if isinstance(task_config.advanced, dict) else None

            async def _token_counter(text: str) -> int:
                return await self._count_tokens(
                    db,
                    user_id=run.user_id,
                    provider=task_config.provider,
                    model=task_config.model,
                    text=text,
                    tokenizer_override=tokenizer_override,
                )

            async def _rebuild_memory(current_conversation: list[dict]) -> tuple[list[dict], str | None]:
                nonlocal memory_message_ref
                cleaned = list(current_conversation)
                if memory_message_ref is not None:
                    cleaned = [m for m in cleaned if m is not memory_message_ref]
                new_user, new_asst = self._extract_last_texts(cleaned)
                new_mem = await build_memory_prompt(
                    db,
                    prompt_manager=prompt_manager,
                    prompt_bundle=prompt_bundle,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    owner_id=thread.owner_id,
                    language=run.language,
                    last_user_text=new_user,
                    last_assistant_text=new_asst,
                    rag_enabled=bool(getattr(settings, "rag_search_enabled", False)),
                )
                memory_message_ref = None
                if new_mem:
                    memory_message_ref = {
                        "role": "user",
                        "content_parts": [{"type": "content", "text": new_mem}],
                    }
                    cleaned.insert(0, memory_message_ref)
                return cleaned, new_mem

            conversation, memory_prompt = await fit_to_context_window(
                system_prompt,
                conversation,
                prefill,
                int(task_config.context_window_tokens or 32000),
                rebuild_memory_cb=_rebuild_memory,
                count_tokens_cb=_token_counter,
            )

            # Insert prefill as assistant tail if enabled.
            if prefill and bool(task_config.advanced.get("enable_prefill", False)):
                conversation.append(
                    {
                        "role": "assistant",
                        "content_parts": [{"type": "content", "text": prefill}],
                    }
                )

            assistant_message = RunMessageModel(
                thread_id=thread.id,
                run_id=run.id,
                seq=run.next_message_seq,
                seq_in_thread=thread.next_message_seq,
                role="assistant",
                data={run.language: {"contentParts": []}, "_final": {"contentParts": []}},
            )
            db.add(assistant_message)
            db.flush()
            run.next_message_seq += 1
            thread.next_message_seq += 1
            db.commit()

            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="message:start",
                data={
                    "run_id": str(run.id),
                    "message_id": str(assistant_message.id),
                    "role": "assistant",
                    "seq": int(assistant_message.seq),
                    "seq_in_thread": int(assistant_message.seq_in_thread),
                },
            )

            tool_set_name = self._toolset_for_run(thread, run)
            dynamic_call_tools = [] if thread.thread_type == "journey" else get_dynamic_call_tools(
                db,
                user_id=run.user_id,
                preset_id=preset_id,
            )
            tool_defs = get_tools_for_set(
                tool_set_name,
                rag_search_enabled=bool(getattr(settings, "rag_search_enabled", False)),
                dynamic_call_tools=dynamic_call_tools,
            )
            schema_by_name = {d.name: d for d in tool_defs}

            provider_config = credential_service.get_provider_config(db, run.user_id, task_config.provider)
            if task_config.provider == "custom":
                provider_config = {
                    **provider_config,
                    "request_format": task_config.advanced.get("request_format") or "openai_sdk",
                }

            provider = ProviderRegistry.get_provider(task_config.provider, provider_config)
            if not provider.validate_config():
                raise RuntimeError(f"Invalid provider configuration: {task_config.provider}")

            native_output_mode = bool(getattr(settings, "native_output_mode", False))
            tools_wire = None if native_output_mode else self._provider_tools(tool_defs)

            messages = [{"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]}] + conversation

            stream = provider.stream_chat(
                messages=messages,
                model=task_config.model,
                temperature=float(task_config.temperature),
                tools=tools_wire,
                tool_choice="auto" if tools_wire else None,
                max_tokens=task_config.max_output_tokens,
                provider_preference=task_config.advanced.get("provider_preference") if isinstance(task_config.advanced, dict) else None,
                thinking_config=task_config.advanced.get("thinking_config") if isinstance(task_config.advanced, dict) else None,
                thinking_mode=task_config.advanced.get("thinking_mode") if isinstance(task_config.advanced, dict) else "off",
                thinking_format=task_config.advanced.get("thinking_format") if isinstance(task_config.advanced, dict) else None,
                request_format=task_config.advanced.get("request_format") if isinstance(task_config.advanced, dict) else None,
                retry_config=settings_service.get_retry_config(db, run.user_id),
                native_tool_call=native_output_mode,
            )

            assembler = FallbackSnapshotAssembler(provider=task_config.provider, model=task_config.model)
            native_final = None
            merged_meta: MetaPayload | None = None

            collected_parts: list[dict[str, str]] = []
            delta_state_by_index: dict[int, _ToolDeltaState] = {}

            async for event in stream:
                if event.kind == "delta" and event.delta is not None:
                    delta: DeltaPayload = event.delta
                    assembler.apply_delta(delta)

                    if delta.content_delta:
                        collected_parts.append({"type": "content", "text": delta.content_delta})
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="content:delta",
                            data={
                                "run_id": str(run.id),
                                "message_id": str(assistant_message.id),
                                "text": delta.content_delta,
                            },
                        )

                    if delta.thinking_delta:
                        collected_parts.append({"type": "thinking", "text": delta.thinking_delta})
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="thinking:delta",
                            data={
                                "run_id": str(run.id),
                                "message_id": str(assistant_message.id),
                                "text": delta.thinking_delta,
                            },
                        )

                    for tc_delta in delta.tool_call_deltas:
                        if not isinstance(tc_delta, dict):
                            continue
                        idx = int(tc_delta.get("index") or 0)
                        state = delta_state_by_index.get(idx)
                        if state is None:
                            init_id = str(tc_delta.get("id") or f"tool-call-{idx}")
                            state = _ToolDeltaState(llm_call_id=init_id, name="", raw_arguments="")
                            delta_state_by_index[idx] = state
                            await self._emit(
                                project_id=run.project_id,
                                thread_id=thread.id,
                                event_name="tool_call:start",
                                data={
                                    "run_id": str(run.id),
                                    "tool_call_id": init_id,
                                    "message_id": "",
                                    "assistant_message_id": str(assistant_message.id),
                                    "index": idx,
                                    "name": "",
                                },
                            )

                        if isinstance(tc_delta.get("id"), str) and tc_delta["id"]:
                            state.llm_call_id = tc_delta["id"]

                        fn = tc_delta.get("function") if isinstance(tc_delta.get("function"), dict) else {}
                        if isinstance(fn.get("name"), str):
                            state.name = fn["name"]
                        if isinstance(fn.get("arguments"), str):
                            state.raw_arguments += fn["arguments"]
                            await self._emit(
                                project_id=run.project_id,
                                thread_id=thread.id,
                                event_name="tool_call:delta",
                                data={
                                    "run_id": str(run.id),
                                    "tool_call_id": state.llm_call_id,
                                    "index": idx,
                                    "name": state.name,
                                    "arguments_delta": fn["arguments"],
                                },
                            )

                elif event.kind == "meta" and event.meta is not None:
                    assembler.apply_meta(event.meta)
                    merged_meta = merge_meta_payload(merged_meta, event.meta)
                elif event.kind == "final_native" and event.final_native is not None:
                    native_final = event.final_native
                elif event.kind == "error":
                    err: ProviderErrorPayload = event.error or ProviderErrorPayload(message="Unknown provider error", status=None)
                    raise RuntimeError(err.message)

            if hasattr(stream, "aclose"):
                await stream.aclose()

            if native_final is not None:
                final_snapshot = patch_snapshot_with_meta(native_final, merged_meta)
            else:
                final_snapshot = assembler.finalize_or_raise()

            if native_output_mode:
                final_snapshot = extract_native_tool_calls_from_snapshot(final_snapshot)

            db.refresh(run)
            db.refresh(thread)
            assistant_message = db.query(RunMessageModel).filter(RunMessageModel.id == assistant_message.id).first()
            if assistant_message is None:
                raise RuntimeError("Assistant message row missing")

            assistant_message.data = {
                run.language: {
                    "contentParts": final_snapshot.content_parts,
                    "thinkingDetails": final_snapshot.thinking_details,
                },
                "_final": {
                    "contentParts": final_snapshot.content_parts,
                    "thinkingDetails": final_snapshot.thinking_details,
                },
            }

            persisted_tools = await self._persist_tool_calls(
                db,
                thread=thread,
                run=run,
                assistant_message=assistant_message,
                tool_calls=final_snapshot.tool_calls,
                schema_by_name=schema_by_name,
                rag_search_enabled=bool(getattr(settings, "rag_search_enabled", False)),
            )

            run.final_output = "".join(part.get("text", "") for part in final_snapshot.content_parts if part.get("type") == "content")

            if any(tc.status == "pending" for tc in persisted_tools):
                run.status = "waiting"
                thread.status = "waiting"
            elif any(tc.status == "rejected" for tc in persisted_tools):
                run.status = "paused"
                thread.status = "paused"
            else:
                run.status = "done"
                thread.status = "done"

            db.commit()

            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="message:end",
                data={
                    "run_id": str(run.id),
                    "message_id": str(assistant_message.id),
                    "seq_in_thread": int(assistant_message.seq_in_thread),
                    "data": assistant_message.data,
                },
            )
            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:status",
                data={
                    "run_id": str(run.id),
                    "status": run.status,
                    "error": run.error,
                },
            )
            await self._emit(
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="run:done",
                data={
                    "run_id": str(run.id),
                    "final_status": run.status,
                },
            )
        except asyncio.CancelledError:
            try:
                run = db.query(RunModel).filter(RunModel.id == run_id).first()
                if run is not None:
                    thread = run.thread
                    run.status = "canceled"
                    if thread is not None:
                        thread.status = "canceled"
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="run:canceled",
                            data={"run_id": str(run.id)},
                        )
                    db.commit()
            finally:
                raise
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            run = db.query(RunModel).filter(RunModel.id == run_id).first()
            if run is not None:
                thread = run.thread
                run.status = "error"
                run.error = str(exc)
                if thread is not None:
                    thread.status = "error"
                db.commit()
                if thread is not None:
                    await self._emit(
                        project_id=run.project_id,
                        thread_id=thread.id,
                        event_name="run:error",
                        data={
                            "run_id": str(run.id),
                            "error": str(exc),
                        },
                    )
                    await self._emit(
                        project_id=run.project_id,
                        thread_id=thread.id,
                        event_name="run:status",
                        data={
                            "run_id": str(run.id),
                            "status": "error",
                            "error": str(exc),
                        },
                    )
        finally:
            db.close()


run_pipeline = RunPipeline(db_factory=SessionLocal, event_dispatcher=runtime_event_dispatcher)
