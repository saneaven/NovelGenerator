from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, Thread
from ..mcp import McpMessageAssembler
from ..memory import retrieval as memory_retrieval
from ..memory import state as memory_state
from ..prompt_runtime.contracts import ScenarioBundle
from ..prompt_runtime.project_data_builder import build_project_data
from ..prompt_runtime.scenario_manager import ScenarioManager
from ..prompt_runtime.scenario_runtime import (
    assemble_scenario_snapshot,
    extend_prompt_snapshot_with_resume_tail,
    flatten_prompt_snapshot,
)
from ..prompt_runtime.template_renderer import TemplateRenderer, load_user_fragment_map
from ..settings_service import settings_service
from ..storage_usage_service import apply_project_usage_delta, build_thread_delta, snapshot_thread_row
from .contracts import CreateContext
from .text_utils import extract_last_texts

EmitFn = Callable[..., Awaitable[None]]


def _load_captured_prompt_snapshot(db: Session, thread: Thread) -> None:
    """Explicitly load the deferred prompt snapshot for single-thread prompt work."""
    state = sa_inspect(thread, raiseerr=False)
    if state is not None and "captured_prompt_snapshot" in state.unloaded:
        db.refresh(thread, attribute_names=["captured_prompt_snapshot"])


async def _emit_stage(
    emit_fn: EmitFn | None,
    *,
    run: RunModel,
    thread: Thread,
    stage: str,
) -> None:
    from .llm_execution.stage_events import emit_stage

    await emit_stage(
        emit_fn,
        run=run,
        thread=thread,
        stage=stage,
    )


@dataclass(frozen=True)
class _BundleInputs:
    task_type: str
    task_subtype: str
    template_data: dict[str, Any]
    system_template: str
    blocks: list[dict[str, Any]]
    project_data: dict[str, Any]
    template_renderer_factory: Callable[[], TemplateRenderer]


def _make_template_renderer_factory(fragment_map: dict[str, str]) -> Callable[[], TemplateRenderer]:
    snapshot = dict(fragment_map)
    return lambda: TemplateRenderer(fragment_map=dict(snapshot))


def _patch_mcp_contexts(template_data: dict[str, Any], run: RunModel) -> dict[str, Any]:
    patched = dict(template_data)
    if isinstance(run.mcp_resolution_json, dict):
        patched["mcpContexts"] = list(run.mcp_resolution_json.get("template_contexts") or [])
    else:
        patched.pop("mcpContexts", None)
    return patched


def _load_source_messages(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    archived_until_seq: int | None,
) -> list[dict[str, Any]]:
    messages = McpMessageAssembler.build_thread_messages(
        db,
        thread_id=thread.id,
        language=run.language,
        archived_until_seq_in_thread=archived_until_seq,
    )
    return McpMessageAssembler.merge_run_mcp_content(
        messages,
        run_id=run.id,
        resolution=run.mcp_resolution_json if isinstance(run.mcp_resolution_json, dict) else None,
    )


async def _load_bundle_inputs(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    input_text: str,
    input_payload: dict[str, Any],
) -> _BundleInputs:
    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise RuntimeError("No active preset selected")

    scenario_manager = ScenarioManager()
    target = scenario_manager.resolve_target(db, thread=thread, run=run, payload=input_payload)
    project_data = await build_project_data(db, run.project_id, run.language)
    template_data = scenario_manager.build_template_data(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        task_type=target.task_type,
        thread=thread,
        run=run,
        project_data=project_data,
        input_text=input_text,
        input_payload=input_payload,
    )
    scenario = scenario_manager.load_active_scenario(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        task_type=target.task_type,
        task_subtype=target.task_subtype,
    )

    return _BundleInputs(
        task_type=target.task_type,
        task_subtype=target.task_subtype,
        template_data=template_data,
        system_template=str(scenario.get("system_template") or ""),
        blocks=scenario.get("blocks") if isinstance(scenario.get("blocks"), list) else [],
        project_data=project_data,
        template_renderer_factory=_make_template_renderer_factory(load_user_fragment_map(db, run.user_id, preset_id)),
    )


