from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import PromptFragment, PromptVariable, PromptVersion
from ...services.settings_service import settings_service
from ...services.template_engine import create_environment, render_template
from .project_data_builder import build_project_data


class PromptResolutionError(RuntimeError):
    def __init__(self, *, code: str, task_type: str, category: str, prompt_name: str) -> None:
        self.code = code
        self.task_type = task_type
        self.category = category
        self.prompt_name = prompt_name
        super().__init__(f"{code}::{task_type}::{category}::{prompt_name}")


@dataclass(frozen=True)
class PromptTarget:
    task_type: str
    prompt_name: str
    message_input_key: str
    required_categories: tuple[str, ...]


@dataclass
class PromptBundle:
    system_prompt: str
    memory_prompt: str
    user_prompt: str
    single_user_prompt: str
    initial_user_prompt: str | None
    first_user_prompt: str | None
    last_user_prompt: str | None
    prefill: str | None
    message_input_key: str
    template_data: dict[str, Any]
    fragment_map: dict[str, str]


class PromptManager:
    @staticmethod
    def _normalize_fragment_key(folder_path: str | None, fragment_name: str) -> str:
        if folder_path:
            return f"{folder_path.strip('/')}/{fragment_name.strip('/')}".strip("/")
        return fragment_name.strip("/")

    def _resolve_target(self, llm_mode: str, prompt_context: dict[str, Any]) -> PromptTarget:
        if llm_mode == "agent:planMode":
            return PromptTarget(
                task_type="agent",
                prompt_name="planMode",
                message_input_key="agentMessage",
                required_categories=("systemPrompt", "memoryPrompt", "userPrompt", "firstUserPrompt", "lastUserPrompt"),
            )

        if llm_mode == "agent:agentMode":
            return PromptTarget(
                task_type="agent",
                prompt_name="agentMode",
                message_input_key="agentMessage",
                required_categories=("systemPrompt", "memoryPrompt", "userPrompt", "firstUserPrompt", "lastUserPrompt"),
            )

        if llm_mode.startswith("subAgent:"):
            return PromptTarget(
                task_type="subAgent",
                prompt_name=llm_mode.split(":", 1)[1],
                message_input_key="agentMessage",
                required_categories=("systemPrompt", "userPrompt"),
            )

        if llm_mode == "journey:translation":
            return PromptTarget(
                task_type="translation",
                prompt_name="object",
                message_input_key="userMessage",
                required_categories=("systemPrompt", "userPrompt", "initialUserPrompt", "firstUserPrompt", "lastUserPrompt"),
            )

        if llm_mode.startswith("journey:aiEdit:"):
            mode = llm_mode.rsplit(":", 1)[1]
            prompt_name = "manuscript" if mode == "manuscript" else "storyObject"
            return PromptTarget(
                task_type="editAssistant",
                prompt_name=prompt_name,
                message_input_key="userMessage",
                required_categories=("systemPrompt", "userPrompt", "initialUserPrompt", "firstUserPrompt", "lastUserPrompt"),
            )

        if llm_mode == "journey:imagePrompt":
            payload = prompt_context.get("run", {}).get("input_payload") if isinstance(prompt_context.get("run"), dict) else {}
            variant = payload.get("variant") if isinstance(payload, dict) else None
            if variant == "coverImage":
                prompt_name = "coverImage"
            elif variant == "scene":
                prompt_name = "scene"
            else:
                prompt_name = "object"

            return PromptTarget(
                task_type="imagePrompt",
                prompt_name=prompt_name,
                message_input_key="userMessage",
                required_categories=("systemPrompt", "userPrompt", "initialUserPrompt", "firstUserPrompt", "lastUserPrompt"),
            )

        raise ValueError(f"Unknown llm mode: {llm_mode}")

    @staticmethod
    def _load_latest_prompt_map(
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
        task_type: str,
        prompt_name: str,
    ) -> dict[str, str]:
        rows = (
            db.query(PromptVersion)
            .filter(
                PromptVersion.user_id == user_id,
                PromptVersion.preset_id == preset_id,
                PromptVersion.task_type == task_type,
                PromptVersion.prompt_name == prompt_name,
            )
            .order_by(
                PromptVersion.prompt_category.asc(),
                PromptVersion.version_number.desc(),
                PromptVersion.created_at.desc(),
                PromptVersion.id.desc(),
            )
            .all()
        )

        out: dict[str, str] = {}
        for row in rows:
            if row.prompt_category in out:
                continue
            out[row.prompt_category] = row.content
        return out

    @staticmethod
    def _require_prompt(
        prompt_map: dict[str, str],
        *,
        task_type: str,
        category: str,
        prompt_name: str,
    ) -> str:
        content = prompt_map.get(category)
        if content is None:
            raise PromptResolutionError(
                code="PROMPT_NOT_FOUND",
                task_type=task_type,
                category=category,
                prompt_name=prompt_name,
            )
        return content

    def _load_fragment_map(self, db: Session, *, user_id: UUID, preset_id: UUID) -> dict[str, str]:
        rows = (
            db.query(PromptFragment)
            .filter(
                PromptFragment.user_id == user_id,
                PromptFragment.preset_id == preset_id,
            )
            .order_by(
                PromptFragment.folder_path.asc().nullsfirst(),
                PromptFragment.fragment_name.asc(),
                PromptFragment.version_number.desc(),
                PromptFragment.updated_at.desc(),
                PromptFragment.id.desc(),
            )
            .all()
        )

        out: dict[str, str] = {}
        for row in rows:
            key = self._normalize_fragment_key(row.folder_path, row.fragment_name)
            if key in out:
                continue
            out[key] = row.content
        return out

    @staticmethod
    def _load_variables(db: Session, *, user_id: UUID, preset_id: UUID) -> dict[str, Any]:
        rows = (
            db.query(PromptVariable)
            .filter(
                PromptVariable.user_id == user_id,
                PromptVariable.preset_id == preset_id,
            )
            .order_by(PromptVariable.display_order.asc(), PromptVariable.name.asc())
            .all()
        )

        variables: dict[str, Any] = {}
        for row in rows:
            value_blob = row.value if isinstance(row.value, dict) else {}
            variables[row.name] = value_blob.get("value")
        return variables

    async def generate_prompt_bundle(
        self,
        db: Session,
        cfg: Any,
        prompt_context: dict[str, Any],
        user_id: UUID,
        preset_id: UUID | None,
    ) -> PromptBundle:
        target = self._resolve_target(cfg.llm_mode, prompt_context)
        if preset_id is None:
            raise PromptResolutionError(
                code="PROMPT_NOT_FOUND",
                task_type=target.task_type,
                category=target.required_categories[0],
                prompt_name=target.prompt_name,
            )

        prompt_map = self._load_latest_prompt_map(
            db,
            user_id=user_id,
            preset_id=preset_id,
            task_type=target.task_type,
            prompt_name=target.prompt_name,
        )

        task_config = settings_service.get_task_config(db, user_id, cfg.task_type)
        prefill_enabled = bool(task_config.advanced.get("enable_prefill", False))
        required_categories = list(target.required_categories)
        if prefill_enabled:
            required_categories.append("prefill")

        for category in required_categories:
            self._require_prompt(
                prompt_map,
                task_type=target.task_type,
                category=category,
                prompt_name=target.prompt_name,
            )

        system_template = self._require_prompt(
            prompt_map,
            task_type=target.task_type,
            category="systemPrompt",
            prompt_name=target.prompt_name,
        )
        memory_template = (
            self._require_prompt(
                prompt_map,
                task_type=target.task_type,
                category="memoryPrompt",
                prompt_name=target.prompt_name,
            )
            if "memoryPrompt" in target.required_categories
            else None
        )
        user_template = self._require_prompt(
            prompt_map,
            task_type=target.task_type,
            category="userPrompt",
            prompt_name=target.prompt_name,
        )
        initial_template = prompt_map.get("initialUserPrompt")
        first_template = prompt_map.get("firstUserPrompt")
        last_template = prompt_map.get("lastUserPrompt")
        prefill_template = (
            self._require_prompt(
                prompt_map,
                task_type=target.task_type,
                category="prefill",
                prompt_name=target.prompt_name,
            )
            if prefill_enabled
            else None
        )

        if "initialUserPrompt" in target.required_categories:
            single_user_template = self._require_prompt(
                prompt_map,
                task_type=target.task_type,
                category="initialUserPrompt",
                prompt_name=target.prompt_name,
            )
        elif "lastUserPrompt" in target.required_categories:
            single_user_template = self._require_prompt(
                prompt_map,
                task_type=target.task_type,
                category="lastUserPrompt",
                prompt_name=target.prompt_name,
            )
        elif "firstUserPrompt" in target.required_categories:
            single_user_template = self._require_prompt(
                prompt_map,
                task_type=target.task_type,
                category="firstUserPrompt",
                prompt_name=target.prompt_name,
            )
        else:
            single_user_template = user_template

        project_data = prompt_context.get("project_data")
        if not isinstance(project_data, dict):
            project_data = await build_project_data(
                db,
                prompt_context["run"]["project_id"],  # type: ignore[index]
                prompt_context["run"]["language"],  # type: ignore[index]
                cfg.sidecar_client,
            )

        template_data = {
            "config": {
                "mainLanguage": prompt_context.get("run", {}).get("language"),
                "displayLanguage": prompt_context.get("run", {}).get("language"),
                "today": datetime.now(timezone.utc).date().isoformat(),
                "thinking_mode": cfg.thinking_mode,
                "isPrefillEnabled": prefill_enabled,
                "outputMode": "tool_call",
            },
            "project": project_data,
            "input": {
                "agentMessage": prompt_context.get("run", {}).get("input_text", ""),
                "userMessage": prompt_context.get("run", {}).get("input_text", ""),
            },
            "agent": {
                "runMode": prompt_context.get("run", {}).get("run_mode"),
                "surface": prompt_context.get("run", {}).get("surface"),
                "contextObjectIds": prompt_context.get("run", {}).get("context_object_ids") or [],
                "previousSummaries": prompt_context.get("memory", {}).get("previous_summaries") or [],
                "relevantChats": prompt_context.get("memory", {}).get("relevant_chats") or [],
            },
            "subAgent": {
                "agentName": cfg.llm_mode.split(":", 1)[1] if cfg.llm_mode.startswith("subAgent:") else None,
            },
            "journey": {
                "kind": prompt_context.get("run", {}).get("journey_kind"),
                "payload": prompt_context.get("run", {}).get("input_payload") or {},
                "targetIds": prompt_context.get("run", {}).get("journey_target_ids") or [],
            },
            "editAssistant": {
                "mode": (prompt_context.get("run", {}).get("input_payload") or {}).get("mode", ""),
                "manuscript": ((prompt_context.get("run", {}).get("input_payload") or {}).get("editAssistant") or {}).get(
                    "manuscript",
                    {"currentId": "", "currentChapterId": "", "currentChapterName": "", "currentChapterManuscript": "", "objectIds": []},
                ),
                "storyObject": ((prompt_context.get("run", {}).get("input_payload") or {}).get("editAssistant") or {}).get(
                    "storyObject",
                    {"targetIds": [], "contextIds": [], "categoryName": "", "editScope": "partial"},
                ),
            },
            "translation": (prompt_context.get("run", {}).get("input_payload") or {}).get(
                "translation",
                {
                    "sourceLanguage": "",
                    "targetLanguage": "",
                    "objectIds": [],
                    "currentTranslatedContents": [],
                    "messages": [],
                },
            ),
            "imagePrompt": (prompt_context.get("run", {}).get("input_payload") or {}).get(
                "imagePrompt",
                {
                    "promptMode": "natural",
                    "currentObject": {},
                    "selectedObjectIds": [],
                },
            ),
            "feedback": (prompt_context.get("run", {}).get("input_payload") or {}).get(
                "feedback",
                {"editingObjectIds": []},
            ),
            "variables": self._load_variables(db, user_id=user_id, preset_id=preset_id),
        }

        fragment_map = self._load_fragment_map(db, user_id=user_id, preset_id=preset_id)
        env = create_environment(fragment_map=fragment_map)

        system_prompt = render_template(env, system_template, template_data)
        agent_data = template_data.get("agent") if isinstance(template_data.get("agent"), dict) else {}
        previous_summaries = agent_data.get("previousSummaries") if isinstance(agent_data, dict) else []
        relevant_chats = agent_data.get("relevantChats") if isinstance(agent_data, dict) else []
        has_memory_context = (
            isinstance(previous_summaries, list)
            and len(previous_summaries) > 0
        ) or (
            isinstance(relevant_chats, list)
            and len(relevant_chats) > 0
        )
        memory_prompt = (
            render_template(env, memory_template, template_data)
            if memory_template and has_memory_context
            else ""
        )
        prefill = render_template(env, prefill_template, template_data) if prefill_template is not None else None

        return PromptBundle(
            system_prompt=system_prompt,
            memory_prompt=memory_prompt,
            user_prompt=user_template,
            single_user_prompt=single_user_template,
            initial_user_prompt=initial_template,
            first_user_prompt=first_template,
            last_user_prompt=last_template,
            prefill=prefill,
            message_input_key=target.message_input_key,
            template_data=template_data,
            fragment_map=fragment_map,
        )


prompt_manager = PromptManager()
