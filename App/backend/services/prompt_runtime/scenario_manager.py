from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, desc
from sqlalchemy.orm import Session

from ...models.db_models import PromptScenarioVersion, RunModel, Thread
from ..settings_service import settings_service
from ..thread_parent_runtime_service import resolve_parent
from ..variable_service import variable_service
from .output_mode import resolve_output_mode


@dataclass(frozen=True)
class ScenarioTarget:
    task_type: str
    task_subtype: str


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None and str(item).strip()]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _find_basic_info(project_data: dict[str, Any], object_id: str | None) -> dict[str, Any]:
    if not object_id:
        return {}
    row = project_data.get("basicInfo")
    if not isinstance(row, dict):
        return {}
    if str(row.get("id") or "") == str(object_id):
        return row
    return {}


def _find_guidelines(project_data: dict[str, Any], object_id: str | None) -> dict[str, Any]:
    if not object_id:
        return {}
    row = project_data.get("guidelines")
    if not isinstance(row, dict):
        return {}
    if str(row.get("id") or "") == str(object_id):
        return row
    return {}


def _find_story_entity(project_data: dict[str, Any], object_id: str | None) -> dict[str, Any]:
    if not object_id:
        return {}
    rows = project_data.get("storyEntities")
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


def _find_manuscript_by_id(project_data: dict[str, Any], manuscript_id: str | None) -> dict[str, Any]:
    if not manuscript_id:
        return {}
    rows = project_data.get("manuscripts")
    if not isinstance(rows, list):
        return {}
    sid = str(manuscript_id)
    for row in rows:
        if isinstance(row, dict) and str(row.get("id")) == sid:
            return row
    return {}


def _find_outline_target(
    project_data: dict[str, Any],
    object_id: str | None,
) -> dict[str, Any] | None:
    if not object_id:
        return None

    outline_root = project_data.get("outline")
    if not isinstance(outline_root, dict):
        return None

    sid = str(object_id)
    for node in outline_root.get("nodes") or []:
        if isinstance(node, dict) and str(node.get("id") or "") == sid:
            return node
    return None


