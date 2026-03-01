from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.db_models import RunModel, Thread, UserSettings
from ..prompt_runtime.conversation_builder import build_from_runs
from ..prompt_runtime.project_data_builder import build_project_data
from ..prompt_runtime.scenario_manager import ScenarioManager
from ..prompt_runtime.scenario_runtime import assemble_scenario
from ..prompt_runtime.template_renderer import TemplateRenderer, load_user_fragment_map
from ..prompt_runtime.contracts import ScenarioBundle
from ..settings_service import settings_service
from ..sidecar_client import sidecar_client
from .contracts import CreateContext


async def assemble_create(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    settings: UserSettings,
    create_ctx: CreateContext,
) -> tuple[str, list[dict[str, Any]], ScenarioBundle]:
    preset_id = settings_service.get_active_preset_id(db, run.user_id)
    if preset_id is None:
        raise RuntimeError("No active preset selected")

    scenario_manager = ScenarioManager()
    project_data = await build_project_data(db, run.project_id, run.language, sidecar_client)

    target = scenario_manager.resolve_target(db, thread=thread, run=run, payload=create_ctx.input_payload)
    template_data = scenario_manager.build_template_data(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        task_type=target.task_type,
        thread=thread,
        run=run,
        project_data=project_data,
        input_text=create_ctx.input_text,
        input_payload=create_ctx.input_payload,
    )

    scenario = scenario_manager.load_active_scenario(
        db,
        user_id=run.user_id,
        preset_id=preset_id,
        task_type=target.task_type,
        task_subtype=target.task_subtype,
    )
    system_template = str(scenario.get("system_template") or "")
    blocks = scenario.get("blocks") if isinstance(scenario.get("blocks"), list) else []

    fragment_map = load_user_fragment_map(db, run.user_id, preset_id)
    template_renderer = TemplateRenderer(fragment_map=fragment_map)

    canonical = build_from_runs(db, thread_id=thread.id, language=run.language)
    system_prompt, conversation, memory_template = assemble_scenario(
        template_renderer=template_renderer,
        task_type=target.task_type,
        system_template=system_template,
        blocks=blocks,
        source_conversation=canonical,
        template_data=template_data,
    )

    thread.captured_history_system_prompt = system_prompt
    thread.captured_history_conversation_json = conversation
    db.flush()

    bundle = ScenarioBundle(
        task_type=target.task_type,
        task_subtype=target.task_subtype,
        template_data=template_data,
        system_prompt=system_prompt,
        memory_template=memory_template,
    )

    return system_prompt, conversation, bundle


async def assemble_resume(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    settings: UserSettings,
) -> tuple[str, list[dict[str, Any]], ScenarioBundle | None]:
    if thread.captured_history_conversation_json is None:
        # Cache invalidated (e.g. message deleted) — full rebuild through the
        # same rendering pipeline as create so conversation blocks are applied.
        return await assemble_create(
            db, run=run, thread=thread, settings=settings,
            create_ctx=CreateContext(input_text="", input_payload={}),
        )

    system_prompt = str(thread.captured_history_system_prompt or "")
    conversation = list(thread.captured_history_conversation_json)

    recent = build_from_runs(
        db,
        thread_id=thread.id,
        language=run.language,
        include_run_ids=[run.id],
    )
    # Cache already contains user messages; only append non-user turns.
    conversation.extend(m for m in recent if m.get("role") != "user")

    bundle: ScenarioBundle | None = None
    task_type = ScenarioManager.resolve_task_type(thread=thread, run=run)
    if task_type == "agent":
        preset_id = settings_service.get_active_preset_id(db, run.user_id)
        if preset_id is not None:
            scenario_manager = ScenarioManager()
            task_subtype = "planMode" if run.run_mode == "planMode" else "agentMode"
            scenario = scenario_manager.load_active_scenario(
                db,
                user_id=run.user_id,
                preset_id=preset_id,
                task_type=task_type,
                task_subtype=task_subtype,
            )
            blocks = scenario.get("blocks") if isinstance(scenario.get("blocks"), list) else []
            memory_template: str | None = None
            for blk in blocks:
                if not isinstance(blk, dict) or not bool(blk.get("enabled", True)):
                    continue
                if blk.get("type") != "staticPrompt":
                    continue
                sp = blk.get("staticPrompt")
                if not isinstance(sp, dict):
                    continue
                if str(sp.get("subtype") or "") != "memory":
                    continue
                tpl = sp.get("template")
                if isinstance(tpl, str) and tpl.strip():
                    memory_template = tpl
                    break

            if memory_template is not None:
                project_data = await build_project_data(db, run.project_id, run.language, sidecar_client)
                template_data = scenario_manager.build_template_data(
                    db,
                    user_id=run.user_id,
                    preset_id=preset_id,
                    task_type=task_type,
                    thread=thread,
                    run=run,
                    project_data=project_data,
                    input_text="",
                    input_payload={},
                )
                bundle = ScenarioBundle(
                    task_type=task_type,
                    task_subtype=task_subtype,
                    template_data=template_data,
                    system_prompt=system_prompt,
                    memory_template=memory_template,
                )

    return system_prompt, conversation, bundle
