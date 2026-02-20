from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.db_models import (
    Manuscript,
    RunMessageModel,
    RunModel,
    RunToolCallModel,
    Thread,
    UserSettings,
)
from ..models.translation_models import ObjectVersion
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
from ..services.prompt_runtime.output_mode import resolve_output_mode
from ..services.prompt_runtime.prompt_manager import PromptBundle, PromptManager, PromptTarget
from ..services.prompt_runtime.project_data_builder import build_project_data
from ..services.prompt_runtime.prompt_renderer import PromptRenderer
from ..services.object_service import object_service
from ..services.settings_service import settings_service
from ..services.sidecar_client import sidecar_client
from ..services.tool_engine import tool_engine
from ..services.tool_engine.contracts import ToolOffer
from ..services.token_count_service import count_text_tokens
from ..services.context_manager import fit_to_context_window
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

    @staticmethod
    def _as_str_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if item is not None and str(item).strip()]

    @staticmethod
    def _as_dict(value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _collapse_content_text(parts: list[dict[str, Any]]) -> str:
        chunks: list[str] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if str(part.get("type") or "") != "content":
                continue
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
        return "".join(chunks).strip()

    @staticmethod
    def _content_to_doc(content: str) -> dict[str, Any]:
        return {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": content}],
                }
            ],
        }

    async def _apply_raw_output(
        self,
        db: Session,
        *,
        thread: Thread,
        run: RunModel,
        input_payload: dict[str, Any],
        content_parts: list[dict[str, Any]],
    ) -> None:
        journey_kind = str(thread.journey_kind or "").strip()
        text = self._collapse_content_text(content_parts)
        if not text:
            raise RuntimeError("Raw output mode requires non-empty content text")

        if journey_kind in {"imagePrompt", "sceneImagePrompt"}:
            return

        if journey_kind == "messageTranslation":
            translation_payload = self._as_dict(input_payload.get("translation"))
            source_thread_id = UUID(str(translation_payload.get("sourceThreadId") or ""))
            source_message_id = UUID(str(translation_payload.get("sourceMessageId") or ""))
            target_language = str(translation_payload.get("targetLanguage") or run.language).strip()
            if not target_language:
                raise RuntimeError("messageTranslation raw output requires translation.targetLanguage")

            source_thread = (
                db.query(Thread)
                .filter(
                    Thread.id == source_thread_id,
                    Thread.user_id == run.user_id,
                )
                .first()
            )
            if source_thread is None:
                raise RuntimeError("messageTranslation source thread not found")

            source_message = (
                db.query(RunMessageModel)
                .filter(
                    RunMessageModel.id == source_message_id,
                    RunMessageModel.thread_id == source_thread_id,
                )
                .first()
            )
            if source_message is None:
                raise RuntimeError("messageTranslation source message not found")

            entry: dict[str, Any] = {
                "contentParts": [{"type": "content", "text": text}],
                "thinkingDetails": [],
            }
            current = source_message.data if isinstance(source_message.data, dict) else {}
            updated = dict(current)
            updated[target_language] = entry
            source_message.data = updated
            db.flush()

            await self._emit(
                project_id=source_thread.project_id,
                thread_id=source_thread.id,
                event_name="message:update",
                data={
                    "run_id": str(run.id),
                    "message_id": str(source_message.id),
                    "data": {target_language: entry},
                },
            )
            return

        if journey_kind == "objectEdit":
            category = str(input_payload.get("category") or "").strip()
            target_id = UUID(str(input_payload.get("targetId") or ""))
            user_request = str(input_payload.get("userRequest") or "").strip() or "raw:objectEdit"

            if category == "manuscript":
                manuscript = (
                    db.query(Manuscript)
                    .filter(Manuscript.chapter_id == target_id)
                    .first()
                )
                if manuscript is None:
                    raise RuntimeError("objectEdit manuscript target not found")
                object_service.update_object(
                    db,
                    project_id=run.project_id,
                    object_type="manuscript",
                    object_id=manuscript.id,
                    data={
                        "doc": self._content_to_doc(text),
                        "wordCount": len(text.split()),
                    },
                    language=run.language,
                    user_request=user_request,
                    created_by=run.user_id,
                )
                return

            current = object_service.get_object(
                db,
                object_type=category,
                object_id=target_id,
                project_id=run.project_id,
                language=run.language,
            )
            if current is None:
                raise RuntimeError("objectEdit target object not found")

            data_by_lang = current.get("data", {}) if isinstance(current.get("data"), dict) else {}
            current_data = data_by_lang.get(run.language) if isinstance(data_by_lang.get(run.language), dict) else {}
            if not current_data:
                for entry in data_by_lang.values():
                    if isinstance(entry, dict):
                        current_data = dict(entry)
                        break
            next_data = dict(current_data)
            if category == "basic_info":
                next_data["logline"] = text
            elif category == "guidelines":
                next_data["authorNote"] = text
            else:
                next_data["content"] = text

            object_service.update_object(
                db,
                project_id=run.project_id,
                object_type=category,
                object_id=target_id,
                data=next_data,
                language=run.language,
                user_request=user_request,
                created_by=run.user_id,
            )
            return

        if journey_kind == "objectTranslation":
            translation_payload = self._as_dict(input_payload.get("translation"))
            object_ids = self._as_str_list(translation_payload.get("objectIds"))
            if len(object_ids) != 1:
                raise RuntimeError("objectTranslation raw output requires exactly one objectId")

            target_language = str(translation_payload.get("targetLanguage") or "").strip()
            if not target_language:
                raise RuntimeError("objectTranslation raw output requires targetLanguage")

            object_id = UUID(object_ids[0])
            object_type_row = (
                db.query(ObjectVersion.object_type)
                .filter(ObjectVersion.object_id == object_id)
                .order_by(ObjectVersion.version_number.desc())
                .first()
            )
            if object_type_row is None:
                raise RuntimeError("objectTranslation target object not found")

            object_type = str(object_type_row[0] or "").strip()
            current = object_service.get_object(
                db,
                object_type=object_type,
                object_id=object_id,
                project_id=run.project_id,
                language=target_language,
            )
            if current is None:
                raise RuntimeError("objectTranslation target object not found in project")

            data_by_lang = current.get("data", {}) if isinstance(current.get("data"), dict) else {}
            target_data = data_by_lang.get(target_language) if isinstance(data_by_lang.get(target_language), dict) else {}
            if not target_data:
                for entry in data_by_lang.values():
                    if isinstance(entry, dict):
                        target_data = dict(entry)
                        break
            next_data = dict(target_data)
            if object_type == "manuscript":
                next_data = {
                    "doc": self._content_to_doc(text),
                    "wordCount": len(text.split()),
                }
            elif object_type == "basic_info":
                next_data["logline"] = text
            elif object_type == "guidelines":
                next_data["authorNote"] = text
            else:
                next_data["content"] = text

            object_service.update_object(
                db,
                project_id=run.project_id,
                object_type=object_type,
                object_id=object_id,
                data=next_data,
                language=target_language,
                user_request="raw:objectTranslation",
                created_by=run.user_id,
            )
            return

        raise RuntimeError(f"Unsupported journey kind for raw output: {journey_kind}")

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
        offer: ToolOffer,
        preset_id: UUID | None,
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

            validation = await tool_engine.validate_tool_call(
                db=db,
                thread=thread,
                run=run,
                tool_name=tool_name,
                args=arguments,
                offer=offer,
                user_id=run.user_id,
                project_id=run.project_id,
                language=run.language,
                preset_id=preset_id,
            )
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
        )

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
        input_payload: dict[str, Any],
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

        output_mode = resolve_output_mode(
            journey_kind=thread.journey_kind,
            payload=input_payload if isinstance(input_payload, dict) else {},
            native_output_mode=bool(getattr(settings, "native_output_mode", False)),
        )

        tool_set_name = tool_engine.tool_set_for_run(
            thread,
            run,
            input_payload=input_payload if isinstance(input_payload, dict) else {},
        )
        tool_offer = tool_engine.build_offer_for_run(
            db,
            thread=thread,
            run=run,
            settings=settings,
            preset_id=preset_id,
            user_id=run.user_id,
            project_id=run.project_id,
            input_payload=input_payload if isinstance(input_payload, dict) else {},
            rag_search_enabled=bool(getattr(settings, "rag_search_enabled", False)),
            tool_set_name=tool_set_name,
        )

        provider_config = credential_service.get_provider_config(db, run.user_id, task_config.provider)
        if task_config.provider == "custom":
            provider_config = {
                **provider_config,
                "request_format": task_config.advanced.get("request_format") or "openai_sdk",
            }

        provider = ProviderRegistry.get_provider(task_config.provider, provider_config)
        if not provider.validate_config():
            raise RuntimeError(f"Invalid provider configuration: {task_config.provider}")

        native_tool_call_mode = output_mode == "native_tool_call"
        if output_mode == "raw_output":
            tools_wire = None
        elif native_tool_call_mode:
            tools_wire = None
        else:
            tools_wire = tool_offer.provider_tools

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
                "native_tool_call": native_tool_call_mode,
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
            native_tool_call=native_tool_call_mode,
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

        if native_tool_call_mode:
            final_snapshot = extract_native_tool_calls_from_snapshot(final_snapshot)

        if output_mode == "raw_output" and final_snapshot.tool_calls:
            raise RuntimeError("Raw output mode cannot include tool calls")

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

        persisted_tools: list[RunToolCallModel] = []
        if output_mode == "raw_output":
            await self._apply_raw_output(
                db,
                thread=thread,
                run=run,
                input_payload=input_payload if isinstance(input_payload, dict) else {},
                content_parts=final_snapshot.content_parts,
            )
        else:
            persisted_tools = await self._persist_tool_calls(
                db,
                thread=thread,
                run=run,
                assistant_message=assistant_message,
                tool_calls=final_snapshot.tool_calls,
                offer=tool_offer,
                preset_id=preset_id,
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

        await tool_engine.complete_parent_tool_call(
            db,
            thread=thread,
            run=run,
            emit=self._emit,
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
                input_payload=create_ctx.input_payload if create_ctx is not None else {},
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
