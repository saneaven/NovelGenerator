from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread
from ..settings_service import settings_service
from ..storage_usage_service import (
    apply_project_usage_deltas,
    build_usage_delta_for_amount,
    measure_run_message_row,
    measure_tool_call_row,
)
from ..tool_engine import tool_engine
from ..tool_engine.contracts import ToolOffer
from .runtime import RunPipelineRuntime


class RunToolCallPersistence:
    def __init__(self, *, runtime: RunPipelineRuntime) -> None:
        self._runtime = runtime

    async def persist_tool_calls(
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
        deltas = []

        for idx, tc in enumerate(tool_calls):
            llm_call_id = str(tc.id or f"tool_call_{idx}")
            tool_name = str(tc.tool_name or "")
            arguments = tc.arguments if isinstance(tc.arguments, dict) else {}
            parse_error = str(getattr(tc, "parse_error", "") or "").strip() or None
            stream_key = llm_call_id if llm_call_id.startswith(("index:", "anon:")) else f"id:{llm_call_id}"

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
                extra_content=(
                    tc.extra_content
                    if isinstance(getattr(tc, "extra_content", None), dict)
                    else None
                ),
                status="validating",
            )
            db.add(row)
            db.flush()

            tool_msg.parent_tool_call_id = row.id

            binding_map = getattr(offer, "bindings_by_name", {}) or {}
            binding = binding_map.get(tool_name) if isinstance(binding_map, dict) else None
            if binding is not None:
                settings = settings_service._get_settings(db, run.user_id)  # pylint: disable=protected-access
                vector_storage_enabled = settings_service.is_vector_storage_enabled(db, run.user_id)
                preset_id_value = preset_id or settings_service.get_active_preset_id(db, run.user_id)
                if preset_id_value is not None:
                    module_ctx = tool_engine.build_module_context(
                        db,
                        thread=thread,
                        run=run,
                        settings=settings,
                        preset_id=preset_id_value,
                        user_id=run.user_id,
                        project_id=run.project_id,
                        input_payload=run.input_payload if isinstance(run.input_payload, dict) else {},
                        vector_storage_enabled=vector_storage_enabled,
                    )
                    try:
                        persisted_meta = binding.build_persisted_meta(module_ctx, arguments)
                        extra_content = row.extra_content if isinstance(row.extra_content, dict) else {}
                        row.extra_content = {
                            **extra_content,
                            "__tool_meta": asdict(persisted_meta),
                        }
                    except Exception:
                        pass

            if parse_error is not None:
                row.status = "failed"
                row.reason = f"[parse_tool_call_arguments] {parse_error}"
            else:
                validation = await tool_engine.validate_tool_call(
                    db=db,
                    thread=thread,
                    run=run,
                    settings=settings_service._get_settings(db, run.user_id),  # pylint: disable=protected-access
                    tool_name=tool_name,
                    args=arguments,
                    offer=offer,
                    user_id=run.user_id,
                    project_id=run.project_id,
                    language=run.language,
                    preset_id=preset_id,
                    input_payload=run.input_payload if isinstance(run.input_payload, dict) else {},
                    vector_storage_enabled=settings_service.is_vector_storage_enabled(db, run.user_id),
                )
                if validation.valid:
                    row.status = "pending"
                    row.reason = None
                else:
                    row.status = "failed"
                    row.reason = (
                        f"[{validation.validator}] {validation.reason}"
                        if validation.validator
                        else validation.reason
                    )

            deltas.append(
                build_usage_delta_for_amount(
                    category="chat",
                    before_amount=0,
                    after_amount=measure_run_message_row(tool_msg),
                )
            )
            deltas.append(
                build_usage_delta_for_amount(
                    category="chat",
                    before_amount=0,
                    after_amount=measure_tool_call_row(row),
                )
            )
            out.append(row)

            await self._runtime.emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:end",
                data={
                    "run_id": str(run.id),
                    "stream_key": stream_key,
                    "tool_call_id": str(row.id),
                    "message_id": str(tool_msg.id),
                    "assistant_message_id": str(assistant_message.id),
                    "index": idx,
                    "name": tool_name,
                    "arguments": arguments,
                    "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
                    "status": row.status,
                    "seq_in_thread": int(tool_msg.seq_in_thread),
                },
            )
            await self._runtime.emit(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="tool_call:status",
                data={
                    "run_id": str(run.id),
                    "tool_call_id": str(row.id),
                    "status": row.status,
                    "reason": row.reason,
                    "result": row.result,
                    "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
                    "assistant_message_id": str(row.assistant_message_id) if row.assistant_message_id else None,
                    "child_thread_id": str(row.child_thread_id) if row.child_thread_id else None,
                },
            )

        if deltas:
            apply_project_usage_deltas(
                db,
                user_id=run.user_id,
                project_id=run.project_id,
                deltas=deltas,
                enforce_quota=True,
            )

        return out
