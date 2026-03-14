from __future__ import annotations

from typing import Any, Awaitable, Callable

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
from ...providers.content_normalization import (
    StreamContentNormalizer,
    has_effective_delta,
    normalize_final_snapshot_content,
)
from ...providers.fallback_snapshot_assembler import FallbackSnapshotAssembler
from ...providers.registry import ProviderRegistry
from ..memory_builder import build_memory_prompt
from ..mcp import mcp_sync_service
from ..prompt_runtime.output_mode import resolve_output_mode
from ..prompt_runtime.contracts import ScenarioBundle
from ..prompt_runtime.scenario_manager import ScenarioManager
from ..prompt_runtime.template_renderer import TemplateRenderer, load_user_fragment_map
from ..reasoning.history_filter import filter_history_by_run
from ..reasoning.mode_policy import apply_thinking_mode
from ..reasoning.normalize import normalize_reasoning_detail
from ..reasoning.provider_io import get_provider_io
from ..settings_service import settings_service
from ..llm_runtime_service import get_llm_runtime
from ..storage_usage_service import (
    apply_project_usage_delta,
    build_run_message_delta,
    snapshot_run_message_row,
)
from ...providers.stream_retry import normalize_retry_config, stream_with_retry
from ..token_count_service import count_conversation_tokens, count_message_tokens
from ..thread_parent_runtime_service import resolve_parent
from ..tool_engine import tool_engine
from ..tool_engine.contracts import ToolOffer
from ..context_manager import fit_to_context_window
from .contracts import ToolDeltaState
from .text_utils import extract_last_texts
from . import memory_preflight as _mem
from . import raw_output as _raw

EmitFn = Callable[..., Awaitable[None]]
PersistToolCallsFn = Callable[..., Awaitable[list[RunToolCallModel]]]
SyncStatusFn = Callable[..., Awaitable[None]]


