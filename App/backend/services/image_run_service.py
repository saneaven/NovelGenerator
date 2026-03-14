from __future__ import annotations

import asyncio
import math
from datetime import datetime
from typing import Any, Callable
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..image_providers import gemini_image, novelai_image, openai_image, openrouter_image, xai_image
from ..image_providers.base import BaseImageProvider, ImageGenerationResult, ReferenceImageData
from ..image_providers.registry import ImageProviderRegistry
from ..models.db_models import (
    Act,
    Asset,
    BasicInfo,
    Chapter,
    Character,
    ImageRunModel,
    Location,
    LorebookEntry,
    Manuscript,
    Organization,
    Outline,
    RunToolCallModel,
    StoryObjectAsset,
    UserSettings,
)
from ..schemas.assets import CreateImageRunRequest, ImageRunResponse, StyledPrompt
from ..schemas.settings import ImageGenConfig
from ..services.credential_service import credential_service
from ..services.deletion_service import delete_assets_with_files
from ..services.image_model_catalog_service import (
    image_model_catalog_service,
    sanitize_generation_settings,
)
from ..services.manuscript_image_index_service import restore_image_asset_ids
from ..services.notification_service import (
    build_image_run_notification_snapshot,
    serialize_notification,
    upsert_notification_source,
)
from ..services.object_change_events import queue_object_change
from ..services.object_service import object_service
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..services.settings_service import settings_service
from ..services.sidecar_client import SidecarClient, SidecarConversionError, SidecarUnavailableError, sidecar_client
from ..services.storage_service import storage_service
from ..services.thread_runtime_sync_service import emit_runtime_sync_events, sync_run_thread_status
from .asset_change_events import (
    queue_project_assets_change,
    queue_scene_assets_change,
    queue_story_object_assets_change,
)
from ..services.storage_usage_service import (
    StorageQuotaExceededError,
    apply_project_usage_delta,
    apply_project_usage_deltas,
    build_asset_delta,
    build_asset_rows_delta,
    build_image_run_delta,
    build_tool_call_delta,
    snapshot_asset_row,
    snapshot_image_run_row,
    snapshot_rows,
    snapshot_tool_call_row,
)
from ..utils.object_type_aliases import normalize_object_type


IMAGE_OBJECT_TOOL = "generate_object_image"
IMAGE_SCENE_TOOL = "generate_scene_image"
IMAGE_RUN_ACTIVE_STATUSES = {"queued", "running", "review", "applying"}
OBJECT_IMAGE_TYPES = ("basic_info", "character", "organization", "location", "lorebook")
OBJECT_BINDING_MODELS = {
    "basic_info": BasicInfo,
    "character": Character,
    "organization": Organization,
    "location": Location,
    "lorebook": LorebookEntry,
}


def _json_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _parse_uuid(raw: Any, *, field_name: str) -> UUID:
    try:
        return UUID(str(raw))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {field_name}: {raw}") from exc


def _styled_prompt_to_dict(value: StyledPrompt | dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, StyledPrompt):
        return value.model_dump()
    if isinstance(value, dict):
        return {
            "prefix": str(value.get("prefix") or ""),
            "content": str(value.get("content") or ""),
            "postfix": str(value.get("postfix") or ""),
        }
    return None


def _styled_prompt_from_dict(value: Any) -> StyledPrompt | None:
    if not isinstance(value, dict):
        return None
    return StyledPrompt(
        prefix=str(value.get("prefix") or ""),
        content=str(value.get("content") or ""),
        postfix=str(value.get("postfix") or ""),
    )


def _safe_lang_data(obj: dict[str, Any], language: str) -> dict[str, Any]:
    data = obj.get("data")
    if not isinstance(data, dict):
        return {}
    if isinstance(data.get(language), dict):
        return data[language]
    for value in data.values():
        if isinstance(value, dict):
            return value
    return {}


