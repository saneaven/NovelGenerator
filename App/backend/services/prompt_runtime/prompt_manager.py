from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, desc
from sqlalchemy.orm import Session

from ...models.db_models import PromptVersion, RunModel, SubAgentDefinitionModel, Thread
from ..settings_service import settings_service
from ..variable_service import variable_service
from .output_mode import resolve_output_mode
from .prompt_renderer import PromptRenderer


@dataclass(frozen=True)
class PromptTarget:
    task_type: str
    task_subtype: str
    required_categories: tuple[str, ...]
    supports_memory_prompt: bool = False


@dataclass(frozen=True)
class PromptBundle:
    target: PromptTarget
    prompt_map: dict[str, str]
    template_data: dict[str, Any]
    system_prompt: str
    prefill: str | None
    has_memory_prompt: bool


class PromptCategoryMissingError(RuntimeError):
    pass


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None and str(item).strip()]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _find_story_object(project_data: dict[str, Any], object_id: str | None) -> dict[str, Any]:
    if not object_id:
        return {}
    rows = project_data.get("objects")
    if not isinstance(rows, list):
        return {}
    sid = str(object_id)
    for row in rows:
        if isinstance(row, dict) and str(row.get("id")) == sid:
            return row
    return {}


def _find_manuscript_by_chapter(project_data: dict[str, Any], chapter_id: str | None) -> dict[str, Any]:
    if not chapter_id:
        return {}
    rows = project_data.get("manuscripts")
    if not isinstance(rows, list):
        return {}
    sid = str(chapter_id)
    for row in rows:
        if isinstance(row, dict) and str(row.get("chapterId")) == sid:
            return row
    return {}


