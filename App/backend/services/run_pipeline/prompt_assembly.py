from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.db_models import RunMessageModel, RunModel, Thread, UserSettings
from ..prompt_runtime.conversation_builder import build_from_runs
from ..prompt_runtime.prompt_manager import PromptBundle, PromptManager, PromptTarget
from ..prompt_runtime.prompt_renderer import PromptRenderer
from ..prompt_runtime.project_data_builder import build_project_data
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
            include_run_ids=[r.id],
        )
        conversation.extend(m for m in non_user if m.get("role") != "user")

    thread.captured_history_system_prompt = prompt_bundle.system_prompt
    thread.captured_history_conversation_json = conversation
    thread.captured_history_prefill = prompt_bundle.prefill
    db.flush()

    return prompt_bundle.system_prompt, conversation, prompt_bundle.prefill, prompt_bundle


def assemble_resume(
    db: Session,
    *,
    run: RunModel,
    thread: Thread,
    settings: UserSettings,
) -> tuple[str, list[dict[str, Any]], str | None, PromptBundle | None]:
    system_prompt = str(thread.captured_history_system_prompt or "")
    prefill = thread.captured_history_prefill if isinstance(thread.captured_history_prefill, str) and thread.captured_history_prefill else None

    if thread.captured_history_conversation_json is not None:
        conversation = list(thread.captured_history_conversation_json)
    else:
        # Cache invalidated (e.g. message deleted) — rebuild from DB
        prior_run_ids = [
            r.id
            for r in db.query(RunModel.id)
            .filter(RunModel.thread_id == thread.id, RunModel.id != run.id)
            .order_by(RunModel.run_seq.asc())
            .all()
        ]
        conversation = build_from_runs(
            db, thread_id=thread.id, language=run.language,
            include_run_ids=prior_run_ids,
        ) if prior_run_ids else []

    recent = build_from_runs(
        db,
        thread_id=thread.id,
        language=run.language,
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
            task_subtype = "planMode" if run.run_mode == "planMode" else "agentMode"
            prompt_map = pm._load_latest_prompt_map(
                db, user_id=run.user_id, preset_id=preset_id,
                task_type=task_type, task_subtype=task_subtype,
            )
            if "memoryPrompt" in prompt_map:
                target = PromptTarget(
                    task_type=task_type,
                    task_subtype=task_subtype,
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
                        "memory": {"summaries": [], "historyChats": []},
                    },
                    system_prompt=system_prompt,
                    prefill=prefill,
                    has_memory_prompt=True,
                )

    return system_prompt, conversation, prefill, prompt_bundle