def _object_display_name(obj: dict[str, Any], language: str, *, fallback: str) -> str:
    data = _safe_lang_data(obj, language)
    for key in ("name", "title"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _parse_ratio_value(raw: str | None) -> float | None:
    text = str(raw or "").strip().lower()
    if not text:
        return None
    for sep in (":", "/", "x"):
        if sep in text:
            left, right = text.split(sep, 1)
            try:
                width = float(left.strip())
                height = float(right.strip())
            except ValueError:
                return None
            if width <= 0 or height <= 0:
                return None
            return width / height
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 0 else None


def _ratio_from_size(size: str) -> float | None:
    return _parse_ratio_value(size)


def _simplify_ratio(width: int, height: int) -> str:
    divisor = math.gcd(width, height) or 1
    return f"{width // divisor}:{height // divisor}"


def _ratio_label_from_size(size: str) -> str:
    text = str(size or "").strip()
    if "x" not in text:
        return text or "1:1"
    try:
        width_text, height_text = text.split("x", 1)
        return _simplify_ratio(int(width_text), int(height_text))
    except ValueError:
        return text or "1:1"


def _pick_nearest_ratio_label(candidates: list[str], requested_ratio: float | None) -> str:
    if not candidates:
        return "1:1"
    if requested_ratio is None:
        return str(candidates[0])
    return min(
        candidates,
        key=lambda candidate: abs((_parse_ratio_value(candidate) or requested_ratio) - requested_ratio),
    )


def _pick_nearest_size(candidates: list[str], requested_ratio: float | None, fallback: str) -> str:
    if not candidates:
        return fallback
    if requested_ratio is None:
        return str(candidates[0])
    return min(
        candidates,
        key=lambda size: abs((_ratio_from_size(size) or requested_ratio) - requested_ratio),
    )


def _get_image_settings(settings_row: UserSettings) -> ImageGenConfig:
    raw = settings_row.image_gen_config if isinstance(settings_row.image_gen_config, dict) else {}
    return ImageGenConfig.model_validate(raw)


def _provider_template(provider_name: str) -> BaseImageProvider:
    return ImageProviderRegistry.get_provider(provider_name, {})


def _selected_style(config: ImageGenConfig) -> tuple[str | None, dict[str, Any] | None]:
    provider = config.provider
    if provider == "novelai":
        selected_id = config.selectedTagBasedStyleId
        if not selected_id:
            return None, None
        return selected_id, next((style.model_dump() for style in config.tagBasedStyles if style.id == selected_id), None)
    selected_id = config.selectedNaturalStyleId
    if not selected_id:
        return None, None
    return selected_id, next((style.model_dump() for style in config.naturalStyles if style.id == selected_id), None)


def _build_tool_recipe_snapshot(
    *,
    settings_row: UserSettings,
    prompt_text: str,
    requested_aspect_ratio: str,
    requested_image_size: str | None,
) -> dict[str, Any]:
    config = _get_image_settings(settings_row)
    provider_name = config.provider
    provider = _provider_template(provider_name)
    prompt_type = provider.get_prompt_type()
    style_id, style = _selected_style(config)
    style = style or {}

    prompt_payload: StyledPrompt | None = None
    positive_payload: StyledPrompt | None = None
    negative_payload: StyledPrompt | None = None
    if prompt_type == "tag_based":
        positive_payload = StyledPrompt(
            prefix=str(style.get("positivePrefix") or ""),
            content=prompt_text,
            postfix=str(style.get("positivePostfix") or ""),
        )
        negative_prefix = str(style.get("negativePrefix") or "")
        negative_postfix = str(style.get("negativePostfix") or "")
        if negative_prefix or negative_postfix:
            negative_payload = StyledPrompt(prefix=negative_prefix, content="", postfix=negative_postfix)
    else:
        prompt_payload = StyledPrompt(
            prefix=str(style.get("prefix") or ""),
            content=prompt_text,
            postfix=str(style.get("postfix") or ""),
        )

    provider_settings: dict[str, Any] = {}
    if provider_name == "openai":
        provider_settings = {
            "quality": config.openaiSettings.quality,
            "background": config.openaiSettings.background,
            "output_format": config.openaiSettings.output_format,
            "output_compression": config.openaiSettings.output_compression,
            "input_fidelity": config.openaiSettings.input_fidelity,
        }
    elif provider_name == "novelai":
        provider_settings = {
            "sampler": config.novelaiSettings.sampler,
            "steps": config.novelaiSettings.steps,
            "scale": config.novelaiSettings.scale,
            "noise_schedule": config.novelaiSettings.noise_schedule,
        }

    return {
        "prompt_type": prompt_type,
        "provider": provider_name,
        "model": config.model,
        "requested_aspect_ratio": requested_aspect_ratio,
        "requested_image_size": str(requested_image_size or config.image_size).strip() or config.image_size,
        "style_id": style_id,
        "prompt": _styled_prompt_to_dict(prompt_payload),
        "positive_prompt": _styled_prompt_to_dict(positive_payload),
        "negative_prompt": _styled_prompt_to_dict(negative_payload),
        "provider_settings": sanitize_generation_settings(provider_name, provider_settings),
        "reference_images": None,
        "reference_objects": None,
    }


def resolve_explicit_object_target(
    db: Session,
    *,
    project_id: UUID,
    language: str,
    object_id: UUID,
) -> tuple[str, UUID]:
    matches: list[str] = []
    for object_type in OBJECT_IMAGE_TYPES:
        obj = object_service.get_object(
            db,
            object_type=object_type,
            object_id=object_id,
            project_id=project_id,
            language=language,
        )
        if obj is not None:
            matches.append(normalize_object_type(object_type))
    unique = list(dict.fromkeys(matches))
    if not unique:
        raise ValueError("No target object resolved for image generation")
    if len(unique) > 1:
        raise ValueError("Multiple target objects resolved. Provide a valid object_id.")
    return unique[0], object_id


async def markdown_for_manuscript(
    db: Session,
    *,
    project_id: UUID,
    manuscript_id: UUID,
    language: str,
    sidecar: SidecarClient,
) -> tuple[str, dict[str, Any]]:
    obj = object_service.get_object(
        db,
        object_type="manuscript",
        object_id=manuscript_id,
        project_id=project_id,
        language=language,
    )
    if obj is None:
        raise ValueError(f"manuscript not found: {manuscript_id}")
    lang_data = _safe_lang_data(obj, language)
    original_doc = lang_data.get("doc")
    if not isinstance(original_doc, dict):
        raise ValueError("MANUSCRIPT_EMPTY")
    try:
        markdown = await sidecar.doc_to_markdown(original_doc)
    except SidecarUnavailableError as exc:
        raise ValueError("SIDECAR_ERROR: unavailable") from exc
    except SidecarConversionError as exc:
        raise ValueError(f"SIDECAR_ERROR: {exc}") from exc
    return markdown, original_doc


def anchor_excerpts(markdown: str, anchor: str) -> tuple[str, str]:
    idx = markdown.find(anchor)
    if idx < 0:
        return "", ""
    before = markdown[max(0, idx - 120):idx].strip()
    after = markdown[idx + len(anchor): idx + len(anchor) + 120].strip()
    return before, after


async def validate_scene_anchor(
    db: Session,
    *,
    project_id: UUID,
    manuscript_id: UUID,
    language: str,
    anchor: str,
    sidecar: SidecarClient,
) -> tuple[str, str]:
    markdown, _original_doc = await markdown_for_manuscript(
        db,
        project_id=project_id,
        manuscript_id=manuscript_id,
        language=language,
        sidecar=sidecar,
    )
    count = markdown.count(anchor)
    if count != 1:
        raise ValueError("insert_before must match exactly once in the current manuscript")
    return anchor_excerpts(markdown, anchor)


def _request_language(row: ImageRunModel) -> str:
    snapshot = _json_dict(row.request_snapshot)
    language = str(snapshot.get("language") or "").strip()
    return language or "English"


def _tool_call_id_from_snapshot(snapshot: dict[str, Any]) -> str | None:
    raw = snapshot.get("tool_call_id")
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _attach_image_asset_id_by_src(doc: Any, *, src: str, asset_id: UUID) -> None:
    if not isinstance(doc, dict):
        return

    attached = False

    def _walk(node: Any) -> None:
        nonlocal attached
        if attached or not isinstance(node, dict):
            return
        if node.get("type") == "image":
            attrs = node.get("attrs")
            if isinstance(attrs, dict) and attrs.get("src") == src and not (attrs.get("data-asset-id") or attrs.get("assetId")):
                attrs["data-asset-id"] = str(asset_id)
                attached = True
                return
        children = node.get("content")
        if isinstance(children, list):
            for child in children:
                _walk(child)

    _walk(doc)
    if not attached:
        raise ValueError("Inserted image node was not found in manuscript document")


class ImageRunService:
    def __init__(self, db_factory: Callable[[], Session]) -> None:
        self._db_factory = db_factory
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._task_lock = asyncio.Lock()

    async def _spawn_task(self, image_run_id: UUID) -> None:
        async with self._task_lock:
            existing = self._tasks.get(image_run_id)
            if existing is not None and not existing.done():
                return

            task = asyncio.create_task(self.execute_run(image_run_id))
            self._tasks[image_run_id] = task

            def _cleanup(done_task: asyncio.Task) -> None:
                _ = done_task
                self._tasks.pop(image_run_id, None)

            task.add_done_callback(_cleanup)

    async def start_run(self, image_run_id: UUID) -> None:
        await self._spawn_task(image_run_id)

    async def fail_run(self, *, image_run_id: UUID, failure_code: str, error_message: str) -> None:
        await self._mark_failed(image_run_id=image_run_id, failure_code=failure_code, error_message=error_message)

    def require_owned_run(self, *, project_id: UUID, user_id: UUID, image_run_id: UUID, db: Session | None = None) -> ImageRunModel:
        owns_session = db is None
        session = db or self._db_factory()
        try:
            row = (
                session.query(ImageRunModel)
                .filter(
                    ImageRunModel.id == image_run_id,
                    ImageRunModel.project_id == project_id,
                    ImageRunModel.user_id == user_id,
                )
                .first()
            )
            if row is None:
                raise HTTPException(status_code=404, detail="Image run not found")
            return row
        finally:
            if owns_session:
                session.close()

    async def cancel_run(self, *, project_id: UUID, user_id: UUID, image_run_id: UUID) -> ImageRunModel:
        db = self._db_factory()
        try:
            row = (
                db.query(ImageRunModel)
                .filter(
                    ImageRunModel.id == image_run_id,
                    ImageRunModel.project_id == project_id,
                    ImageRunModel.user_id == user_id,
                )
                .with_for_update()
                .first()
            )
            if row is None:
                raise HTTPException(status_code=404, detail="Image run not found")
            if row.status not in {"queued", "running"}:
                return row
            before = snapshot_image_run_row(row)
            row.status = "canceled"
            row.stage = None
            row.failure_code = "canceled"
            row.error_message = None
            row.updated_at = datetime.utcnow()
            apply_project_usage_delta(
                db,
                user_id=user_id,
                project_id=project_id,
                delta=build_image_run_delta(before, snapshot_image_run_row(row)),
                enforce_quota=False,
            )
            db.commit()
            db.refresh(row)
        finally:
            db.close()

        async with self._task_lock:
            task = self._tasks.get(image_run_id)
            if task is not None and not task.done():
                task.cancel()

        await self.emit_updates(image_run_id)
        await self.complete_tool_call_from_image_run(image_run_id)
        return self.require_owned_run(project_id=project_id, user_id=user_id, image_run_id=image_run_id)

    def _normalize_direct_target(self, *, target: dict[str, Any]) -> tuple[dict[str, Any], str]:
        target_type = str(target.get("type") or "").strip()
        if target_type == "scene":
            manuscript_id = _parse_uuid(target.get("manuscript_id"), field_name="manuscript_id")
            return {
                "type": "scene",
                "manuscript_id": str(manuscript_id),
            }, "bind_scene_asset"

        if target_type == "object":
            object_type = normalize_object_type(str(target.get("object_type") or ""))
            object_id = _parse_uuid(target.get("object_id"), field_name="object_id")
            return {
                "type": "object",
                "object_type": object_type,
                "object_id": str(object_id),
            }, "bind_object_asset"

        raise ValueError("target.type must be object|scene")

    def create_direct_run(
        self,
        db: Session,
        *,
        project_id: UUID,
        user_id: UUID,
        request: CreateImageRunRequest,
    ) -> ImageRunModel:
        target, apply_kind = self._normalize_direct_target(target=request.target.model_dump())
        self._validate_direct_target(db, project_id=project_id, target=target)
        recipe_snapshot = request.recipe.model_dump()
        recipe_snapshot["provider_settings"] = sanitize_generation_settings(
            str(recipe_snapshot.get("provider") or ""),
            recipe_snapshot.get("provider_settings"),
        )

        row = ImageRunModel(
            id=uuid4(),
            project_id=project_id,
            user_id=user_id,
            thread_id=None,
            client_request_id=request.client_request_id,
            origin="direct",
            review_mode="auto",
            status="queued",
            stage=None,
            request_snapshot={
                "label": "Image generation",
                "recipe": recipe_snapshot,
                "target": target,
                "apply_kind": apply_kind,
            },
        )
        db.add(row)
        db.flush()
        apply_project_usage_delta(
            db,
            user_id=user_id,
            project_id=project_id,
            delta=build_image_run_delta(None, snapshot_image_run_row(row)),
            enforce_quota=True,
        )
        return row

    async def create_tool_preview_run(
        self,
        db: Session,
        *,
        tool_call: RunToolCallModel,
        user_id: UUID,
        language: str,
    ) -> ImageRunModel:
        if not isinstance(tool_call.arguments, dict):
            raise ValueError("Image tool arguments are invalid")

        prompt_text = str(tool_call.arguments.get("prompt") or "").strip()
        requested_aspect_ratio = str(tool_call.arguments.get("ratio") or "").strip()
        requested_image_size = str(tool_call.arguments.get("image_size") or "").strip() or None
        if not prompt_text:
            raise ValueError("prompt must be a non-empty string")
        if not requested_aspect_ratio:
            raise ValueError("ratio must be a non-empty string")

        settings_row = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
        recipe = _build_tool_recipe_snapshot(
            settings_row=settings_row,
            prompt_text=prompt_text,
            requested_aspect_ratio=requested_aspect_ratio,
            requested_image_size=requested_image_size,
        )

        before_excerpt: str | None = None
        after_excerpt: str | None = None
        target: dict[str, Any]
        apply_kind: str

        project_id = tool_call.thread.project_id if tool_call.thread is not None else tool_call.run.project_id

        if tool_call.tool_name == IMAGE_OBJECT_TOOL:
            object_id = _parse_uuid(tool_call.arguments.get("object_id"), field_name="object_id")
            object_type, resolved_object_id = resolve_explicit_object_target(
                db,
                project_id=project_id,
                language=language,
                object_id=object_id,
            )
            target = {
                "type": "object",
                "object_type": object_type,
                "object_id": str(resolved_object_id),
            }
            apply_kind = "set_object_main_image"
        elif tool_call.tool_name == IMAGE_SCENE_TOOL:
            if sidecar_client is None:
                raise ValueError("SIDECAR_ERROR: sidecar client unavailable")
            manuscript_id = _parse_uuid(tool_call.arguments.get("manuscript_id"), field_name="manuscript_id")
            anchor = str(tool_call.arguments.get("insert_before") or "").strip()
            if not anchor:
                raise ValueError("insert_before must be a non-empty string")
            before_excerpt, after_excerpt = await validate_scene_anchor(
                db,
                project_id=project_id,
                manuscript_id=manuscript_id,
                language=language,
                anchor=anchor,
                sidecar=sidecar_client,
            )
            target = {
                "type": "scene",
                "manuscript_id": str(manuscript_id),
                "insert_before": anchor,
            }
            apply_kind = "insert_scene_before_anchor"
        else:
            raise ValueError("Unsupported image tool")

        row = ImageRunModel(
            id=uuid4(),
            project_id=project_id,
            user_id=user_id,
            thread_id=tool_call.thread_id,
            client_request_id=None,
            origin="tool_preview",
            review_mode="manual",
            status="queued",
            stage=None,
            request_snapshot={
                "label": "Image generation",
                "tool_call_id": str(tool_call.id),
                "language": language,
                "recipe": recipe,
                "target": target,
                "apply_kind": apply_kind,
            },
            before_excerpt=before_excerpt,
            after_excerpt=after_excerpt,
        )
        db.add(row)
        db.flush()
        tool_call.image_run_id = row.id
        tool_call.updated_at = datetime.utcnow()
        db.flush()
        apply_project_usage_delta(
            db,
            user_id=user_id,
            project_id=project_id,
            delta=build_image_run_delta(None, snapshot_image_run_row(row)),
            enforce_quota=True,
        )
        return row

    def serialize(self, db: Session, row: ImageRunModel) -> ImageRunResponse:
        preview_asset_url: str | None = None
        if row.preview_asset_id:
            preview_asset = db.query(Asset).filter(Asset.id == row.preview_asset_id).first()
            if preview_asset is not None:
                preview_asset_url = storage_service.build_public_asset_path(str(preview_asset.file_path))

        snapshot = _json_dict(row.request_snapshot)
        tool_call_id = _tool_call_id_from_snapshot(snapshot)
        recipe = _json_dict(snapshot.get("recipe"))

        return ImageRunResponse(
            id=str(row.id),
            project_id=str(row.project_id),
            user_id=str(row.user_id),
            thread_id=str(row.thread_id) if row.thread_id else None,
            tool_call_id=tool_call_id,
            client_request_id=row.client_request_id,
            origin=str(row.origin),
            review_mode=str(row.review_mode),
            status=str(row.status),
            stage=str(row.stage) if row.stage else None,
            request_snapshot=snapshot,
            preview_asset_id=str(row.preview_asset_id) if row.preview_asset_id else None,
            preview_asset_url=preview_asset_url,
            final_asset_id=str(row.final_asset_id) if row.final_asset_id else None,
            provider=row.provider,
            model=row.model,
            requested_aspect_ratio=str(recipe.get("requested_aspect_ratio") or "") or None,
            requested_image_size=str(recipe.get("requested_image_size") or "") or None,
            resolved_aspect_ratio=row.resolved_aspect_ratio,
            resolved_image_size=row.resolved_image_size,
            resolved_native_size=row.resolved_native_size,
            revised_prompt=row.revised_prompt,
            before_excerpt=row.before_excerpt,
            after_excerpt=row.after_excerpt,
            failure_code=row.failure_code,
            error_message=row.error_message,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def list_runs(self, db: Session, *, project_id: UUID, user_id: UUID, scope: str) -> list[ImageRunModel]:
        query = db.query(ImageRunModel).filter(
            ImageRunModel.project_id == project_id,
            ImageRunModel.user_id == user_id,
        )
        if scope == "active":
            query = query.filter(ImageRunModel.status.in_(list(IMAGE_RUN_ACTIVE_STATUSES)))
        else:
            query = query.order_by(ImageRunModel.updated_at.desc()).limit(50)
        return query.order_by(ImageRunModel.updated_at.desc()).all()

    def list_thread_runs(self, db: Session, *, thread_id: UUID) -> list[ImageRunModel]:
        return (
            db.query(ImageRunModel)
            .filter(ImageRunModel.thread_id == thread_id)
            .order_by(ImageRunModel.created_at.asc())
            .all()
        )

    async def emit_updates(self, image_run_id: UUID) -> None:
        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).first()
            if row is None:
                return
            payload = self.serialize(db, row).model_dump(mode="json")
            await runtime_event_dispatcher.emit_project_event(
                user_id=row.user_id,
                project_id=row.project_id,
                event_name="image_run:update",
                data=payload,
            )

            custom_slot: dict[str, Any] = {"type": "none"}
            if payload.get("preview_asset_url"):
                custom_slot = {
                    "type": "image",
                    "url": payload["preview_asset_url"],
                    "alt": "Generated image",
                }
            elif row.final_asset_id:
                final_asset = db.query(Asset).filter(Asset.id == row.final_asset_id).first()
                if final_asset is not None:
                    custom_slot = {
                        "type": "image",
                        "url": storage_service.build_public_asset_path(str(final_asset.file_path)),
                        "alt": final_asset.name,
                    }

            notification = upsert_notification_source(
                db,
                snapshot=build_image_run_notification_snapshot(
                    row=row,
                    serialized_payload=payload,
                    custom_slot=custom_slot,
                ),
            )
            db.commit()
            db.refresh(notification)
            await runtime_event_dispatcher.emit_project_event(
                user_id=row.user_id,
                project_id=row.project_id,
                event_name="notification:upsert",
                data=serialize_notification(notification),
            )
        finally:
            db.close()

    async def execute_run(self, image_run_id: UUID) -> None:
        db = self._db_factory()
        try:
            row = (
                db.query(ImageRunModel)
                .filter(ImageRunModel.id == image_run_id)
                .with_for_update()
                .first()
            )
            if row is None or row.status not in {"queued", "running"}:
                return
            row.status = "running"
            row.stage = "preparing"
            row.updated_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()

        await self.emit_updates(image_run_id)

        try:
            recipe, result = await self._generate_image_result(image_run_id)
            await self._persist_generation_result(image_run_id=image_run_id, recipe=recipe, result=result)
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            await self._mark_failed(
                image_run_id=image_run_id,
                failure_code="generation_failed",
                error_message=str(exc),
            )

    async def _generate_image_result(self, image_run_id: UUID) -> tuple[dict[str, Any], ImageGenerationResult]:
        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).first()
            if row is None:
                raise ValueError("Image run not found")
            snapshot = _json_dict(row.request_snapshot)
            recipe = _json_dict(snapshot.get("recipe"))
            provider_name = str(recipe.get("provider") or "").strip()
            if not provider_name:
                raise ValueError("Image provider is required")
            provider_config = credential_service.get_provider_config(db, row.user_id, provider_name)
            provider = ImageProviderRegistry.get_provider(provider_name, provider_config)
            if not provider.validate_config():
                raise ValueError("Invalid provider configuration")

            geometry = await image_model_catalog_service.resolve_geometry(
                provider=provider_name,
                model=str(recipe.get("model") or "").strip(),
                requested_aspect_ratio=str(recipe.get("requested_aspect_ratio") or "").strip(),
                requested_image_size=str(recipe.get("requested_image_size") or "").strip(),
                provider_config=provider_config,
            )

            recipe["model"] = geometry.model
            recipe["requested_aspect_ratio"] = geometry.requested_aspect_ratio
            recipe["requested_image_size"] = geometry.requested_image_size
            recipe["provider_settings"] = sanitize_generation_settings(provider_name, recipe.get("provider_settings"))
            snapshot["recipe"] = recipe

            row.provider = provider_name
            row.model = geometry.model
            row.request_snapshot = snapshot
            row.resolved_aspect_ratio = geometry.resolved_aspect_ratio
            row.resolved_image_size = geometry.resolved_image_size
            row.resolved_native_size = geometry.resolved_native_size
            row.stage = "generating"
            row.updated_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()

        await self.emit_updates(image_run_id)

        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).first()
            if row is None:
                raise ValueError("Image run not found")
            snapshot = _json_dict(row.request_snapshot)
            recipe = _json_dict(snapshot.get("recipe"))
            provider_name = str(recipe.get("provider") or "").strip()
            provider_config = credential_service.get_provider_config(db, row.user_id, provider_name)
            provider = ImageProviderRegistry.get_provider(provider_name, provider_config)
            provider_settings = sanitize_generation_settings(provider_name, recipe.get("provider_settings")) or {}
            prompt_payload = _styled_prompt_from_dict(recipe.get("prompt"))
            positive_prompt = _styled_prompt_from_dict(recipe.get("positive_prompt"))
            negative_prompt = _styled_prompt_from_dict(recipe.get("negative_prompt"))
            geometry = await image_model_catalog_service.resolve_geometry(
                provider=provider_name,
                model=str(row.model or recipe.get("model") or "").strip(),
                requested_aspect_ratio=str(recipe.get("requested_aspect_ratio") or "").strip(),
                requested_image_size=str(recipe.get("requested_image_size") or "").strip(),
                provider_config=provider_config,
            )

            reference_image_data: list[ReferenceImageData] | None = None
            raw_refs = recipe.get("reference_images")
            if isinstance(raw_refs, list) and geometry.supports_image_input:
                reference_image_data = []
                for raw_ref in raw_refs:
                    if not isinstance(raw_ref, dict):
                        continue
                    asset_id = raw_ref.get("asset_id") or raw_ref.get("assetId")
                    if not asset_id:
                        continue
                    ref_asset = db.query(Asset).filter(
                        Asset.id == _parse_uuid(asset_id, field_name="reference asset_id"),
                        Asset.project_id == row.project_id,
                    ).first()
                    if ref_asset is None:
                        continue
                    image_bytes = storage_service.read_asset_file(str(ref_asset.file_path))
                    image_bytes = storage_service.to_png_bytes(image_bytes)
                    reference_image_data.append(
                        ReferenceImageData(
                            image_data=image_bytes,
                            strength=float(raw_ref.get("strength") or 0.7),
                        )
                    )

            result = await provider.generate_image(
                prompt=f"{prompt_payload.prefix}{prompt_payload.content}{prompt_payload.postfix}" if isinstance(prompt_payload, StyledPrompt) else None,
                positive_prompt=(
                    f"{positive_prompt.prefix}{positive_prompt.content}{positive_prompt.postfix}"
                    if isinstance(positive_prompt, StyledPrompt)
                    else None
                ),
                negative_prompt=(
                    f"{negative_prompt.prefix}{negative_prompt.content}{negative_prompt.postfix}"
                    if isinstance(negative_prompt, StyledPrompt)
                    else None
                ),
                model=str(row.model or recipe.get("model") or ""),
                size=str(row.resolved_native_size or "1024x1024"),
                aspect_ratio=str(row.resolved_aspect_ratio or geometry.resolved_aspect_ratio),
                image_size=str(row.resolved_image_size or geometry.resolved_image_size),
                resolved_native_size=str(row.resolved_native_size or geometry.resolved_native_size),
                quality=str(provider_settings.get("quality") or "auto"),
                provider_settings=provider_settings or None,
                reference_images=reference_image_data,
            )
            if not result.success:
                raise ValueError(result.error or "Image generation failed")
            return recipe, result
        finally:
            db.close()

    async def _persist_generation_result(
        self,
        *,
        image_run_id: UUID,
        recipe: dict[str, Any],
        result: ImageGenerationResult,
    ) -> None:
        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
            if row is None:
                raise ValueError("Image run not found")
            row.stage = "saving"
            row.updated_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()

        await self.emit_updates(image_run_id)

        review_mode = "manual"
        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
            if row is None:
                raise ValueError("Image run not found")
            before = snapshot_image_run_row(row)
            asset = self._create_asset_for_run(
                db=db,
                row=row,
                recipe=recipe,
                result=result,
                is_preview=row.review_mode == "manual",
            )
            review_mode = str(row.review_mode or "manual")
            row.preview_asset_id = asset.id if review_mode == "manual" else None
            row.final_asset_id = asset.id if review_mode == "auto" else None
            row.revised_prompt = result.revised_prompt
            row.provider = str(recipe.get("provider") or row.provider or "")
            row.model = str(recipe.get("model") or row.model or "")
            row.stage = "binding"
            row.updated_at = datetime.utcnow()
            apply_project_usage_delta(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                delta=build_image_run_delta(before, snapshot_image_run_row(row)),
                enforce_quota=True,
            )
            db.commit()
        finally:
            db.close()

        await self.emit_updates(image_run_id)

        if review_mode == "manual":
            db = self._db_factory()
            try:
                row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
                if row is None:
                    return
                row.status = "review"
                row.stage = None
                row.updated_at = datetime.utcnow()
                db.commit()
            finally:
                db.close()
            await self.emit_updates(image_run_id)
            return

        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
            if row is None:
                return
            row.status = "applying"
            row.stage = None
            row.updated_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()

        await self.emit_updates(image_run_id)
        await self._apply_auto_run(image_run_id=image_run_id)

    def _create_asset_for_run(
        self,
        *,
        db: Session,
        row: ImageRunModel,
        recipe: dict[str, Any],
        result: ImageGenerationResult,
        is_preview: bool,
    ) -> Asset:
        if result.image_b64:
            file_path, mime_type, width, height, file_size = storage_service.save_generated_image(
                base64_data=result.image_b64,
                project_id=row.project_id,
                format=result.format,
            )
        elif result.image_data:
            file_path, mime_type, width, height, file_size = storage_service.save_generated_image_from_url(
                image_bytes=result.image_data,
                project_id=row.project_id,
                format=result.format,
            )
        else:
            raise ValueError("No image data returned from provider")

        prompt_payload = _styled_prompt_from_dict(recipe.get("prompt"))
        positive_prompt = _styled_prompt_from_dict(recipe.get("positive_prompt"))
        negative_prompt = _styled_prompt_from_dict(recipe.get("negative_prompt"))
        target = _json_dict(_json_dict(row.request_snapshot).get("target"))
        asset_type = "scene" if target.get("type") == "scene" else "object"
        asset = Asset(
            id=uuid4(),
            project_id=row.project_id,
            manuscript_id=None,
            preview_image_run_id=row.id if is_preview else None,
            name=f"{'Generated Preview' if is_preview else 'Generated Image'} {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
            file_path=file_path,
            mime_type=mime_type,
            asset_type=asset_type,
            generation_prompt=_styled_prompt_to_dict(prompt_payload),
            generation_positive_prompt=_styled_prompt_to_dict(positive_prompt),
            generation_negative_prompt=_styled_prompt_to_dict(negative_prompt),
            generation_provider=str(recipe.get("provider") or ""),
            generation_model=str(recipe.get("model") or ""),
            generation_style_id=str(recipe.get("style_id") or "") or None,
            generation_settings=sanitize_generation_settings(
                str(recipe.get("provider") or ""),
                recipe.get("provider_settings"),
            ),
            generation_reference_images=recipe.get("reference_images") if isinstance(recipe.get("reference_images"), list) else None,
            generation_reference_objects=recipe.get("reference_objects") if isinstance(recipe.get("reference_objects"), list) else None,
            width=width or result.width,
            height=height or result.height,
            file_size=file_size,
        )
        db.add(asset)
        db.flush()
        try:
            apply_project_usage_delta(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                delta=build_asset_delta(None, snapshot_asset_row(asset)),
                enforce_quota=True,
            )
        except StorageQuotaExceededError as exc:
            storage_service.delete_asset_files(file_path)
            raise ValueError("Storage quota exceeded") from exc
        return asset

    async def _apply_auto_run(self, *, image_run_id: UUID) -> None:
        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
            if row is None:
                raise ValueError("Image run not found")
            await self._apply_asset_for_run(
                db=db,
                row=row,
                user_id=row.user_id,
                language=_request_language(row),
                sidecar=sidecar_client,
            )
            row.status = "applied"
            row.stage = None
            row.updated_at = datetime.utcnow()
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            await self._mark_failed(image_run_id=image_run_id, failure_code="apply_failed", error_message=str(exc))
            return
        finally:
            db.close()

        await self.emit_updates(image_run_id)
        await self.complete_tool_call_from_image_run(image_run_id)

    async def _apply_asset_for_run(
        self,
        *,
        db: Session,
        row: ImageRunModel,
        user_id: UUID,
        language: str,
        sidecar: SidecarClient | None,
    ) -> None:
        snapshot = _json_dict(row.request_snapshot)
        target = _json_dict(snapshot.get("target"))
        apply_kind = str(snapshot.get("apply_kind") or "")
        asset_id = row.preview_asset_id or row.final_asset_id
        if asset_id is None:
            raise ValueError("Generated asset is missing")
        asset = db.query(Asset).filter(Asset.id == asset_id, Asset.project_id == row.project_id).first()
        if asset is None:
            raise ValueError("Generated asset not found")

        if apply_kind == "bind_object_asset":
            object_type = normalize_object_type(str(target.get("object_type") or ""))
            object_id = _parse_uuid(target.get("object_id"), field_name="object_id")
            max_order = db.query(StoryObjectAsset).filter(
                StoryObjectAsset.object_type == object_type,
                StoryObjectAsset.object_id == object_id,
            ).count()
            db.add(
                StoryObjectAsset(
                    id=uuid4(),
                    object_type=object_type,
                    object_id=object_id,
                    asset_id=asset.id,
                    is_main=False,
                    display_order=max_order,
                )
            )
            asset.preview_image_run_id = None
            queue_object_change(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                object_type=object_type,
                object_id=object_id,
                action="updated",
            )
            queue_project_assets_change(db, user_id=row.user_id, project_id=row.project_id, action="created")
            queue_story_object_assets_change(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                object_type=object_type,
                object_id=object_id,
                action="created",
            )
            row.final_asset_id = asset.id
            return

        if apply_kind == "bind_scene_asset":
            manuscript_id = _parse_uuid(target.get("manuscript_id"), field_name="manuscript_id")
            asset.manuscript_id = manuscript_id
            asset.preview_image_run_id = None
            queue_project_assets_change(db, user_id=row.user_id, project_id=row.project_id, action="created")
            queue_scene_assets_change(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                manuscript_id=None,
                action="created",
            )
            queue_scene_assets_change(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                manuscript_id=manuscript_id,
                action="created",
            )
            row.final_asset_id = asset.id
            return

        if apply_kind == "set_object_main_image":
            object_type = normalize_object_type(str(target.get("object_type") or ""))
            object_id = _parse_uuid(target.get("object_id"), field_name="object_id")
            existing_count = (
                db.query(StoryObjectAsset)
                .filter(StoryObjectAsset.object_type == object_type, StoryObjectAsset.object_id == object_id)
                .count()
            )
            db.query(StoryObjectAsset).filter(
                StoryObjectAsset.object_type == object_type,
                StoryObjectAsset.object_id == object_id,
            ).update({"is_main": False})
            db.add(
                StoryObjectAsset(
                    id=uuid4(),
                    object_type=object_type,
                    object_id=object_id,
                    asset_id=asset.id,
                    is_main=True,
                    display_order=existing_count,
                )
            )
            asset.preview_image_run_id = None
            asset.updated_at = datetime.utcnow()
            queue_object_change(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                object_type=object_type,
                object_id=object_id,
                action="updated",
            )
            queue_project_assets_change(db, user_id=row.user_id, project_id=row.project_id, action="created")
            queue_story_object_assets_change(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                object_type=object_type,
                object_id=object_id,
                action="created",
            )
            row.final_asset_id = asset.id
            return

        if apply_kind != "insert_scene_before_anchor":
            raise ValueError("Unsupported image apply kind")
        if sidecar is None:
            raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

        manuscript_id = _parse_uuid(target.get("manuscript_id"), field_name="manuscript_id")
        anchor = str(target.get("insert_before") or "").strip()
        markdown, original_doc = await markdown_for_manuscript(
            db,
            project_id=row.project_id,
            manuscript_id=manuscript_id,
            language=language,
            sidecar=sidecar,
        )
        if markdown.count(anchor) != 1:
            raise ValueError("insert_before must still match exactly once before applying")

        image_src = storage_service.build_public_asset_path(str(asset.file_path))
        next_markdown = markdown.replace(anchor, f"![Generated Image]({image_src})\n\n{anchor}", 1)
        try:
            next_doc = await sidecar.markdown_to_doc(next_markdown)
        except SidecarUnavailableError as exc:
            raise ValueError("SIDECAR_ERROR: unavailable") from exc
        except SidecarConversionError as exc:
            raise ValueError(f"SIDECAR_ERROR: {exc}") from exc

        restore_image_asset_ids(next_doc, original_doc)
        _attach_image_asset_id_by_src(next_doc, src=image_src, asset_id=asset.id)
        object_service.update_object(
            db,
            project_id=row.project_id,
            object_type="manuscript",
            object_id=manuscript_id,
            data={"doc": next_doc, "wordCount": len(next_markdown.split())},
            language=language,
            user_request="tool:generate_scene_image",
            created_by=user_id,
            create_new_version=True,
        )
        asset.preview_image_run_id = None
        asset.manuscript_id = manuscript_id
        asset.updated_at = datetime.utcnow()
        queue_project_assets_change(db, user_id=row.user_id, project_id=row.project_id, action="created")
        queue_scene_assets_change(
            db,
            user_id=row.user_id,
            project_id=row.project_id,
            manuscript_id=None,
            action="created",
        )
        queue_scene_assets_change(
            db,
            user_id=row.user_id,
            project_id=row.project_id,
            manuscript_id=manuscript_id,
            action="created",
        )
        row.final_asset_id = asset.id

    async def decide_run(self, *, project_id: UUID, user_id: UUID, image_run_id: UUID, decision: str) -> ImageRunModel:
        if decision not in {"accept", "reject"}:
            raise HTTPException(status_code=422, detail="decision must be accept|reject")

        db = self._db_factory()
        try:
            row = (
                db.query(ImageRunModel)
                .filter(
                    ImageRunModel.id == image_run_id,
                    ImageRunModel.project_id == project_id,
                    ImageRunModel.user_id == user_id,
                )
                .with_for_update()
                .first()
            )
            if row is None:
                raise HTTPException(status_code=404, detail="Image run not found")
            if row.review_mode != "manual" or row.status != "review":
                raise HTTPException(status_code=409, detail="Image run is not in review")
            if decision == "reject":
                before = snapshot_image_run_row(row)
                row.status = "rejected"
                row.failure_code = "user_rejected_generated_image"
                row.error_message = "Generated image rejected by user"
                row.updated_at = datetime.utcnow()
                apply_project_usage_delta(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    delta=build_image_run_delta(before, snapshot_image_run_row(row)),
                    enforce_quota=False,
                )
                db.commit()
                db.refresh(row)
            else:
                row.status = "applying"
                row.stage = None
                row.updated_at = datetime.utcnow()
                db.commit()
                db.refresh(row)
        finally:
            db.close()

        await self.emit_updates(image_run_id)
        if decision == "reject":
            await self.complete_tool_call_from_image_run(image_run_id)
            return self.require_owned_run(project_id=project_id, user_id=user_id, image_run_id=image_run_id)

        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
            if row is None:
                raise HTTPException(status_code=404, detail="Image run not found")
            try:
                await self._apply_asset_for_run(
                    db=db,
                    row=row,
                    user_id=user_id,
                    language=_request_language(row),
                    sidecar=sidecar_client,
                )
                row.status = "applied"
                row.stage = None
                row.updated_at = datetime.utcnow()
                db.commit()
                db.refresh(row)
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
                if row is None:
                    raise
                before = snapshot_image_run_row(row)
                row.status = "failed"
                row.failure_code = "apply_failed"
                row.error_message = str(exc)
                row.stage = None
                row.updated_at = datetime.utcnow()
                apply_project_usage_delta(
                    db,
                    user_id=user_id,
                    project_id=project_id,
                    delta=build_image_run_delta(before, snapshot_image_run_row(row)),
                    enforce_quota=False,
                )
                db.commit()
                db.refresh(row)
        finally:
            db.close()

        await self.emit_updates(image_run_id)
        await self.complete_tool_call_from_image_run(image_run_id)
        return self.require_owned_run(project_id=project_id, user_id=user_id, image_run_id=image_run_id)

    async def _mark_failed(self, *, image_run_id: UUID, failure_code: str, error_message: str) -> None:
        db = self._db_factory()
        try:
            row = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).with_for_update().first()
            if row is None:
                return
            before = snapshot_image_run_row(row)
            row.status = "failed"
            row.stage = None
            row.failure_code = failure_code
            row.error_message = error_message
            row.updated_at = datetime.utcnow()
            apply_project_usage_delta(
                db,
                user_id=row.user_id,
                project_id=row.project_id,
                delta=build_image_run_delta(before, snapshot_image_run_row(row)),
                enforce_quota=False,
            )
            db.commit()
        finally:
            db.close()
        await self.emit_updates(image_run_id)
        await self.complete_tool_call_from_image_run(image_run_id)

    async def complete_tool_call_from_image_run(self, image_run_id: UUID) -> None:
        db = self._db_factory()
        try:
            image_run = db.query(ImageRunModel).filter(ImageRunModel.id == image_run_id).first()
            if image_run is None:
                return
            tool_call = (
                db.query(RunToolCallModel)
                .filter(RunToolCallModel.image_run_id == image_run_id)
                .first()
            )
            if tool_call is None or tool_call.status != "working":
                return
            before = snapshot_tool_call_row(tool_call)

            if image_run.status == "applied":
                tool_call.status = "applied"
                tool_call.reason = None
                tool_call.result = {
                    "success": True,
                    "message": "Generated image applied successfully.",
                    "data": {
                        "image_run_id": str(image_run.id),
                        "asset_id": str(image_run.final_asset_id) if image_run.final_asset_id else None,
                    },
                }
            elif image_run.status == "rejected":
                tool_call.status = "failed"
                tool_call.reason = "Generated image rejected by user"
                tool_call.result = {
                    "success": False,
                    "message": "Generated image rejected by user",
                    "error": "Generated image rejected by user",
                    "data": {
                        "failure_code": "user_rejected_generated_image",
                        "image_run_id": str(image_run.id),
                    },
                }
            elif image_run.status in {"failed", "canceled"}:
                tool_call.status = "failed"
                tool_call.reason = image_run.error_message or ("Image run canceled" if image_run.status == "canceled" else "Image generation failed")
                tool_call.result = {
                    "success": False,
                    "message": tool_call.reason,
                    "error": tool_call.reason,
                    "data": {
                        "failure_code": image_run.failure_code,
                        "image_run_id": str(image_run.id),
                    },
                }
            else:
                return

            tool_call.updated_at = datetime.utcnow()

            sync_result = sync_run_thread_status(db, run_id=tool_call.run_id)

            apply_project_usage_delta(
                db,
                user_id=image_run.user_id,
                project_id=image_run.project_id,
                delta=build_tool_call_delta(before, snapshot_tool_call_row(tool_call)),
                enforce_quota=False,
            )
            db.commit()

            await runtime_event_dispatcher.emit_runtime_event(
                user_id=image_run.user_id,
                project_id=image_run.project_id,
                thread_id=tool_call.thread_id,
                event_name="tool_call:status",
                data={
                    "run_id": str(tool_call.run_id),
                    "tool_call_id": str(tool_call.id),
                    "status": tool_call.status,
                    "reason": tool_call.reason,
                    "result": tool_call.result if isinstance(tool_call.result, dict) else None,
                    "extra_content": tool_call.extra_content if isinstance(tool_call.extra_content, dict) else None,
                    "image_run_id": str(image_run.id),
                    "assistant_message_id": str(tool_call.assistant_message_id) if tool_call.assistant_message_id else None,
                    "child_thread_id": str(tool_call.child_thread_id) if tool_call.child_thread_id else None,
                },
                )
            await emit_runtime_sync_events(runtime_event_dispatcher, result=sync_result)
        finally:
            db.close()

    def cleanup_preview_assets_for_image_run(self, db: Session, *, image_run_id: UUID, project_id: UUID, user_id: UUID) -> list[UUID]:
        assets = (
            db.query(Asset)
            .filter(
                Asset.project_id == project_id,
                Asset.preview_image_run_id == image_run_id,
            )
            .all()
        )
        if not assets:
            return []
        deleted_asset_ids = [asset.id for asset in assets if isinstance(asset.id, UUID)]
        deleted_before = snapshot_rows(assets, snapshot_asset_row)
        scrubbed_before = snapshot_rows(
            db.query(Asset)
            .filter(
                Asset.project_id == project_id,
                Asset.generation_reference_images.isnot(None),
                ~Asset.id.in_(deleted_asset_ids) if deleted_asset_ids else True,
            )
            .all(),
            snapshot_asset_row,
        )
        deleted_ids = delete_assets_with_files(
            db,
            assets=assets,
            scrub_references_in_project_id=project_id,
        )
        scrubbed_after = snapshot_rows(
            db.query(Asset)
            .filter(
                Asset.project_id == project_id,
                Asset.generation_reference_images.isnot(None),
                ~Asset.id.in_(deleted_asset_ids) if deleted_asset_ids else True,
            )
            .all(),
            snapshot_asset_row,
        )
        apply_project_usage_deltas(
            db,
            user_id=user_id,
            project_id=project_id,
            deltas=[
                build_asset_rows_delta(deleted_before, []),
                build_asset_rows_delta(scrubbed_before, scrubbed_after),
            ],
            enforce_quota=False,
        )
        return deleted_ids

    def _validate_direct_target(self, db: Session, *, project_id: UUID, target: dict[str, Any]) -> None:
        target_type = str(target.get("type") or "").strip()
        if target_type == "scene":
            manuscript_id = _parse_uuid(target.get("manuscript_id"), field_name="manuscript_id")
            manuscript = (
                db.query(Manuscript)
                .join(Chapter, Manuscript.chapter_id == Chapter.id)
                .join(Act, Chapter.act_id == Act.id)
                .join(Outline, Act.outline_id == Outline.id)
                .filter(Manuscript.id == manuscript_id, Outline.project_id == project_id)
                .first()
            )
            if manuscript is None:
                raise ValueError("Manuscript not found")
            return

        if target_type == "object":
            object_type = normalize_object_type(str(target.get("object_type") or ""))
            object_id = _parse_uuid(target.get("object_id"), field_name="object_id")
            model_class = OBJECT_BINDING_MODELS.get(object_type)
            if model_class is None:
                raise ValueError(f"Unsupported object_type: {object_type}")
            obj = db.query(model_class).filter(model_class.id == object_id, model_class.project_id == project_id).first()
            if obj is None:
                raise ValueError("Object not found")
            return

        raise ValueError("target.type must be object|scene")


image_run_service = ImageRunService(SessionLocal)