def _build_scenario_bundle(
    *,
    run: RunModel,
    bundle_inputs: _BundleInputs,
    template_data: dict[str, Any] | None = None,
) -> ScenarioBundle:
    effective_template_data = bundle_inputs.template_data if template_data is None else template_data
    return ScenarioBundle(
        task_type=bundle_inputs.task_type,
        task_subtype=bundle_inputs.task_subtype,
        template_data=_patch_mcp_contexts(effective_template_data, run),
        blocks=bundle_inputs.blocks,
        system_template=bundle_inputs.system_template,
        project_data=bundle_inputs.project_data,
        template_renderer_factory=bundle_inputs.template_renderer_factory,
    )


async def _render(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    template_data: dict[str, Any],
    bundle_inputs: _BundleInputs,
    archived_until_seq: int | None,
    emit_fn: EmitFn | None = None,
) -> tuple[str, list[dict[str, Any]], ScenarioBundle, list[dict[str, Any]]]:
    bundle = _build_scenario_bundle(
        run=run,
        bundle_inputs=bundle_inputs,
        template_data=template_data,
    )
    template_renderer = bundle.template_renderer_factory()
    messages = _load_source_messages(
        db,
        run=run,
        thread=thread,
        archived_until_seq=archived_until_seq,
    )
    await _emit_stage(
        emit_fn,
        run=run,
        thread=thread,
        stage="rendering_prompt",
    )
    prompt_snapshot = assemble_scenario_snapshot(
        template_renderer=template_renderer,
        task_type=bundle.task_type,
        system_template=bundle.system_template,
        blocks=bundle.blocks,
        source_conversation=messages,
        template_data=bundle.template_data,
        current_run_id=str(run.id),
    )
    system_prompt, conversation, cache_boundaries = flatten_prompt_snapshot(prompt_snapshot)
    system_prompt = McpMessageAssembler.merge_system_overlays(
        system_prompt,
        run.mcp_resolution_json.get("system_overlays") if isinstance(run.mcp_resolution_json, dict) else None,
    )
    prompt_snapshot = dict(prompt_snapshot)
    prompt_snapshot["systemPrompt"] = system_prompt
    prompt_snapshot["scenario"] = {
        "taskType": bundle.task_type,
        "taskSubtype": bundle.task_subtype,
    }
    system_prompt, conversation, cache_boundaries = flatten_prompt_snapshot(prompt_snapshot)

    _load_captured_prompt_snapshot(db, thread)
    before = snapshot_thread_row(thread)
    thread.captured_prompt_snapshot = prompt_snapshot
    apply_project_usage_delta(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        delta=build_thread_delta(before, snapshot_thread_row(thread)),
        enforce_quota=True,
    )
    db.commit()

    return system_prompt, conversation, bundle, cache_boundaries


async def assemble_create(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    create_ctx: CreateContext,
    emit_fn: EmitFn | None = None,
) -> tuple[str, list[dict[str, Any]], ScenarioBundle, list[dict[str, Any]]]:
    bundle_inputs = await _load_bundle_inputs(
        db,
        run=run,
        thread=thread,
        input_text=create_ctx.input_text,
        input_payload=create_ctx.input_payload,
    )
    archived_until_seq = memory_state.latest_archived_seq(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
    )
    source_messages = _load_source_messages(
        db,
        run=run,
        thread=thread,
        archived_until_seq=archived_until_seq,
    )
    last_user_text, last_assistant_text = extract_last_texts(source_messages)
    template_data = dict(bundle_inputs.template_data)
    await _emit_stage(
        emit_fn,
        run=run,
        thread=thread,
        stage="retrieving_memory",
    )
    template_data["memory"] = await memory_retrieval.build_memory_data(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        language=run.language,
        last_user_text=last_user_text,
        last_assistant_text=last_assistant_text,
    )

    return await _render(
        db,
        run=run,
        thread=thread,
        template_data=template_data,
        bundle_inputs=bundle_inputs,
        archived_until_seq=archived_until_seq,
        emit_fn=emit_fn,
    )


