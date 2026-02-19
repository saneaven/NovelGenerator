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
from ..models.db_models import RunMessageModel, RunModel, RunToolCallModel, SubAgentDefinitionModel, Thread, UserSettings
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
from ..services.memory_builder import build_memory_prompt
from ..services.prompt_runtime.conversation_builder import build_from_runs
from ..services.prompt_runtime.prompt_manager import PromptBundle, PromptManager, PromptTarget
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


@dataclass
class _ToolDeltaState:
    llm_call_id: str
    name: str
    raw_arguments: str


@dataclass
class CreateContext:
    input_text: str
    input_payload: dict[str, Any]


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

    async def _spawn_task(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is not None and not existing.done():
                return

            task = asyncio.create_task(self.execute_loop(run_id, create_ctx=create_ctx))
            self._tasks[run_id] = task

            def _cleanup(done_task: asyncio.Task) -> None:
                _ = done_task
                self._tasks.pop(run_id, None)

            task.add_done_callback(_cleanup)

    async def _cancel_task_and_wait(self, run_id: UUID, *, timeout_s: float = 5.0) -> bool:
        task: asyncio.Task | None = None
        async with self._task_lock:
            existing = self._tasks.get(run_id)
            if existing is None or existing.done():
                return True
            existing.cancel()
            task = existing

        try:
            await asyncio.wait_for(task, timeout=max(float(timeout_s), 0.1))
            return True
        except asyncio.CancelledError:
            return True
        except asyncio.TimeoutError:
            return False
        except Exception:
            return True

    def _toolset_for_run(self, thread: Thread, run: RunModel, input_payload: dict | None = None) -> str:
        if thread.thread_type == "journey":
            journey_kind = (thread.journey_kind or "").strip()
            if journey_kind == "translation":
                return "translateObjects"
            if journey_kind == "imagePrompt":
                return ""  # always raw_output, no tools needed
            # aiEdit: read category directly from flat payload
            if isinstance(input_payload, dict):
                category = str(input_payload.get("category") or "").strip()
                if category == "manuscript":
                    return "manuscript"
            return "storyObject"

        if thread.thread_type == "subAgent":
            return "agent_agent_mode"

        if run.run_mode == "planMode":
            return "agent_plan_mode"
        return "agent_agent_mode"

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

        normalized_input_payload = input_payload if isinstance(input_payload, dict) else {}
        latest_active_run_id: UUID | None = None

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

                latest = (
                    db.query(RunModel)
                    .filter(RunModel.thread_id == thread.id)
                    .order_by(RunModel.run_seq.desc())
                    .first()
                )
                if latest is not None and latest.status in {"running", "waiting", "processing"}:
                    latest_active_run_id = latest.id
            finally:
                db.close()

            if latest_active_run_id is not None:
                canceled = await self._cancel_task_and_wait(latest_active_run_id, timeout_s=5.0)
                if not canceled:
                    raise HTTPException(status_code=409, detail="Existing run cancellation timed out; retry")

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

                run = RunModel(
                    thread_id=thread.id,
                    user_id=user_id,
                    project_id=thread.project_id,
                    status="running",
                    run_seq=thread.next_run_seq,
                    language=resolved_language,
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
                db.refresh(msg)
                _ = run.thread  # eager-load before session closes

                # Capture user message fields before session closes.
                user_msg_id = msg.id
                user_msg_seq = msg.seq
                user_msg_seq_in_thread = msg.seq_in_thread
                user_msg_data = msg.data
            finally:
                db.close()

        await self._emit(
            project_id=run.project_id,
            thread_id=run.thread.id,
            event_name="message:user",
            data={
                "run_id": str(run.id),
                "message_id": str(user_msg_id),
                "role": "user",
                "seq": int(user_msg_seq),
                "seq_in_thread": int(user_msg_seq_in_thread),
                "data": user_msg_data,
            },
        )
        await self._spawn_task(run.id, create_ctx=CreateContext(
            input_text=text,
            input_payload=normalized_input_payload,
        ))
        return run

    async def resume_run(
        self,
        *,
        thread_id: UUID,
        user_id: UUID,
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
        allowed_tool_names: set[str] | None = None,
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

            # Link the tool_call message back to its parent tool call for cascade deletion.
            tool_msg.parent_tool_call_id = row.id

            validation_ctx = ValidationContext(
                db=db,
                run=run,
                allowed_tool_names=allowed_tool_names,
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
                    "status": row.status,
                    "seq_in_thread": int(tool_msg.seq_in_thread),
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

    async def _assemble_create(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        settings: UserSettings,
        create_ctx: CreateContext,
    ) -> tuple[str, list[dict[str, Any]], str | None, PromptBundle]:
        preset_id = settings_service.get_active_preset_id(db, run.user_id)
        if preset_id is None:
            raise RuntimeError("No active preset selected")

        renderer = PromptRenderer(db, user_id=run.user_id, preset_id=preset_id)
        prompt_manager = PromptManager(renderer)
        project_data = await build_project_data(db, run.project_id, run.language, sidecar_client)

        prompt_bundle = prompt_manager.build_prompt_bundle(
            db,
            user_id=run.user_id,
            preset_id=preset_id,
            thread=thread,
            run=run,
            project_data=project_data,
            input_text=create_ctx.input_text,
            input_payload=create_ctx.input_payload,
            native_output_mode=bool(getattr(settings, "native_output_mode", False)),
        )

        # Store resolved output mode and toolset on RunModel (single source of truth).
        run.resolved_output_mode = prompt_bundle.resolved_output_mode
        # imagePrompt journeys are always raw_output regardless of payload.
        if thread.thread_type == "journey" and (thread.journey_kind or "").strip() == "imagePrompt":
            run.resolved_output_mode = "raw_output"
        run.resolved_toolset = self._toolset_for_run(thread, run, create_ctx.input_payload)
        db.flush()

        all_runs = (
            db.query(RunModel)
            .filter(RunModel.thread_id == thread.id)
            .order_by(RunModel.run_seq.asc())
            .all()
        )

        user_msgs = (
            db.query(RunMessageModel)
            .filter(RunMessageModel.thread_id == thread.id, RunMessageModel.role == "user")
            .order_by(RunMessageModel.seq_in_thread.asc())
            .all()
        )
        raw_user_texts = [m.data["_final"]["contentParts"][0]["text"] for m in user_msgs]

        rendered_users = prompt_manager.render_conversation_user_prompts(
            prompt_map=prompt_bundle.prompt_map,
            target=prompt_bundle.target,
            template_data=prompt_bundle.template_data,
            user_texts=raw_user_texts,
        )

        tool_call_limit = int(getattr(settings, "tool_call_history_limit", 5))
        thinking_limit = int(getattr(settings, "thinking_history_limit", 5))

        conversation: list[dict[str, Any]] = []
        for i, r in enumerate(all_runs):
            if i < len(rendered_users) and rendered_users[i]:
                conversation.append({
                    "role": "user",
                    "content_parts": [{"type": "content", "text": rendered_users[i]}],
                })

            non_user = build_from_runs(
                db,
                thread_id=thread.id,
                language=run.language,
                tool_call_history_limit=tool_call_limit,
                thinking_history_limit=thinking_limit,
                include_run_ids=[r.id],
            )
            conversation.extend(m for m in non_user if m.get("role") != "user")

        thread.captured_history_system_prompt = prompt_bundle.system_prompt
        thread.captured_history_conversation_json = conversation
        thread.captured_history_prefill = prompt_bundle.prefill
        db.flush()

        return prompt_bundle.system_prompt, conversation, prompt_bundle.prefill, prompt_bundle

    def _assemble_resume(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        settings: UserSettings,
    ) -> tuple[str, list[dict[str, Any]], str | None, PromptBundle | None]:
        system_prompt = str(thread.captured_history_system_prompt or "")
        conversation = list(thread.captured_history_conversation_json or [])
        prefill = thread.captured_history_prefill if isinstance(thread.captured_history_prefill, str) and thread.captured_history_prefill else None

        tool_call_limit = int(getattr(settings, "tool_call_history_limit", 5))
        thinking_limit = int(getattr(settings, "thinking_history_limit", 5))

        recent = build_from_runs(
            db,
            thread_id=thread.id,
            language=run.language,
            tool_call_history_limit=tool_call_limit,
            thinking_history_limit=thinking_limit,
            include_run_ids=[run.id],
        )
        conversation.extend(m for m in recent if m.get("role") != "user")

        prompt_bundle: PromptBundle | None = None
        task_type = PromptManager.resolve_task_type(thread=thread, run=run)
        if task_type == "agent":
            preset_id = settings_service.get_active_preset_id(db, run.user_id)
            if preset_id is not None:
                renderer = PromptRenderer(db, user_id=run.user_id, preset_id=preset_id)
                pm = PromptManager(renderer)
                prompt_name = "planMode" if run.run_mode == "planMode" else "agentMode"
                prompt_map = pm._load_latest_prompt_map(
                    db, user_id=run.user_id, preset_id=preset_id,
                    task_type=task_type, prompt_name=prompt_name,
                )
                if "memoryPrompt" in prompt_map:
                    target = PromptTarget(
                        task_type=task_type,
                        prompt_name=prompt_name,
                        required_categories=("systemPrompt", "memoryPrompt", "userPrompt", "firstUserPrompt", "lastUserPrompt"),
                        supports_memory_prompt=True,
                    )
                    prompt_bundle = PromptBundle(
                        target=target,
                        prompt_map=prompt_map,
                        template_data={
                            "config": {"mainLanguage": run.language, "displayLanguage": run.language},
                            "project": {},
                            "input": {"userMessage": "", "agentMessage": "", "toolResults": []},
                            "memory": {"summaries": [], "ragTexts": [], "historyChats": []},
                        },
                        system_prompt=system_prompt,
                        prefill=prefill,
                        has_memory_prompt=True,
                    )

        return system_prompt, conversation, prefill, prompt_bundle

    async def _run_llm(
        self,
        db: Session,
        *,
        run: RunModel,
        thread: Thread,
        settings: UserSettings,
        system_prompt: str,
        conversation: list[dict[str, Any]],
        prefill: str | None,
        prompt_bundle: PromptBundle | None,
        assistant_message_ref_out: list[RunMessageModel | None],
    ) -> None:
        preset_id = settings_service.get_active_preset_id(db, run.user_id)
        if preset_id is None:
            raise RuntimeError("No active preset selected")

        prompt_manager: PromptManager | None = None
        if prompt_bundle is not None:
            renderer = PromptRenderer(db, user_id=run.user_id, preset_id=preset_id)
            prompt_manager = PromptManager(renderer)

        last_user_text, last_assistant_text = self._extract_last_texts(conversation)
        memory_prompt: str | None = None
        if prompt_bundle is not None and prompt_manager is not None:
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

        task_type = prompt_bundle.target.task_type if prompt_bundle else PromptManager.resolve_task_type(thread=thread, run=run)
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
            if prompt_bundle is None or prompt_manager is None:
                return current_conversation, None
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
        assistant_message_ref_out[0] = assistant_message

        resolved_mode = run.resolved_output_mode
        use_native = resolved_mode == "native_tool_call"
        use_raw = resolved_mode == "raw_output"

        sub_agent_allowed: set[str] | None = None
        if use_raw:
            # Raw output: no tools at all.
            tool_defs: list[ToolSchemaDef] = []
            schema_by_name: dict[str, ToolSchemaDef] = {}
            tools_wire = None
        else:
            tool_set_name = run.resolved_toolset
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

            # Sub-agent tool restrictions.
            if thread.thread_type == "subAgent" and thread.owner_id:
                defn = db.query(SubAgentDefinitionModel).filter(
                    SubAgentDefinitionModel.id == thread.owner_id
                ).first()
                if defn and isinstance(defn.allowed_tool_names, list):
                    sub_agent_allowed = set(defn.allowed_tool_names)
                    if isinstance(defn.allowed_sub_agent_ids, list) and defn.allowed_sub_agent_ids:
                        child_defs = db.query(SubAgentDefinitionModel).filter(
                            SubAgentDefinitionModel.id.in_(defn.allowed_sub_agent_ids)
                        ).all()
                        for cd in child_defs:
                            sub_agent_allowed.add(f"call_{cd.agent_name}")
                    tool_defs = [d for d in tool_defs if d.name in sub_agent_allowed]

            schema_by_name = {d.name: d for d in tool_defs}
            tools_wire = None if use_native else self._provider_tools(tool_defs)

        provider_config = credential_service.get_provider_config(db, run.user_id, task_config.provider)
        if task_config.provider == "custom":
            provider_config = {
                **provider_config,
                "request_format": task_config.advanced.get("request_format") or "openai_sdk",
            }

        provider = ProviderRegistry.get_provider(task_config.provider, provider_config)
        if not provider.validate_config():
            raise RuntimeError(f"Invalid provider configuration: {task_config.provider}")

        messages = [{"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]}] + conversation

        await self._emit(
            project_id=run.project_id,
            thread_id=thread.id,
            event_name="llm:request",
            data={
                "run_id": str(run.id),
                "message_id": str(assistant_message.id),
                "provider": task_config.provider,
                "model": task_config.model,
                "temperature": float(task_config.temperature),
                "max_tokens": task_config.max_output_tokens,
                "tool_choice": "auto" if tools_wire else None,
                "thinking_config": task_config.advanced.get("thinking_config") if isinstance(task_config.advanced, dict) else None,
                "thinking_mode": task_config.advanced.get("thinking_mode") if isinstance(task_config.advanced, dict) else "off",
                "native_tool_call": use_native,
                "messages": messages,
                "tools": tools_wire,
            },
        )

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
            native_tool_call=use_native,
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

        if use_native:
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
            allowed_tool_names=sub_agent_allowed,
        )

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

        await self._complete_parent_tool_call(db, thread, run)

    async def _complete_parent_tool_call(self, db: Session, thread: Thread, run: RunModel) -> None:
        """When a sub-agent run completes, mark the parent tool call as applied."""
        if thread.thread_type != "subAgent" or run.status != "done":
            return

        parent_tc = (
            db.query(RunToolCallModel)
            .filter(RunToolCallModel.child_thread_id == thread.id)
            .first()
        )
        if parent_tc is None or parent_tc.status != "processing":
            return

        # Extract final assistant message text as the result
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
            result_text = "\n".join(
                p.get("text", "") for p in parts if p.get("type") == "content"
            )

        parent_tc.status = "applied"
        parent_tc.result = {"success": True, "content": result_text}
        parent_tc.updated_at = datetime.utcnow()

        parent_thread = db.query(Thread).filter(Thread.id == parent_tc.thread_id).first()
        parent_run = db.query(RunModel).filter(RunModel.id == parent_tc.run_id).first()
        if not parent_thread or not parent_run:
            db.commit()
            return

        # Sync parent run/thread status from tool call statuses
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

        await self._emit(
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
        await self._emit(
            project_id=parent_thread.project_id,
            thread_id=parent_thread.id,
            event_name="run:status",
            data={
                "run_id": str(parent_run.id),
                "status": parent_run.status,
                "error": parent_run.error,
            },
        )

    async def execute_loop(self, run_id: UUID, *, create_ctx: CreateContext | None = None) -> None:
        db = self._db_factory()
        assistant_message_ref: list[RunMessageModel | None] = [None]
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
                data={"run_id": str(run.id), "status": "running", "thread_type": thread.thread_type},
            )

            settings: UserSettings = settings_service._get_settings(db, run.user_id)  # pylint: disable=protected-access

            if create_ctx is not None:
                system_prompt, conversation, prefill, prompt_bundle = await self._assemble_create(
                    db, run=run, thread=thread, settings=settings, create_ctx=create_ctx,
                )
            else:
                system_prompt, conversation, prefill, prompt_bundle = self._assemble_resume(
                    db, run=run, thread=thread, settings=settings,
                )

            await self._run_llm(
                db,
                run=run,
                thread=thread,
                settings=settings,
                system_prompt=system_prompt,
                conversation=conversation,
                prefill=prefill,
                prompt_bundle=prompt_bundle,
                assistant_message_ref_out=assistant_message_ref,
            )
        except asyncio.CancelledError:
            try:
                run = db.query(RunModel).filter(RunModel.id == run_id).first()
                if run is not None:
                    thread = run.thread
                    run.status = "canceled"
                    if thread is not None:
                        thread.status = "canceled"
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
                    if thread is not None:
                        if assistant_message_ref[0] is not None:
                            await self._emit(
                                project_id=run.project_id,
                                thread_id=thread.id,
                                event_name="message:end",
                                data={
                                    "run_id": str(run.id),
                                    "message_id": str(assistant_message_ref[0].id),
                                    "seq_in_thread": int(assistant_message_ref[0].seq_in_thread),
                                    "data": assistant_message_ref[0].data or {},
                                },
                            )
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="run:canceled",
                            data={"run_id": str(run.id)},
                        )
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="run:status",
                            data={"run_id": str(run.id), "status": "canceled"},
                        )
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
                try:
                    db.commit()
                except Exception:
                    db.rollback()
                if thread is not None:
                    if assistant_message_ref[0] is not None:
                        await self._emit(
                            project_id=run.project_id,
                            thread_id=thread.id,
                            event_name="message:end",
                            data={
                                "run_id": str(run.id),
                                "message_id": str(assistant_message_ref[0].id),
                                "seq_in_thread": int(assistant_message_ref[0].seq_in_thread),
                                "data": assistant_message_ref[0].data or {},
                            },
                        )
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