class ScenarioManager:
    def resolve_target(self, db: Session, *, thread: Thread, run: RunModel, payload: dict[str, Any]) -> ScenarioTarget:
        parent = resolve_parent(db, thread)
        if thread.thread_type == "journey":
            journey_kind = str(parent.journey_kind or "").strip()

            if journey_kind == "objectTranslation":
                return ScenarioTarget(task_type="translation", task_subtype="object")

            if journey_kind == "messageTranslation":
                return ScenarioTarget(task_type="translation", task_subtype="message")

            if journey_kind in {"imagePrompt", "sceneImagePrompt"}:
                context_type = str(payload.get("contextType") or "").strip()
                task_subtype = "scene" if context_type == "scene" else "object"
                return ScenarioTarget(task_type="imagePrompt", task_subtype=task_subtype)

            if journey_kind == "manuscriptEdit":
                return ScenarioTarget(task_type="editAssistant", task_subtype="manuscript")
            if journey_kind == "outlineEdit":
                return ScenarioTarget(task_type="editAssistant", task_subtype="outline")
            if journey_kind == "objectEdit":
                return ScenarioTarget(task_type="editAssistant", task_subtype="projectData")

            raise RuntimeError(f"Unsupported journey kind: {journey_kind}")

        if thread.thread_type == "subAgent":
            defn = parent.sub_agent_definition
            if defn is None or not str(defn.agent_name or "").strip():
                raise RuntimeError("SubAgent thread has no agent_name defined")
            return ScenarioTarget(task_type="subAgent", task_subtype=str(defn.agent_name).strip())

        task_subtype = "planMode" if run.run_mode == "planMode" else "agentMode"
        return ScenarioTarget(task_type="agent", task_subtype=task_subtype)

    @staticmethod
    def resolve_task_type(db: Session, *, thread: Thread, run: RunModel) -> str:
        if thread.thread_type == "journey":
            kind = str(resolve_parent(db, thread).journey_kind or "").strip()
            if kind in {"objectTranslation", "messageTranslation"}:
                return "translation"
            if kind in {"imagePrompt", "sceneImagePrompt"}:
                return "imagePrompt"
            if kind in {"manuscriptEdit", "outlineEdit", "objectEdit"}:
                return "editAssistant"
            raise RuntimeError(f"Unsupported journey kind: {kind}")
        if thread.thread_type == "subAgent":
            return "subAgent"
        return "agent"

    @staticmethod
    def load_active_scenario(
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
        task_type: str,
        task_subtype: str,
    ) -> dict[str, Any]:
        row = (
            db.query(PromptScenarioVersion)
            .filter(
                and_(
                    PromptScenarioVersion.user_id == user_id,
                    PromptScenarioVersion.preset_id == preset_id,
                    PromptScenarioVersion.task_type == task_type,
                    PromptScenarioVersion.task_subtype == task_subtype,
                )
            )
            .order_by(desc(PromptScenarioVersion.version_number))
            .first()
        )
        if row is None:
            raise RuntimeError(f"Scenario not found: {task_type}/{task_subtype}")
        return row.scenario if isinstance(row.scenario, dict) else {}

    @staticmethod
    def _build_edit_assistant_data(
        *,
        payload: dict[str, Any],
        project_data: dict[str, Any],
        context_object_ids: list[str],
        journey_target_ids: list[str],
    ) -> dict[str, Any]:
        defaults = {
            "projectData": {
                "contextIds": [],
                "editScope": "selected",
                "basicInfo": None,
                "guidelines": None,
                "storyEntity": None,
            },
            "manuscript": {
                "currentId": "",
                "currentChapterId": "",
                "currentChapterName": "",
                "currentChapterManuscript": "",
                "contextIds": [],
            },
            "outline": {
                "contextIds": [],
                "editScope": "selected",
                "items": [],
            },
        }

        category = str(payload.get("category") or "").strip()
        target_id = str(payload.get("targetId") or "").strip()
        selected_context_ids = _as_str_list(payload.get("selectedContextIds")) or context_object_ids

        if category == "manuscript":
            chapter_id = target_id or (journey_target_ids[0] if journey_target_ids else "")
            manuscript = _find_manuscript_by_chapter(project_data, chapter_id)
            return {
                "manuscript": {
                    "currentId": str(manuscript.get("id") or ""),
                    "currentChapterId": str(chapter_id or ""),
                    "currentChapterName": str(manuscript.get("chapterName") or ""),
                    "currentChapterManuscript": str(manuscript.get("content") or ""),
                    "contextIds": selected_context_ids,
                },
                "projectData": defaults["projectData"],
                "outline": defaults["outline"],
            }

        if category == "outline":
            outline_item = _find_outline_target(project_data, target_id or (journey_target_ids[0] if journey_target_ids else ""))
            return {
                "manuscript": defaults["manuscript"],
                "projectData": defaults["projectData"],
                "outline": {
                    "contextIds": selected_context_ids,
                    "editScope": "selected",
                    "items": [outline_item] if isinstance(outline_item, dict) else [],
                },
            }

        basic_info = _find_basic_info(project_data, target_id or (journey_target_ids[0] if journey_target_ids else ""))
        guidelines = _find_guidelines(project_data, target_id or (journey_target_ids[0] if journey_target_ids else ""))
        story_entity = _find_story_entity(project_data, target_id or (journey_target_ids[0] if journey_target_ids else ""))

        return {
            "manuscript": defaults["manuscript"],
            "projectData": {
                "contextIds": selected_context_ids,
                "editScope": "selected",
                "basicInfo": basic_info or None,
                "guidelines": guidelines or None,
                "storyEntity": story_entity or None,
            },
            "outline": defaults["outline"],
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
        if "selectedContextIds" in payload:
            selected_context_ids = _as_str_list(payload.get("selectedContextIds"))
        elif "selectedEntityIds" in payload:
            selected_context_ids = _as_str_list(payload.get("selectedEntityIds"))
        else:
            selected_context_ids = list(context_object_ids)
        object_id = str(payload.get("objectId") or "").strip()
        manuscript_id = str(payload.get("manuscriptId") or "").strip()
        scene_context = _as_dict(payload.get("sceneContext"))
        target_type = str(payload.get("objectType") or "").strip()

        basic_info = _find_basic_info(project_data, object_id) if target_type in {"", "basic_info"} else {}
        story_entity = _find_story_entity(project_data, object_id) if target_type in {"", "story_entity"} else {}
        scene_manuscript = _find_manuscript_by_id(project_data, manuscript_id)

        return {
            "promptMode": str(payload.get("promptMode") or "natural"),
            "currentTarget": {
                "basicInfo": {
                    "id": str(basic_info.get("id") or ""),
                    "title": str(basic_info.get("title") or ""),
                    "logline": str(basic_info.get("logline") or ""),
                    "image_prompt": str(basic_info.get("imagePrompt") or ""),
                    "image_prompt_positive": str(basic_info.get("imagePromptPositive") or ""),
                    "image_prompt_negative": str(basic_info.get("imagePromptNegative") or ""),
                }
                if basic_info
                else None,
                "storyEntity": {
                    "id": str(story_entity.get("id") or ""),
                    "kind": str(story_entity.get("kind") or payload.get("objectKind") or ""),
                    "name": str(story_entity.get("name") or ""),
                    "description": str(story_entity.get("description") or ""),
                    "content": str(story_entity.get("content") or ""),
                    "image_prompt": str(story_entity.get("imagePrompt") or ""),
                    "image_prompt_positive": str(story_entity.get("imagePromptPositive") or ""),
                    "image_prompt_negative": str(story_entity.get("imagePromptNegative") or ""),
                }
                if story_entity
                else None,
            },
            "sceneChapter": {
                "manuscriptId": str(scene_manuscript.get("id") or ""),
                "chapterId": str(scene_manuscript.get("chapterId") or ""),
                "chapterName": str(scene_manuscript.get("chapterName") or ""),
                "actNumber": scene_manuscript.get("actNumber") if scene_manuscript else None,
                "chapterNumber": scene_manuscript.get("chapterNumber") if scene_manuscript else None,
            },
            "scenePreContext": str(scene_context.get("preContext") or ""),
            "scenePostContext": str(scene_context.get("postContext") or ""),
            "selectedContextIds": selected_context_ids,
            # Keep the legacy name available to saved journeys and custom templates.
            "selectedEntityIds": selected_context_ids,
        }

    def build_template_data(
        self,
        db: Session,
        *,
        user_id: UUID,
        preset_id: UUID,
        task_type: str,
        thread: Thread,
        run: RunModel,
        project_data: dict[str, Any],
        input_text: str,
        input_payload: dict[str, Any],
    ) -> dict[str, Any]:
        parent = resolve_parent(db, thread)
        task_cfg = settings_service.get_task_config(
            db, user_id, task_type, sub_agent=parent.sub_agent_definition
        )

        payload = input_payload
        language = str(run.language or "English")
        context_object_ids = _as_str_list(run.context_object_ids)
        journey_target_ids = _as_str_list(run.journey_target_ids)
        native_output_mode = bool(getattr(settings_service._get_settings(db, user_id), "native_output_mode", False))  # pylint: disable=protected-access
        output_mode = resolve_output_mode(
            journey_kind=parent.journey_kind,
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
                "today": datetime.now(timezone.utc).date().isoformat(),
                "thinking_mode": str(task_cfg.advanced.get("thinking_mode") or "off"),
                "outputMode": output_mode,
            },
            "project": project_data,
            "input": {
                "userMessage": input_text,
                "agentMessage": input_text,
                "subAgentMessage": "",
                "toolResults": [],
            },
            "agent": {
                "runMode": str(run.run_mode or "agentMode"),
                "surface": str(run.surface or "story-entity"),
                "contextObjectIds": context_object_ids,
            },
            "journey": {
                "kind": str(parent.journey_kind or ""),
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
            "memory": {
                "summaries": [],
                "historyChats": [],
            },
            "variables": variables if isinstance(variables, dict) else {},
        }

        return template_data