async def reassemble_create(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    scenario_bundle: ScenarioBundle,
    emit_fn: EmitFn | None = None,
) -> tuple[str, list[dict[str, Any]], ScenarioBundle, list[dict[str, Any]]]:
    archived_until_seq = memory_state.latest_archived_seq(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
    )
    source_messages = _load_source_messages(
        db,
        run=run,
        thread=thread,
        archived_until_seq=archived_until_seq,
    )
    last_user_text, last_assistant_text = extract_last_texts(source_messages)

    template_data = dict(scenario_bundle.template_data)
    await _emit_stage(
        emit_fn,
        run=run,
        thread=thread,
        stage="retrieving_memory",
    )
    template_data["memory"] = await memory_retrieval.build_memory_data(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
        language=run.language,
        last_user_text=last_user_text,
        last_assistant_text=last_assistant_text,
    )

    return await _render(
        db,
        run=run,
        thread=thread,
        template_data=template_data,
        bundle_inputs=_BundleInputs(
            task_type=scenario_bundle.task_type,
            task_subtype=scenario_bundle.task_subtype,
            template_data=scenario_bundle.template_data,
            system_template=scenario_bundle.system_template,
            blocks=scenario_bundle.blocks,
            project_data=scenario_bundle.project_data,
            template_renderer_factory=scenario_bundle.template_renderer_factory,
        ),
        archived_until_seq=archived_until_seq,
        emit_fn=emit_fn,
    )


async def assemble_resume(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    input_payload: dict[str, Any],
    emit_fn: EmitFn | None = None,
) -> tuple[str, list[dict[str, Any]], ScenarioBundle, list[dict[str, Any]]]:
    _load_captured_prompt_snapshot(db, thread)
    captured_prompt_snapshot = thread.captured_prompt_snapshot
    if not isinstance(captured_prompt_snapshot, dict):
        return await assemble_create(
            db,
            run=run,
            thread=thread,
            create_ctx=CreateContext(input_text="", input_payload=input_payload),
            emit_fn=emit_fn,
        )

    last_msg_role = (
        db.query(RunMessageModel.role)
        .filter(RunMessageModel.run_id == run.id)
        .order_by(RunMessageModel.seq.desc())
        .limit(1)
        .scalar()
    )
    if last_msg_role == "user":
        return await assemble_create(
            db,
            run=run,
            thread=thread,
            create_ctx=CreateContext(input_text="", input_payload=input_payload),
            emit_fn=emit_fn,
        )

    bundle_inputs = await _load_bundle_inputs(
        db,
        run=run,
        thread=thread,
        input_text="",
        input_payload=input_payload,
    )
    bundle = _build_scenario_bundle(
        run=run,
        bundle_inputs=bundle_inputs,
    )
    prompt_snapshot = dict(captured_prompt_snapshot)
    archived_until_seq = memory_state.latest_archived_seq(
        db,
        user_id=run.user_id,
        project_id=run.project_id,
        thread_id=thread.id,
    )
    recent = McpMessageAssembler.build_thread_messages(
        db,
        thread_id=thread.id,
        language=run.language,
        include_run_ids=[run.id],
        archived_until_seq_in_thread=archived_until_seq,
    )
    prompt_snapshot = extend_prompt_snapshot_with_resume_tail(
        prompt_snapshot,
        tail_messages=recent,
    )
    system_prompt, conversation, cache_boundaries = flatten_prompt_snapshot(prompt_snapshot)

    return system_prompt, conversation, bundle, cache_boundaries
