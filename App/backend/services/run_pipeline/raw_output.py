from __future__ import annotations

from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy.orm import Session

from ...models.db_models import Manuscript, RunMessageModel, RunModel, Thread
from ...models.translation_models import ObjectVersion
from ..object_service import object_service
from ..sidecar_client import sidecar_client
from .text_utils import as_dict, as_str_list, collapse_content_text

EmitFn = Callable[..., Awaitable[None]]


async def apply_raw_output(
    db: Session,
    *,
    thread: Thread,
    run: RunModel,
    input_payload: dict[str, Any],
    content_parts: list[dict[str, Any]],
    emit_fn: EmitFn,
) -> None:
    journey_kind = str(thread.journey_kind or "").strip()
    text = collapse_content_text(content_parts)
    if not text:
        raise RuntimeError("Raw output mode requires non-empty content text")

    if journey_kind in {"imagePrompt", "sceneImagePrompt"}:
        return

    if journey_kind == "messageTranslation":
        translation_payload = as_dict(input_payload.get("translation"))
        source_thread_id = UUID(str(translation_payload.get("sourceThreadId") or ""))
        source_message_id = UUID(str(translation_payload.get("sourceMessageId") or ""))
        target_language = str(translation_payload.get("targetLanguage") or run.language).strip()
        if not target_language:
            raise RuntimeError("messageTranslation raw output requires translation.targetLanguage")

        source_thread = (
            db.query(Thread)
            .filter(
                Thread.id == source_thread_id,
                Thread.user_id == run.user_id,
            )
            .first()
        )
        if source_thread is None:
            raise RuntimeError("messageTranslation source thread not found")

        source_message = (
            db.query(RunMessageModel)
            .filter(
                RunMessageModel.id == source_message_id,
                RunMessageModel.thread_id == source_thread_id,
            )
            .first()
        )
        if source_message is None:
            raise RuntimeError("messageTranslation source message not found")

        entry: dict[str, Any] = {
            "contentParts": [{"type": "content", "text": text}],
        }
        current = source_message.data if isinstance(source_message.data, dict) else {}
        existing_target = current.get(target_language) if isinstance(current.get(target_language), dict) else {}
        if isinstance(existing_target.get("reasoningDetail"), dict):
            entry["reasoningDetail"] = existing_target["reasoningDetail"]
        updated = dict(current)
        updated[target_language] = entry
        source_message.data = updated
        db.flush()

        await emit_fn(
            project_id=source_thread.project_id,
            thread_id=source_thread.id,
            event_name="message:update",
            data={
                "run_id": str(run.id),
                "message_id": str(source_message.id),
                "data": {target_language: entry},
            },
        )
        return

    if journey_kind == "manuscriptEdit":
        target_id = UUID(str(input_payload.get("targetId") or ""))
        user_request = str(input_payload.get("userRequest") or "").strip() or "raw:manuscriptEdit"
        manuscript = (
            db.query(Manuscript)
            .filter(Manuscript.chapter_id == target_id)
            .first()
        )
        if manuscript is None:
            raise RuntimeError("manuscriptEdit target not found")
        doc = await sidecar_client.markdown_to_doc(text)
        object_service.update_object(
            db,
            project_id=run.project_id,
            object_type="manuscript",
            object_id=manuscript.id,
            data={
                "doc": doc,
                "wordCount": len(text.split()),
            },
            language=run.language,
            user_request=user_request,
            created_by=run.user_id,
        )
        return

    if journey_kind in {"outlineEdit", "storyObjectEdit"}:
        category = str(input_payload.get("category") or "").strip()
        target_id = UUID(str(input_payload.get("targetId") or ""))
        user_request = str(input_payload.get("userRequest") or "").strip() or f"raw:{journey_kind}"

        current = object_service.get_object(
            db,
            object_type=category,
            object_id=target_id,
            project_id=run.project_id,
            language=run.language,
        )
        if current is None:
            raise RuntimeError(f"{journey_kind} target object not found")

        data_by_lang = current.get("data", {}) if isinstance(current.get("data"), dict) else {}
        current_data = data_by_lang.get(run.language) if isinstance(data_by_lang.get(run.language), dict) else {}
        if not current_data:
            for entry in data_by_lang.values():
                if isinstance(entry, dict):
                    current_data = dict(entry)
                    break
        next_data = dict(current_data)
        if category == "basic_info":
            next_data["logline"] = text
        elif category == "guidelines":
            next_data["authorNote"] = text
        else:
            next_data["content"] = text

        object_service.update_object(
            db,
            project_id=run.project_id,
            object_type=category,
            object_id=target_id,
            data=next_data,
            language=run.language,
            user_request=user_request,
            created_by=run.user_id,
        )
        return

    if journey_kind == "objectTranslation":
        translation_payload = as_dict(input_payload.get("translation"))
        object_ids = as_str_list(translation_payload.get("objectIds"))
        if len(object_ids) != 1:
            raise RuntimeError("objectTranslation raw output requires exactly one objectId")

        target_language = str(translation_payload.get("targetLanguage") or "").strip()
        if not target_language:
            raise RuntimeError("objectTranslation raw output requires targetLanguage")

        object_id = UUID(object_ids[0])
        object_type_row = (
            db.query(ObjectVersion.object_type)
            .filter(ObjectVersion.object_id == object_id)
            .order_by(ObjectVersion.version_number.desc())
            .first()
        )
        if object_type_row is None:
            raise RuntimeError("objectTranslation target object not found")

        object_type = str(object_type_row[0] or "").strip()
        current = object_service.get_object(
            db,
            object_type=object_type,
            object_id=object_id,
            project_id=run.project_id,
            language=target_language,
        )
        if current is None:
            raise RuntimeError("objectTranslation target object not found in project")

        data_by_lang = current.get("data", {}) if isinstance(current.get("data"), dict) else {}
        target_data = data_by_lang.get(target_language) if isinstance(data_by_lang.get(target_language), dict) else {}
        if not target_data:
            for entry in data_by_lang.values():
                if isinstance(entry, dict):
                    target_data = dict(entry)
                    break
        next_data = dict(target_data)
        if object_type == "manuscript":
            doc = await sidecar_client.markdown_to_doc(text)
            next_data = {
                "doc": doc,
                "wordCount": len(text.split()),
            }
        elif object_type == "basic_info":
            next_data["logline"] = text
        elif object_type == "guidelines":
            next_data["authorNote"] = text
        else:
            next_data["content"] = text

        object_service.update_object(
            db,
            project_id=run.project_id,
            object_type=object_type,
            object_id=object_id,
            data=next_data,
            language=target_language,
            user_request="raw:objectTranslation",
            created_by=run.user_id,
            create_new_version=False,
        )
        return

    raise RuntimeError(f"Unsupported journey kind for raw output: {journey_kind}")
