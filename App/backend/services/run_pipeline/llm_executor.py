from __future__ import annotations

from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, RunToolCallModel, Thread, UserSettings
from ...providers.contracts import (
    DeltaPayload,
    MetaPayload,
    ProviderErrorPayload,
    extract_native_tool_calls_from_snapshot,
    merge_meta_payload,
    patch_snapshot_with_meta,
)
from ...providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ...providers.registry import ProviderRegistry
from ..credential_service import credential_service
from ..memory_builder import build_memory_prompt
from ..prompt_runtime.output_mode import resolve_output_mode
from ..prompt_runtime.prompt_manager import PromptBundle, PromptManager
from ..prompt_runtime.prompt_renderer import PromptRenderer
from ..reasoning.history_filter import filter_history_by_run
from ..reasoning.mode_policy import apply_thinking_mode
from ..reasoning.normalize import normalize_reasoning_detail
from ..settings_service import settings_service
from ..token_count_service import count_message_tokens
from ..tool_engine import tool_engine
from ..tool_engine.contracts import ToolOffer
from ..context_manager import fit_to_context_window
from .contracts import ToolDeltaState
from .text_utils import count_tokens, extract_last_texts
from . import memory_preflight as _mem
from . import raw_output as _raw

EmitFn = Callable[..., Awaitable[None]]
PersistToolCallsFn = Callable[..., Awaitable[list[RunToolCallModel]]]