def _strip_internal_message_keys(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        item = dict(message)
        item.pop("run_id", None)
        item.pop("seq_in_thread", None)
        item.pop("is_memory_prompt", None)
        out.append(item)
    return out


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


def _build_custom_reasoning_detail(content_parts: list[dict[str, Any]]) -> dict[str, Any] | None:
    thinking_text = _reasoning_text_from_parts(content_parts)
    if not thinking_text.strip():
        return None
    return normalize_reasoning_detail(
        {
            "type": "custom",
            "meta": {"provider": "custom", "thinking_display": "text"},
            "data": {"text": thinking_text},
            "token_count": 0,
        }
    )


def _content_only_parts(parts: Any) -> list[dict[str, str]]:
    if not isinstance(parts, list):
        return []
    out: list[dict[str, str]] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "content":
            continue
        text = part.get("text")
        if not isinstance(text, str):
            continue
        out.append({"type": "content", "text": text})
    return out


def _tool_delta_id(tc_delta: dict[str, Any]) -> str | None:
    value = tc_delta.get("id")
    if isinstance(value, str) and value:
        return value
    return None


def _tool_delta_index(tc_delta: dict[str, Any]) -> int | None:
    value = tc_delta.get("index")
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return int(value)
    return None


def _resolve_stream_key(
    tc_delta: dict[str, Any],
    *,
    delta_state_by_key: dict[str, ToolDeltaState],
    state_key_by_index: dict[int, str],
    anonymous_counter: int,
) -> tuple[str, str, int | None, int]:
    call_id = _tool_delta_id(tc_delta)
    call_index = _tool_delta_index(tc_delta)

    if call_id is not None:
        id_key = f"id:{call_id}"
        if id_key in delta_state_by_key:
            if call_index is not None:
                state_key_by_index[call_index] = id_key
            return id_key, call_id, call_index, anonymous_counter

        if call_index is not None:
            mapped_key = state_key_by_index.get(call_index)
            if mapped_key is not None:
                existing_state = delta_state_by_key.get(mapped_key)
                if existing_state is not None:
                    if mapped_key.startswith("index:"):
                        delta_state_by_key.pop(mapped_key, None)
                        existing_state.stream_key = id_key
                        existing_state.llm_call_id = call_id
                        if existing_state.index is None:
                            existing_state.index = call_index
                        delta_state_by_key[id_key] = existing_state
                        state_key_by_index[call_index] = id_key
                    return id_key, call_id, call_index, anonymous_counter
                state_key_by_index.pop(call_index, None)

            state_key_by_index[call_index] = id_key
        return id_key, call_id, call_index, anonymous_counter

    if call_index is not None:
        mapped_key = state_key_by_index.get(call_index)
        if mapped_key is not None and mapped_key in delta_state_by_key:
            state = delta_state_by_key[mapped_key]
            return mapped_key, state.llm_call_id, call_index, anonymous_counter
        if mapped_key is not None:
            state_key_by_index.pop(call_index, None)

        stream_key = f"index:{call_index}"
        return stream_key, stream_key, call_index, anonymous_counter

    stream_key = f"anon:{anonymous_counter}"
    return stream_key, stream_key, None, anonymous_counter + 1


async def _fill_reasoning_token_count(
    db: Session,
    *,
    run: RunModel,
    task_config: Any,
    final_snapshot: Any,
    provider_io: Any,
) -> int:
    direct = provider_io.read_reasoning_tokens(final_snapshot)
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
    try:
        non_reasoning_tokens = await count_message_tokens(
            db,
            user_id=run.user_id,
            provider=task_config.provider,
            model=task_config.model,
            message=assistant_output_message,
            tokenizer_override=tokenizer_override,
        )
    except Exception:
        return 0

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
    scenario_bundle: ScenarioBundle | None,
    input_payload: dict[str, Any],
    assistant_message_ref_out: list[RunMessageModel | None],
    emit_fn: EmitFn,
    persist_tool_calls_fn: PersistToolCallsFn,
    sync_status_fn: SyncStatusFn,
) -> None:
    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise RuntimeError("No active preset selected")

    template_renderer: TemplateRenderer | None = None
    if scenario_bundle is not None and isinstance(scenario_bundle.memory_template, str) and scenario_bundle.memory_template.strip():
        fragment_map = load_user_fragment_map(db, run.user_id, preset_id)
        template_renderer = TemplateRenderer(fragment_map=fragment_map)

    task_type = scenario_bundle.task_type if scenario_bundle else ScenarioManager.resolve_task_type(db, thread=thread, run=run)
    resolved_runtime = get_llm_runtime(db, user_id=run.user_id, task_type=task_type)
    task_config = resolved_runtime.task_config
    tokenizer_override = task_config.advanced.get("tokenizer_override") if isinstance(task_config.advanced, dict) else None

    if scenario_bundle is not None and template_renderer is not None:
        try:
            await _mem.prepare_thread_memory_preflight(
                db,
                run=run,
                thread=thread,
                task_config=task_config,
                tokenizer_override=tokenizer_override,
                scenario_bundle=scenario_bundle,
                template_renderer=template_renderer,
                preset_id=preset_id,
            )
        except Exception:
            # Fail-open: memory preflight failure must not fail the run.
            pass

    last_user_text, last_assistant_text = extract_last_texts(conversation)
    memory_prompt: str | None = None
    if scenario_bundle is not None and template_renderer is not None and scenario_bundle.memory_template is not None:
        memory_prompt = await build_memory_prompt(
            db,
            template_renderer=template_renderer,
            memory_template=scenario_bundle.memory_template,
            template_data=scenario_bundle.template_data,
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
            "is_memory_prompt": True,
        }
        conversation.insert(0, memory_message_ref)

    async def _conversation_token_counter(
        current_system_prompt: str,
        current_conversation: list[dict[str, Any]],
    ) -> int:
        return await count_conversation_tokens(
            db,
            user_id=run.user_id,
            provider=task_config.provider,
            model=task_config.model,
            system_prompt=current_system_prompt,
            conversation=current_conversation,
            tokenizer_override=tokenizer_override,
        )

    async def _rebuild_memory(current_conversation: list[dict]) -> tuple[list[dict], str | None]:
        nonlocal memory_message_ref
        if scenario_bundle is None or template_renderer is None or not scenario_bundle.memory_template:
            return current_conversation, None
        cleaned = list(current_conversation)
        cleaned = [m for m in cleaned if not (isinstance(m, dict) and m.get("is_memory_prompt") is True)]
        new_user, new_asst = extract_last_texts(cleaned)
        new_mem = await build_memory_prompt(
            db,
            template_renderer=template_renderer,
            memory_template=scenario_bundle.memory_template,
            template_data=scenario_bundle.template_data,
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
                "is_memory_prompt": True,
            }
            cleaned.insert(0, memory_message_ref)
        return cleaned, new_mem

    assistant_message = RunMessageModel(
        thread_id=thread.id,
        run_id=run.id,
        seq=run.next_message_seq,
        seq_in_thread=thread.next_message_seq,
        role="assistant",
        data={run.language: {"contentParts": []}},
    )
    db.add(assistant_message)
    db.flush()
    run.next_message_seq += 1
    thread.next_message_seq += 1
    apply_project_usage_delta(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        delta=build_run_message_delta(None, snapshot_run_message_row(assistant_message)),
        enforce_quota=True,
    )
    db.commit()

    await emit_fn(
        user_id=run.user_id,
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

    parent = resolve_parent(db, thread)
    output_mode = resolve_output_mode(
        journey_kind=parent.journey_kind,
        payload=input_payload if isinstance(input_payload, dict) else {},
        native_output_mode=bool(getattr(settings, "native_output_mode", False)),
    )

    await mcp_sync_service.sync_stale_tool_servers(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        thread=thread,
        run=run,
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
        vector_storage_enabled=settings_service.is_vector_storage_enabled(db, run.user_id),
    )

    provider = ProviderRegistry.get_provider(task_config.provider, resolved_runtime.provider_config)
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
    provider_io = get_provider_io(task_config.provider, advanced)
    messages = [{"role": "system", "content_parts": [{"type": "content", "text": system_prompt}]}] + conversation
    messages = filter_history_by_run(
        messages,
        current_run_id=str(run.id),
        tool_limit=tool_history_limit,
        thinking_limit=thinking_history_limit,
    )
    messages = apply_thinking_mode(messages, thinking_mode)

    fit_system_prompt = system_prompt
    fit_conversation = list(messages)
    if fit_conversation and fit_conversation[0].get("role") == "system":
        system_parts = fit_conversation[0].get("content_parts")
        if isinstance(system_parts, list):
            fit_system_prompt = "".join(
                str(part.get("text") or "")
                for part in system_parts
                if isinstance(part, dict) and part.get("type") == "content"
            )
        fit_conversation = fit_conversation[1:]

    fit_conversation, memory_prompt = await fit_to_context_window(
        fit_system_prompt,
        fit_conversation,
        int(task_config.context_window_tokens or 32000),
        rebuild_memory_cb=_rebuild_memory,
        count_tokens_cb=_conversation_token_counter,
    )

    messages = [{"role": "system", "content_parts": [{"type": "content", "text": fit_system_prompt}]}] + fit_conversation

    # Resolve custom thinking template (custom provider + openai_completion only).
    # openai_response uses native reasoning support — templates don't apply.
    if (
        task_config.provider == "custom"
        and thinking_mode == "model"
        and advanced.get("custom_kind") != "openai_response"
    ):
        from ..reasoning.custom_template_runtime import compile_template
        template_id = advanced.get("custom_thinking_template_id")
        if template_id:
            templates = getattr(settings, "custom_thinking_templates", []) or []
            tpl_match = next((t for t in templates if isinstance(t, dict) and t.get("id") == template_id), None)
            if tpl_match:
                thinking_template = compile_template(tpl_match)
                if thinking_template:
                    provider.set_thinking_template(thinking_template)
                    advanced["_resolved_template"] = thinking_template

    messages = provider_io.to_provider_messages(messages, task_config.model, advanced)
    provider_messages = _strip_internal_message_keys(messages)
    # When a custom thinking template is resolved, the template's effort_fields handle
    # request body injection — don't pass the generic thinking_config alongside it.
    if advanced.get("_resolved_template"):
        effective_thinking_config = None
    else:
        effective_thinking_config = advanced.get("thinking_config") if thinking_mode == "model" else None
    stream_thinking_display = provider_io.get_stream_thinking_display_path(advanced)
    if isinstance(stream_thinking_display, str):
        stream_thinking_display = stream_thinking_display.strip() or None
    else:
        stream_thinking_display = None

    retry_cfg = normalize_retry_config(settings_service.get_retry_config(db, run.user_id))

    def _create_stream():
        return provider.stream_chat(
            messages=provider_messages,
            model=task_config.model,
            temperature=float(task_config.temperature),
            tools=tools_wire,
            tool_choice="auto" if tools_wire else None,
            max_tokens=task_config.max_output_tokens,
            provider_preference=getattr(task_config, "provider_preference", None),
            thinking_config=effective_thinking_config,
            thinking_mode=thinking_mode,
            custom_kind=advanced.get("custom_kind"),
            native_tool_call=native_tool_call_mode,
            verbosity=advanced.get("verbosity"),
        )

    stream = stream_with_retry(_create_stream, retry_cfg)

    assembler = FallbackSnapshotAssembler(provider=task_config.provider, model=task_config.model)
    content_normalizer = StreamContentNormalizer()
    native_final = None
    merged_meta: MetaPayload | None = None
    raw_response: dict[str, Any] | None = None

    delta_state_by_key: dict[str, ToolDeltaState] = {}
    state_key_by_index: dict[int, str] = {}
    anonymous_tool_call_counter = 0

    async for event in stream:
        if event.raw_request is not None:
            await emit_fn(
                user_id=run.user_id,
                project_id=run.project_id,
                thread_id=thread.id,
                event_name="llm:request",
                data={
                    "run_id": str(run.id),
                    "message_id": str(assistant_message.id),
                    "provider": task_config.provider,
                    "model": task_config.model,
                    "raw_request": event.raw_request,
                },
            )
            continue
        if event.raw_response is not None:
            raw_response = event.raw_response
        if event.kind == "delta" and event.delta is not None:
            delta: DeltaPayload = content_normalizer.normalize_delta(event.delta)
            assembler.apply_delta(delta)
            if not has_effective_delta(delta):
                continue

            if delta.content_delta:
                await emit_fn(
                    user_id=run.user_id,
                    project_id=run.project_id,
                    thread_id=thread.id,
                    event_name="content:delta",
                    data={
                        "run_id": str(run.id),
                        "message_id": str(assistant_message.id),
                        "text": delta.content_delta,
                    },
                )

            if thinking_mode != "off" and delta.thinking_delta and stream_thinking_display:
                await emit_fn(
                    user_id=run.user_id,
                    project_id=run.project_id,
                    thread_id=thread.id,
                    event_name="thinking:delta",
                    data={
                        "run_id": str(run.id),
                        "message_id": str(assistant_message.id),
                        "text": delta.thinking_delta,
                        "thinking_display": stream_thinking_display,
                    },
                )

            for tc_delta in delta.tool_call_deltas:
                if not isinstance(tc_delta, dict):
                    continue
                stream_key, llm_call_id, idx, anonymous_tool_call_counter = _resolve_stream_key(
                    tc_delta,
                    delta_state_by_key=delta_state_by_key,
                    state_key_by_index=state_key_by_index,
                    anonymous_counter=anonymous_tool_call_counter,
                )
                state = delta_state_by_key.get(stream_key)
                if state is None:
                    state = ToolDeltaState(
                        stream_key=stream_key,
                        llm_call_id=llm_call_id,
                        name="",
                        raw_arguments="",
                        index=idx,
                    )
                    delta_state_by_key[stream_key] = state
                    if idx is not None:
                        state_key_by_index[idx] = stream_key
                    await emit_fn(
                        user_id=run.user_id,
                        project_id=run.project_id,
                        thread_id=thread.id,
                        event_name="tool_call:start",
                        data={
                            "run_id": str(run.id),
                            "stream_key": stream_key,
                            "tool_call_id": llm_call_id,
                            "message_id": "",
                            "assistant_message_id": str(assistant_message.id),
                            "index": idx,
                            "name": "",
                        },
                    )

                state.stream_key = stream_key
                state.llm_call_id = llm_call_id
                if idx is not None:
                    state.index = idx
                    state_key_by_index[idx] = stream_key

                fn = tc_delta.get("function") if isinstance(tc_delta.get("function"), dict) else {}
                if isinstance(fn.get("name"), str):
                    state.name = fn["name"]
                if isinstance(fn.get("arguments"), str):
                    state.raw_arguments += fn["arguments"]
                    await emit_fn(
                        user_id=run.user_id,
                        project_id=run.project_id,
                        thread_id=thread.id,
                        event_name="tool_call:delta",
                        data={
                            "run_id": str(run.id),
                            "stream_key": stream_key,
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

    if raw_response is not None and final_snapshot.raw_native_response is None:
        final_snapshot.raw_native_response = raw_response

    if native_tool_call_mode:
        final_snapshot = extract_native_tool_calls_from_snapshot(final_snapshot)
    final_snapshot = normalize_final_snapshot_content(final_snapshot)

    if output_mode == "raw_output" and final_snapshot.tool_calls:
        raise RuntimeError("Raw output mode cannot include tool calls")

    reasoning_detail: dict[str, Any] | None = None
    if thinking_mode == "custom":
        reasoning_detail = _build_custom_reasoning_detail(final_snapshot.content_parts)
    elif thinking_mode == "model":
        reasoning_detail = normalize_reasoning_detail(provider_io.read_reasoning_detail(final_snapshot, advanced))

    if reasoning_detail is not None:
        reasoning_detail["token_count"] = await _fill_reasoning_token_count(
            db,
            run=run,
            task_config=task_config,
            final_snapshot=final_snapshot,
            provider_io=provider_io,
        )

    db.refresh(run)
    db.refresh(thread)
    assistant_message = db.query(RunMessageModel).filter(RunMessageModel.id == assistant_message.id).first()
    if assistant_message is None:
        raise RuntimeError("Assistant message row missing")

    content_only_parts = _content_only_parts(final_snapshot.content_parts)
    language_entry: dict[str, Any] = {"contentParts": content_only_parts}
    if reasoning_detail is not None:
        language_entry["reasoningDetail"] = reasoning_detail
    assistant_message_before = snapshot_run_message_row(assistant_message)
    assistant_message.data = {
        run.language: language_entry,
    }
    assistant_message_delta = build_run_message_delta(
        assistant_message_before,
        snapshot_run_message_row(assistant_message),
    )
    assistant_message_delta_applied = False

    persisted_tools: list[RunToolCallModel] = []
    if output_mode == "raw_output":
        run.status = "processing"
        thread.status = "processing"
        apply_project_usage_delta(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            delta=assistant_message_delta,
            enforce_quota=True,
        )
        assistant_message_delta_applied = True
        db.commit()
        await emit_fn(
            user_id=run.user_id,
            project_id=run.project_id,
            thread_id=thread.id,
            event_name="run:status",
            data={
                "run_id": str(run.id),
                "status": "processing",
            },
        )
        await sync_status_fn(
            db=db,
            run=run,
            thread=thread,
            error=None,
            emit_run_status=False,
        )
        await _raw.apply_raw_output(
            db,
            thread=thread,
            run=run,
            input_payload=input_payload if isinstance(input_payload, dict) else {},
            content_parts=content_only_parts,
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

    if not assistant_message_delta_applied:
        apply_project_usage_delta(
            db,
            user_id=run.user_id,
            project_id=run.project_id,
            delta=assistant_message_delta,
            enforce_quota=True,
        )
    db.commit()

    tool_call_summaries: list[dict[str, Any]] = [
        {
            "tool_call_id": str(row.id),
            "message_id": str(row.message_id),
            "assistant_message_id": str(row.assistant_message_id),
            "index": idx,
            "name": row.tool_name,
            "arguments": row.arguments,
            "extra_content": row.extra_content if isinstance(row.extra_content, dict) else None,
            "status": row.status,
            "reason": row.reason,
            "seq_in_thread": int(row.message.seq_in_thread) if row.message else 0,
        }
        for idx, row in enumerate(persisted_tools)
    ]

    await emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="llm:response",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "provider": task_config.provider,
            "model": task_config.model,
            "raw_response": final_snapshot.raw_native_response,
        },
    )

    await emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="message:end",
        data={
            "run_id": str(run.id),
            "message_id": str(assistant_message.id),
            "seq_in_thread": int(assistant_message.seq_in_thread),
            "data": assistant_message.data,
            "tool_calls": tool_call_summaries,
        },
    )
    await emit_fn(
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        event_name="run:status",
        data={
            "run_id": str(run.id),
            "status": run.status,
            "error": run.error,
        },
    )
    await sync_status_fn(
        db=db,
        run=run,
        thread=thread,
        error=run.error,
        emit_run_status=False,
    )
    await emit_fn(
        user_id=run.user_id,
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
