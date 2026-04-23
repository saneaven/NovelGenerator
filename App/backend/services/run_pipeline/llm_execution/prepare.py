from __future__ import annotations

from typing import Any

from ....providers.registry import create_llm_provider
from ....providers.shared.transport.stream_retry import normalize_retry_config
from ...context_manager import fit_to_context_window
from ...llm_runtime_service import get_llm_runtime
from ...mcp import mcp_sync_service
from ...memory_builder import build_memory_prompt
from ...prompt_runtime.output_mode import resolve_output_mode
from ...prompt_runtime.scenario_manager import ScenarioManager
from ...prompt_runtime.template_renderer import TemplateRenderer, load_user_fragment_map
from ...reasoning.history_filter import filter_history_by_run
from ...reasoning.mode_policy import apply_thinking_mode
from ...settings_service import settings_service
from ...thread_parent_runtime_service import resolve_parent
from ...token_count_service import count_conversation_tokens
from ...tool_engine import tool_engine
from .. import memory_preflight as _mem
from ..text_utils import extract_last_texts
from .contracts import LLMExecutionRequest, PreparedLLMExecution


def _strip_internal_message_keys(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        item = dict(message)
        item.pop("run_id", None)
        item.pop("seq_in_thread", None)
        item.pop("is_memory_prompt", None)
        out.append(item)
    return out


async def prepare_execution(request: LLMExecutionRequest) -> PreparedLLMExecution:
    db = request.db
    run = request.run
    thread = request.thread
    settings = request.settings
    scenario_bundle = request.scenario_bundle
    input_payload = request.input_payload if isinstance(request.input_payload, dict) else {}
    conversation = request.conversation

    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise RuntimeError("No active preset selected")

    template_renderer: TemplateRenderer | None = None
    if scenario_bundle is not None and isinstance(scenario_bundle.memory_template, str) and scenario_bundle.memory_template.strip():
        fragment_map = load_user_fragment_map(db, run.user_id, preset_id)
        template_renderer = TemplateRenderer(fragment_map=fragment_map)

    task_type = scenario_bundle.task_type if scenario_bundle else ScenarioManager.resolve_task_type(db, thread=thread, run=run)
    runtime = get_llm_runtime(db, user_id=run.user_id, task_type=task_type)
    task_config = runtime.task_config
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

    parent = resolve_parent(db, thread)
    output_mode = resolve_output_mode(
        journey_kind=parent.journey_kind,
        payload=input_payload,
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
        input_payload=input_payload,
        vector_storage_enabled=settings_service.is_vector_storage_enabled(db, run.user_id),
    )

    provider = create_llm_provider(
        task_config.provider,
        runtime.provider_config,
        task_config=task_config.__dict__,
    )
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
    messages = [{"role": "system", "content_parts": [{"type": "content", "text": request.system_prompt}]}] + conversation
    messages = filter_history_by_run(
        messages,
        current_run_id=str(run.id),
        tool_limit=tool_history_limit,
        thinking_limit=thinking_history_limit,
    )
    messages = apply_thinking_mode(messages, thinking_mode)

    fit_system_prompt = request.system_prompt
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

    fit_conversation, _memory_prompt = await fit_to_context_window(
        fit_system_prompt,
        fit_conversation,
        int(task_config.context_window_tokens or 32000),
        rebuild_memory_cb=_rebuild_memory,
        count_tokens_cb=_conversation_token_counter,
    )

    messages = [{"role": "system", "content_parts": [{"type": "content", "text": fit_system_prompt}]}] + fit_conversation

    if (
        task_config.provider == "custom"
        and thinking_mode == "model"
        and advanced.get("custom_kind") != "openai_response"
    ):
        from ...reasoning.custom_template_runtime import compile_template

        template_id = advanced.get("custom_thinking_template_id")
        if template_id:
            templates = getattr(settings, "custom_thinking_templates", []) or []
            tpl_match = next((t for t in templates if isinstance(t, dict) and t.get("id") == template_id), None)
            if tpl_match:
                thinking_template = compile_template(tpl_match)
                if thinking_template:
                    provider.set_thinking_template(thinking_template)
                    advanced["_resolved_template"] = thinking_template

    provider_messages = _strip_internal_message_keys(messages)

    if advanced.get("_resolved_template"):
        effective_thinking_config = None
    else:
        effective_thinking_config = advanced.get("thinking_config") if thinking_mode == "model" else None

    stream_thinking_display = provider.get_stream_thinking_display_path(advanced)
    if isinstance(stream_thinking_display, str):
        stream_thinking_display = stream_thinking_display.strip() or None
    else:
        stream_thinking_display = None

    retry_cfg = normalize_retry_config(settings_service.get_retry_config(db, run.user_id))

    return PreparedLLMExecution(
        preset_id=preset_id,
        runtime=runtime,
        task_config=task_config,
        provider=provider,
        tool_offer=tool_offer,
        output_mode=output_mode,
        native_tool_call_mode=native_tool_call_mode,
        advanced=advanced,
        thinking_mode=thinking_mode,
        effective_thinking_config=effective_thinking_config,
        provider_messages=provider_messages,
        stream_thinking_display=stream_thinking_display,
        retry_cfg=retry_cfg,
    )