class PromptManager:
    def __init__(self, renderer: PromptRenderer):
        self._renderer = renderer

    def resolve_target(self, db: Session, *, thread: Thread, run: RunModel, payload: dict[str, Any]) -> PromptTarget:
        if thread.thread_type == "journey":
            journey_kind = str(thread.journey_kind or "").strip()

            if journey_kind == "objectTranslation":
                return PromptTarget(
                    task_type="translation",
                    task_subtype="object",
                    required_categories=("systemPrompt", "userPrompt", "initialUserPrompt", "firstUserPrompt", "lastUserPrompt"),
                )

            if journey_kind == "messageTranslation":
                return PromptTarget(
                    task_type="translation",
                    task_subtype="message",
                    required_categories=("systemPrompt", "userPrompt"),
                )

            if journey_kind in {"imagePrompt", "sceneImagePrompt"}:
                context_type = str(payload.get("contextType") or "").strip()
                if context_type == "cover_image":
                    task_subtype = "coverImage"
                elif context_type == "scene":
                    task_subtype = "scene"
                else:
                    task_subtype = "object"

                return PromptTarget(
                    task_type="imagePrompt",
                    task_subtype=task_subtype,
                    required_categories=("systemPrompt", "userPrompt", "initialUserPrompt", "firstUserPrompt", "lastUserPrompt"),
                )

            if journey_kind == "objectEdit":
                mode = str(payload.get("category") or "").strip()
                task_subtype = "manuscript" if mode == "manuscript" else "storyObject"
                return PromptTarget(
                    task_type="editAssistant",
                    task_subtype=task_subtype,
                    required_categories=("systemPrompt", "userPrompt", "initialUserPrompt", "firstUserPrompt", "lastUserPrompt"),
                )

            raise RuntimeError(f"Unsupported journey kind: {journey_kind}")

        if thread.thread_type == "subAgent":
            task_subtype = "default"
            if thread.owner_id:
                defn = db.query(SubAgentDefinitionModel).filter(SubAgentDefinitionModel.id == thread.owner_id).first()
                if defn is not None and str(defn.agent_name or "").strip():
                    task_subtype = str(defn.agent_name).strip()
            return PromptTarget(
                task_type="subAgent",
                task_subtype=task_subtype,
                required_categories=("systemPrompt", "userPrompt"),
            )

        task_subtype = "planMode" if run.run_mode == "planMode" else "agentMode"
        return PromptTarget(
            task_type="agent",
            task_subtype=task_subtype,
            required_categories=("systemPrompt", "memoryPrompt", "userPrompt", "firstUserPrompt", "lastUserPrompt"),
            supports_memory_prompt=True,
        )

    @staticmethod
    def resolve_task_type(*, thread: Thread, run: RunModel) -> str:
        if thread.thread_type == "journey":
            kind = (thread.journey_kind or "").strip()
            if kind in {"objectTranslation", "messageTranslation"}:
                return "translation"
            if kind in {"imagePrompt", "sceneImagePrompt"}:
                return "imagePrompt"
            if kind == "objectEdit":
                return "editAssistant"
            raise RuntimeError(f"Unsupported journey kind: {kind}")
        if thread.thread_type == "subAgent":
            return "subAgent"
        return "agent"

    def _load_latest_prompt_map(
        self,
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
        task_type: str,
        task_subtype: str,
    ) -> dict[str, str]:
        rows = (
            db.query(PromptVersion)
            .filter(
                and_(
                    PromptVersion.user_id == user_id,
                    PromptVersion.preset_id == preset_id,
                    PromptVersion.task_type == task_type,
                    PromptVersion.task_subtype == task_subtype,
                )
            )
            .order_by(PromptVersion.prompt_category.asc(), desc(PromptVersion.version_number))
            .all()
        )

        out: dict[str, str] = {}
        for row in rows:
            category = str(row.prompt_category or "").strip()
            if not category or category in out:
                continue
            out[category] = row.content
        return out

    @staticmethod
    def _resolve_user_category(
        *,
        prompt_map: dict[str, str],
        run_index: int,
        total_runs: int,
    ) -> str:
        if total_runs == 1 and "initialUserPrompt" in prompt_map:
            return "initialUserPrompt"
        if run_index == total_runs - 1 and "lastUserPrompt" in prompt_map:
            return "lastUserPrompt"
        if run_index == 0 and "firstUserPrompt" in prompt_map:
            return "firstUserPrompt"
        return "userPrompt"

    def render_conversation_user_prompts(
        self,
        *,
        prompt_map: dict[str, str],
        target: PromptTarget,
        template_data: dict[str, Any],
        user_texts: list[str],
    ) -> list[str]:
        total = len(user_texts)
        rendered: list[str] = []
        for i, text in enumerate(user_texts):
            category = self._resolve_user_category(prompt_map=prompt_map, run_index=i, total_runs=total)
            patched = {**template_data, "input": {**template_data.get("input", {}), "userMessage": text}}
            rendered.append(
                self._renderer.render_prompt(
                    task_type=target.task_type,
                    task_subtype=target.task_subtype,
                    prompt_category=category,
                    template_data=patched,
                )
            )
        return rendered

    @staticmethod
    def _build_edit_assistant_data(
        *,
        payload: dict[str, Any],
        project_data: dict[str, Any],
        context_object_ids: list[str],
        journey_target_ids: list[str],
    ) -> dict[str, Any]:
        defaults = {
            "mode": "storyObject",
            "manuscript": {
                "currentId": "",
                "currentChapterId": "",
                "currentChapterName": "",
                "currentChapterManuscript": "",
                "objectIds": [],
            },
            "storyObject": {
                "targetIds": [],
                "contextIds": [],
                "categoryName": "",
                "editScope": "selected",
            },
        }

        category = str(payload.get("category") or "").strip()
        target_id = str(payload.get("targetId") or "").strip()
        selected_context_ids = _as_str_list(payload.get("selectedContextIds")) or context_object_ids

        if category == "manuscript":
            chapter_id = target_id or (journey_target_ids[0] if journey_target_ids else "")
            manuscript = _find_manuscript_by_chapter(project_data, chapter_id)
            return {
                "mode": "manuscript",
                "manuscript": {
                    "currentId": str(manuscript.get("id") or ""),
                    "currentChapterId": str(chapter_id or ""),
                    "currentChapterName": str(manuscript.get("chapterName") or ""),
                    "currentChapterManuscript": str(manuscript.get("content") or ""),
                    "objectIds": selected_context_ids,
                },
                "storyObject": defaults["storyObject"],
            }

        target_ids = [target_id] if target_id else list(journey_target_ids)
        return {
            "mode": "storyObject",
            "manuscript": defaults["manuscript"],
            "storyObject": {
                "targetIds": target_ids,
                "contextIds": selected_context_ids,
                "categoryName": category,
                "editScope": "selected",
            },
        }

    @staticmethod
    def _build_translation_data(
        *,
        payload: dict[str, Any],
        context_object_ids: list[str],
        journey_target_ids: list[str],
        language: str,
    ) -> dict[str, Any]:
        translation_payload = _as_dict(payload.get("translation"))
        return {
            "sourceLanguage": str(translation_payload.get("sourceLanguage") or ""),
            "targetLanguage": str(translation_payload.get("targetLanguage") or language),
            "sourceThreadId": str(translation_payload.get("sourceThreadId") or ""),
            "sourceMessageId": str(translation_payload.get("sourceMessageId") or ""),
            "objectIds": _as_str_list(translation_payload.get("objectIds")) or journey_target_ids,
            "contextObjectIds": _as_str_list(translation_payload.get("contextObjectIds")) or context_object_ids,
            "currentTranslatedContents": translation_payload.get("currentTranslatedContents")
            if isinstance(translation_payload.get("currentTranslatedContents"), list)
            else [],
            "messages": translation_payload.get("messages") if isinstance(translation_payload.get("messages"), list) else [],
        }

    @staticmethod
    def _build_image_prompt_data(
        *,
        payload: dict[str, Any],
        project_data: dict[str, Any],
        context_object_ids: list[str],
    ) -> dict[str, Any]:
        selected_object_ids = _as_str_list(payload.get("selectedObjectIds")) or context_object_ids
        object_id = str(payload.get("objectId") or "").strip()
        object_row = _find_story_object(project_data, object_id)
        basic_info = _as_dict(project_data.get("basicInfo"))
        scene_context = _as_dict(payload.get("sceneContext"))

        return {
            "promptMode": str(payload.get("promptMode") or "natural"),
            "currentObject": {
                "type": str(object_row.get("type") or payload.get("objectType") or ""),
                "name": str(object_row.get("name") or ""),
                "description": str(object_row.get("description") or ""),
                "content": str(object_row.get("content") or ""),
                "image_prompt": str(object_row.get("imagePrompt") or ""),
                "image_prompt_positive": str(object_row.get("imagePromptPositive") or ""),
                "image_prompt_negative": str(object_row.get("imagePromptNegative") or ""),
            },
            "scenePreContext": str(scene_context.get("preContext") or ""),
            "scenePostContext": str(scene_context.get("postContext") or ""),
            "selectedObjectIds": selected_object_ids,
            "coverImage": {
                "title": str(basic_info.get("title") or ""),
                "logline": str(basic_info.get("logline") or ""),
                "genre": str(basic_info.get("genre") or ""),
            },
        }

    @staticmethod
    def _build_feedback_data(
        *,
        payload: dict[str, Any],
        journey_target_ids: list[str],
    ) -> dict[str, Any]:
        feedback_payload = _as_dict(payload.get("feedback"))
        editing_ids = _as_str_list(feedback_payload.get("editingObjectIds"))
        if editing_ids:
            return {"editingObjectIds": editing_ids}

        fallback_ids = _as_str_list(payload.get("objectIds")) or journey_target_ids
        return {"editingObjectIds": fallback_ids}

    def _build_template_data(
        self,
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
        target: PromptTarget,
        thread: Thread,
        run: RunModel,
        project_data: dict[str, Any],
        input_text: str,
        input_payload: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        task_cfg = settings_service.get_task_config(db, user_id, target.task_type)
        prefill_enabled = bool(task_cfg.advanced.get("enable_prefill", False))

        payload = input_payload
        language = str(run.language or "English")
        context_object_ids = _as_str_list(run.context_object_ids)
        journey_target_ids = _as_str_list(run.journey_target_ids)
        native_output_mode = bool(getattr(settings_service._get_settings(db, user_id), "native_output_mode", False))
        output_mode = resolve_output_mode(
            journey_kind=thread.journey_kind,
            payload=payload,
            native_output_mode=native_output_mode,
        )

        variables = variable_service.get_variables_for_template(
            db,
            user_id=user_id,
            preset_id=preset_id,
        )

        template_data: dict[str, Any] = {
            "config": {
                "mainLanguage": language,
                "displayLanguage": language,
                "today": datetime.now(timezone.utc).date().isoformat(),
                "thinking_mode": str(task_cfg.advanced.get("thinking_mode") or "off"),
                "isPrefillEnabled": prefill_enabled,
                "outputMode": output_mode,
            },
            "project": project_data,
            "input": {
                "userMessage": input_text,
                "agentMessage": input_text,
                "toolResults": [],
            },
            "agent": {
                "runMode": str(run.run_mode or "agentMode"),
                "surface": str(run.surface or "story-object"),
                "contextObjectIds": context_object_ids,
            },
            "journey": {
                "kind": str(thread.journey_kind or ""),
                "payload": payload,
                "targetIds": journey_target_ids,
            },
            "editAssistant": self._build_edit_assistant_data(
                payload=payload,
                project_data=project_data,
                context_object_ids=context_object_ids,
                journey_target_ids=journey_target_ids,
            ),
            "translation": self._build_translation_data(
                payload=payload,
                context_object_ids=context_object_ids,
                journey_target_ids=journey_target_ids,
                language=language,
            ),
            "imagePrompt": self._build_image_prompt_data(
                payload=payload,
                project_data=project_data,
                context_object_ids=context_object_ids,
            ),
            "feedback": self._build_feedback_data(payload=payload, journey_target_ids=journey_target_ids),
            "memory": {
                "summaries": [],
                "historyChats": [],
            },
            "variables": variables if isinstance(variables, dict) else {},
        }

        return template_data, prefill_enabled

    @staticmethod
    def _validate_required_categories(
        *,
        prompt_map: dict[str, str],
        target: PromptTarget,
        prefill_enabled: bool,
    ) -> None:
        required = list(target.required_categories)
        if prefill_enabled:
            required.append("prefill")

        missing = [category for category in required if category not in prompt_map]
        if missing:
            joined = ", ".join(missing)
            raise PromptCategoryMissingError(
                f"Missing prompt categories for {target.task_type}/{target.task_subtype}: {joined}"
            )

    def build_prompt_bundle(
        self,
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
        thread: Thread,
        run: RunModel,
        project_data: dict[str, Any],
        input_text: str,
        input_payload: dict[str, Any],
    ) -> PromptBundle:
        target = self.resolve_target(db, thread=thread, run=run, payload=input_payload)
        prompt_map = self._load_latest_prompt_map(
            db,
            user_id=user_id,
            preset_id=preset_id,
            task_type=target.task_type,
            task_subtype=target.task_subtype,
        )

        template_data, prefill_enabled = self._build_template_data(
            db,
            user_id=user_id,
            preset_id=preset_id,
            target=target,
            thread=thread,
            run=run,
            project_data=project_data,
            input_text=input_text,
            input_payload=input_payload,
        )
        self._validate_required_categories(
            prompt_map=prompt_map,
            target=target,
            prefill_enabled=prefill_enabled,
        )

        system_prompt = self._renderer.render_prompt(
            task_type=target.task_type,
            task_subtype=target.task_subtype,
            prompt_category="systemPrompt",
            template_data=template_data,
        )
        prefill = (
            self._renderer.render_prefill(
                task_type=target.task_type,
                task_subtype=target.task_subtype,
                template_data=template_data,
            )
            if prefill_enabled
            else None
        )

        return PromptBundle(
            target=target,
            prompt_map=prompt_map,
            template_data=template_data,
            system_prompt=system_prompt,
            prefill=prefill,
            has_memory_prompt=target.supports_memory_prompt and "memoryPrompt" in prompt_map,
        )

    def render_memory_prompt(
        self,
        *,
        bundle: PromptBundle,
        memory: dict[str, Any],
    ) -> str | None:
        if not bundle.has_memory_prompt:
            return None

        template_data = {
            **bundle.template_data,
            "memory": memory if isinstance(memory, dict) else {"summaries": [], "historyChats": []},
        }
        rendered = self._renderer.render_memory_prompt(
            task_type=bundle.target.task_type,
            task_subtype=bundle.target.task_subtype,
            template_data=template_data,
        ).strip()
        return rendered or None