def _strip_internal_message_keys(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        item = dict(message)
        item.pop("run_id", None)
        item.pop("seq_in_thread", None)
        out.append(item)
    return out


def _first_openrouter_format(details: list[dict[str, Any]]) -> str | None:
    for detail in details:
        if not isinstance(detail, dict):
            continue
        fmt = detail.get("format")
        if isinstance(fmt, str) and fmt.strip():
            return fmt
    return None


def _reasoning_text_from_parts(content_parts: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for part in content_parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "thinking":
            continue
        text = part.get("text")
        if isinstance(text, str) and text:
            chunks.append(text)
    return "".join(chunks)


def _build_reasoning_detail(
    *,
    provider: str,
    thinking_mode: str,
    advanced: dict[str, Any],
    content_parts: list[dict[str, Any]],
    thinking_details: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if thinking_mode == "off":
        return None

    thinking_text = _reasoning_text_from_parts(content_parts)
    has_reasoning = bool(thinking_text.strip()) or bool(thinking_details)
    if not has_reasoning:
        return None

    provider_name = str(provider or "").strip().lower()
    if thinking_mode == "custom":
        return normalize_reasoning_detail(
            {
                "type": "custom",
                "meta": {"provider": "custom"},
                "data": {"text": thinking_text},
                "token_count": 0,
            }
        )

    if provider_name == "openai":
        payload = {
            "type": "openai",
            "meta": {"provider": "openai"},
            "data": {"items": list(thinking_details)},
            "token_count": 0,
        }
        return normalize_reasoning_detail(payload)

    if provider_name == "gemini":
        payload = {
            "type": "gemini",
            "meta": {"provider": "gemini"},
            "data": {"parts": list(thinking_details)},
            "token_count": 0,
        }
        return normalize_reasoning_detail(payload)

    if provider_name == "claude":
        payload = {
            "type": "claude",
            "meta": {"provider": "claude"},
            "data": {"details": list(thinking_details)},
            "token_count": 0,
        }
        return normalize_reasoning_detail(payload)

    if provider_name == "openrouter":
        details = [d for d in thinking_details if isinstance(d, dict)]
        fmt = _first_openrouter_format(details)
        meta: dict[str, Any] = {"provider": "openrouter"}
        if fmt is not None:
            meta["openrouter_reasoning_format"] = fmt
        payload = {
            "type": "openrouter",
            "meta": meta,
            "data": {
                "reasoning": thinking_text,
                "reasoning_details": details,
            },
            "token_count": 0,
        }
        return normalize_reasoning_detail(payload)

    if provider_name == "custom":
        thinking_format = str(advanced.get("thinking_format") or "openai").strip().lower()
        payload = {
            "type": "openai_compatible",
            "meta": {
                "provider": "custom",
                "openai_compatible_thinking_format": thinking_format,
            },
            "data": {"details": list(thinking_details), "text": thinking_text},
            "token_count": 0,
        }
        return normalize_reasoning_detail(payload)

    payload = {
        "type": "custom",
        "meta": {"provider": "custom"},
        "data": {"details": list(thinking_details), "text": thinking_text},
        "token_count": 0,
    }
    return normalize_reasoning_detail(payload)


def _reasoning_tokens_from_snapshot(final_snapshot: Any) -> int | None:
    value = getattr(final_snapshot, "reasoning_tokens", None)
    if isinstance(value, bool):
        value = int(value)
    if isinstance(value, int):
        return max(0, value)
    return None


async def _fill_reasoning_token_count(
    db: Session,
    *,
    run: RunModel,
    task_config: Any,
    final_snapshot: Any,
) -> int:
    direct = _reasoning_tokens_from_snapshot(final_snapshot)
    if isinstance(direct, int):
        return max(0, int(direct))

    usage = final_snapshot.usage if isinstance(final_snapshot.usage, dict) else {}
    total_output = int(usage.get("completion_tokens", 0) or 0)

    assistant_output_message = {
        "role": "assistant",
        "content_parts": [
            part
            for part in (final_snapshot.content_parts or [])
            if isinstance(part, dict) and part.get("type") == "content"
        ],
        "tool_calls": [
            {
                "id": str(tc.id),
                "type": "function",
                "function": {
                    "name": str(tc.tool_name),
                    "arguments": tc.raw_arguments,
                },
                **({"extra_content": tc.extra_content} if isinstance(tc.extra_content, dict) else {}),
            }
            for tc in (final_snapshot.tool_calls or [])
        ],
    }

    tokenizer_override = (
        task_config.advanced.get("tokenizer_override")
        if isinstance(getattr(task_config, "advanced", None), dict)
        else None
    )
    non_reasoning_tokens = await count_message_tokens(
        db,
        user_id=run.user_id,
        provider=task_config.provider,
        model=task_config.model,
        message=assistant_output_message,
        tokenizer_override=tokenizer_override,
    )

    estimated = total_output - int(non_reasoning_tokens)
    if estimated < 0:
        estimated = 0
    return int(estimated)


async def run_llm(
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
    emit_fn: EmitFn,
    persist_tool_calls_fn: PersistToolCallsFn,
) -> None:
    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise RuntimeError("No active preset selected")

    renderer: PromptRenderer | None = None
    prompt_manager: PromptManager | None = None
    if prompt_bundle is not None:
        renderer = PromptRenderer(db, user_id=run.user_id, preset_id=preset_id)
        prompt_manager = PromptManager(renderer)

    task_type = prompt_bundle.target.task_type if prompt_bundle else PromptManager.resolve_task_type(thread=thread, run=run)
    task_config = settings_service.get_task_config(db, run.user_id, task_type)
    tokenizer_override = task_config.advanced.get("tokenizer_override") if isinstance(task_config.advanced, dict) else None

    if prompt_bundle is not None and renderer is not None and prompt_bundle.has_memory_prompt:
        try:
            await _mem.prepare_thread_memory_preflight(
                db,
                run=run,
                thread=thread,
                task_config=task_config,
                tokenizer_override=tokenizer_override,
                prompt_bundle=prompt_bundle,
                renderer=renderer,
            )
        except Exception:
            # Fail-open: memory preflight failure must not fail the run.
            pass

    last_user_text, last_assistant_text = extract_last_texts(conversation)
    memory_prompt: str | None = None
    if prompt_bundle is not None and prompt_manager is not None:
        memory_prompt = await build_memory_prompt(
            db,
            prompt_manager=prompt_manager,
            prompt_bundle=prompt_bundle,
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            language=run.language,
            last_user_text=last_user_text,
            last_assistant_text=last_assistant_text,
        )
    memory_message_ref: dict[str, Any] | None = None
    if memory_prompt:
        memory_message_ref = {
            "role": "user",
            "content_parts": [{"type": "content", "text": memory_prompt}],
        }
        conversation.insert(0, memory_message_ref)

    async def _token_counter(text: str) -> int:
        return await count_tokens(
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
        new_user, new_asst = extract_last_texts(cleaned)
        new_mem = await build_memory_prompt(
            db,
            prompt_manager=prompt_manager,
            prompt_bundle=prompt_bundle,
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            language=run.language,
            last_user_text=new_user,
            last_assistant_text=new_asst,
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

    await emit_fn(
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

    advanced = task_config.advanced if isinstance(task_config.advanced, dict) else {}
    thinking_mode = str(advanced.get("thinking_mode") or "off")
    tool_history_limit = int(getattr(settings, "tool_call_history_limit", 5) or 0)
    thinking_history_limit = int(getattr(settings, "thinking_history_limit", 5) or 0)

    messages = [{"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]}] + conversation
    messages = filter_history_by_run(
        messages,
        current_run_id=str(run.id),
        tool_limit=tool_history_limit,
        thinking_limit=thinking_history_limit,
    )
    messages = apply_thinking_mode(messages, thinking_mode)
    provider_messages = _strip_internal_message_keys(messages)
    effective_thinking_config = advanced.get("thinking_config") if thinking_mode == "model" else None

    await emit_fn(
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
            "thinking_config": effective_thinking_config,
            "thinking_mode": thinking_mode,
            "native_tool_call": native_tool_call_mode,
            "messages": provider_messages,
            "tools": tools_wire,
        },
    )

    stream = provider.stream_chat(
        messages=provider_messages,
        model=task_config.model,
        temperature=float(task_config.temperature),
        tools=tools_wire,
        tool_choice="auto" if tools_wire else None,
        max_tokens=task_config.max_output_tokens,
        provider_preference=advanced.get("provider_preference"),
        thinking_config=effective_thinking_config,
        thinking_mode=thinking_mode,
        thinking_format=advanced.get("thinking_format"),
        request_format=advanced.get("request_format"),
        retry_config=settings_service.get_retry_config(db, run.user_id),
        native_tool_call=native_tool_call_mode,
    )

    assembler = FallbackSnapshotAssembler(provider=task_config.provider, model=task_config.model)
    native_final = None
    merged_meta: MetaPayload | None = None

    collected_parts: list[dict[str, str]] = []
    delta_state_by_index: dict[int, ToolDeltaState] = {}

    async for event in stream:
        if event.kind == "delta" and event.delta is not None:
            delta: DeltaPayload = event.delta
            assembler.apply_delta(delta)

            if delta.content_delta:
                collected_parts.append({"type": "content", "text": delta.content_delta})
                await emit_fn(
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
                await emit_fn(
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
                    state = ToolDeltaState(llm_call_id=init_id, name="", raw_arguments="")
                    delta_state_by_index[idx] = state
                    await emit_fn(
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
                    await emit_fn(
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

    reasoning_detail = _build_reasoning_detail(
        provider=task_config.provider,
        thinking_mode=thinking_mode,
        advanced=advanced,
        content_parts=final_snapshot.content_parts,
        thinking_details=final_snapshot.thinking_details,
    )
    if reasoning_detail is not None:
        reasoning_detail["token_count"] = await _fill_reasoning_token_count(
            db,
            run=run,
            task_config=task_config,
            final_snapshot=final_snapshot,
        )

    db.refresh(run)
    db.refresh(thread)
    assistant_message = db.query(RunMessageModel).filter(RunMessageModel.id == assistant_message.id).first()
    if assistant_message is None:
        raise RuntimeError("Assistant message row missing")

    language_entry: dict[str, Any] = {"contentParts": final_snapshot.content_parts}
    final_entry: dict[str, Any] = {"contentParts": final_snapshot.content_parts}
    if reasoning_detail is not None:
        language_entry["reasoningDetail"] = reasoning_detail
        final_entry["reasoningDetail"] = reasoning_detail
    assistant_message.data = {
        run.language: language_entry,
        "_final": final_entry,
    }

    persisted_tools: list[RunToolCallModel] = []
    if output_mode == "raw_output":
        await _raw.apply_raw_output(
            db,
            thread=thread,
            run=run,
            input_payload=input_payload if isinstance(input_payload, dict) else {},
            content_parts=final_snapshot.content_parts,
            emit_fn=emit_fn,
        )
    else:
        persisted_tools = await persist_tool_calls_fn(
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

    await emit_fn(
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
    await emit_fn(
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="run:status",
        data={
            "run_id": str(run.id),
            "status": run.status,
            "error": run.error,
        },
    )
    await emit_fn(
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
        emit=emit_fn,
    )
