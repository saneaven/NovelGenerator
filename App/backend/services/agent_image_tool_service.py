from __future__ import annotations

import math
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from ..image_providers.base import BaseImageProvider, ImageGenerationResult
from ..image_providers.registry import ImageProviderRegistry
from ..models.db_models import Asset, RunModel, RunToolCallModel, StoryObjectAsset, UserSettings
from ..schemas.assets import StyledPrompt
from ..schemas.settings import ImageGenConfig
from ..services.credential_service import credential_service
from ..services.deletion_service import delete_assets_with_files
from ..services.manuscript_image_index_service import restore_image_asset_ids
from ..services.object_change_events import queue_object_change
from ..services.object_service import object_service
from ..services.settings_service import settings_service
from ..services.storage_quota_service import StorageQuotaExceededError, enforce_user_asset_quota
from ..services.storage_service import storage_service
from ..services.tool_engine.contexts import ToolExecutionContext
from ..services.sidecar_client import SidecarClient, SidecarConversionError, SidecarUnavailableError
from ..utils.object_type_aliases import normalize_object_type


IMAGE_OBJECT_TOOL = "generate_object_image"
IMAGE_SCENE_TOOL = "generate_scene_image"
IMAGE_TOOL_NAMES = {IMAGE_OBJECT_TOOL, IMAGE_SCENE_TOOL}
IMAGE_STATES = {"generating", "generated"}
GEMINI_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]
OBJECT_IMAGE_TYPES = ("basic_info", "character", "organization", "location", "lorebook")


def is_image_tool_name(tool_name: str | None) -> bool:
    return str(tool_name or "") in IMAGE_TOOL_NAMES


def get_image_state(extra_content: dict[str, Any] | None) -> str:
    if not isinstance(extra_content, dict):
        return "generating"
    state = str(extra_content.get("image_state") or "generating")
    if state not in IMAGE_STATES:
        return "generating"
    return state


def merge_extra_content(
    extra_content: dict[str, Any] | None,
    patch: dict[str, Any] | None,
) -> dict[str, Any]:
    base = dict(extra_content) if isinstance(extra_content, dict) else {}
    if not isinstance(patch, dict):
        return base
    base.update(patch)
    return base


def _context_object_ids(run: RunModel) -> list[UUID]:
    raw_ids = run.context_object_ids if isinstance(run.context_object_ids, list) else []
    out: list[UUID] = []
    for raw in raw_ids:
        try:
            out.append(UUID(str(raw)))
        except (TypeError, ValueError):
            continue
    return out


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


def _resolve_single_object_target(
    db: Session,
    *,
    project_id: UUID,
    language: str,
    object_id: UUID | None,
    context_ids: list[UUID],
) -> tuple[str, UUID, str]:
    matches: list[tuple[str, UUID, str]] = []
    candidate_ids = [object_id] if object_id is not None else context_ids
    for candidate_id in candidate_ids:
        if candidate_id is None:
            continue
        for object_type in OBJECT_IMAGE_TYPES:
            obj = object_service.get_object(
                db,
                object_type=object_type,
                object_id=candidate_id,
                project_id=project_id,
                language=language,
            )
            if obj is None:
                continue
            label = _object_display_name(
                obj,
                language,
                fallback="Basic Info" if object_type == "basic_info" else object_type.replace("_", " ").title(),
            )
            matches.append((normalize_object_type(object_type), candidate_id, label))
    unique_matches = list({(item[0], item[1]): item for item in matches}.values())
    if not unique_matches:
        raise ValueError("No target object resolved for image generation")
    if len(unique_matches) > 1:
        raise ValueError("Multiple target objects resolved. Provide object_id explicitly.")
    return unique_matches[0]


def _focused_manuscript_id(run: RunModel) -> UUID | None:
    payload = run.input_payload if isinstance(run.input_payload, dict) else {}
    focus = payload.get("agent_focus")
    if not isinstance(focus, dict):
        return None
    raw_id = focus.get("manuscript_id")
    try:
        return UUID(str(raw_id))
    except (TypeError, ValueError):
        return None


def _resolve_single_manuscript_target(
    db: Session,
    *,
    run: RunModel,
    project_id: UUID,
    language: str,
) -> tuple[UUID, str]:
    candidates: list[UUID] = []
    focused_id = _focused_manuscript_id(run)
    if focused_id is not None:
        candidates.append(focused_id)
    for candidate_id in _context_object_ids(run):
        if candidate_id not in candidates:
            candidates.append(candidate_id)

    matches: list[tuple[UUID, str]] = []
    for candidate_id in candidates:
        obj = object_service.get_object(
            db,
            object_type="manuscript",
            object_id=candidate_id,
            project_id=project_id,
            language=language,
        )
        if obj is None:
            continue
        chapter_id_raw = (obj.get("metadata") or {}).get("chapter_id")
        label = "Manuscript"
        try:
            chapter_id = UUID(str(chapter_id_raw))
        except (TypeError, ValueError):
            chapter_id = None
        if chapter_id is not None:
            chapter_obj = object_service.get_object(
                db,
                object_type="chapter",
                object_id=chapter_id,
                project_id=project_id,
                language=language,
            )
            if chapter_obj is not None:
                chapter_name = _object_display_name(chapter_obj, language, fallback="Chapter")
                label = f"Manuscript: {chapter_name}"
        matches.append((candidate_id, label))
    unique = list({item[0]: item for item in matches}.values())
    if not unique:
        raise ValueError("No target manuscript resolved for scene image generation")
    if len(unique) > 1:
        raise ValueError("Multiple manuscripts resolved. Narrow the context to one manuscript.")
    return unique[0]


async def _markdown_for_manuscript(
    db: Session,
    *,
    project_id: UUID,
    manuscript_id: UUID,
    language: str,
    sidecar: SidecarClient,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
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
    return markdown, original_doc, obj


def _anchor_excerpts(markdown: str, anchor: str) -> tuple[str, str]:
    idx = markdown.find(anchor)
    if idx < 0:
        return "", ""
    before = markdown[max(0, idx - 120):idx].strip()
    after = markdown[idx + len(anchor): idx + len(anchor) + 120].strip()
    return before, after


def _resolve_requested_object_id(args: dict[str, Any]) -> UUID | None:
    raw_id = args.get("object_id")
    if raw_id in (None, ""):
        return None
    try:
        return UUID(str(raw_id))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid object_id: {raw_id}") from exc


def build_object_image_session(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    prompt = str(args.get("prompt") or "").strip()
    ratio = str(args.get("ratio") or "").strip()
    object_id = _resolve_requested_object_id(args)
    object_type, resolved_object_id, object_label = _resolve_single_object_target(
        ctx.db,
        project_id=ctx.project_id,
        language=ctx.language,
        object_id=object_id,
        context_ids=_context_object_ids(ctx.run),
    )
    return {
        "kind": "object",
        "image_state": "generating",
        "prompt": prompt,
        "requested_ratio": ratio,
        "object_id": str(resolved_object_id),
        "object_type": object_type,
        "object_label": object_label,
        "preview_asset_id": None,
        "preview_asset_url": None,
        "resolved_ratio": None,
        "resolved_size": None,
        "provider": None,
        "model": None,
    }


async def build_scene_image_session(args: dict[str, Any], ctx: ToolExecutionContext) -> dict[str, Any]:
    if ctx.sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    prompt = str(args.get("prompt") or "").strip()
    ratio = str(args.get("ratio") or "").strip()
    anchor = str(args.get("insert_before") or "").strip()
    manuscript_id, manuscript_label = _resolve_single_manuscript_target(
        ctx.db,
        run=ctx.run,
        project_id=ctx.project_id,
        language=ctx.language,
    )
    markdown, _original_doc, _obj = await _markdown_for_manuscript(
        ctx.db,
        project_id=ctx.project_id,
        manuscript_id=manuscript_id,
        language=ctx.language,
        sidecar=ctx.sidecar,
    )
    count = markdown.count(anchor)
    if count != 1:
        raise ValueError("insert_before must match exactly once in the current manuscript")
    before_excerpt, after_excerpt = _anchor_excerpts(markdown, anchor)
    return {
        "kind": "scene",
        "image_state": "generating",
        "prompt": prompt,
        "requested_ratio": ratio,
        "manuscript_id": str(manuscript_id),
        "manuscript_label": manuscript_label,
        "insert_before": anchor,
        "before_excerpt": before_excerpt,
        "after_excerpt": after_excerpt,
        "preview_asset_id": None,
        "preview_asset_url": None,
        "resolved_ratio": None,
        "resolved_size": None,
        "provider": None,
        "model": None,
    }


def _get_image_settings(settings_row: UserSettings) -> ImageGenConfig:
    raw = settings_row.image_gen_config if isinstance(settings_row.image_gen_config, dict) else {}
    return ImageGenConfig.model_validate(raw)


def _provider_template(provider_name: str) -> BaseImageProvider:
    return ImageProviderRegistry.get_provider(provider_name, {})


def _find_style(config: ImageGenConfig) -> dict[str, Any] | None:
    provider = config.provider
    if provider == "novelai":
        selected_id = config.selectedTagBasedStyleId
        if not selected_id:
            return None
        return next((style.model_dump() for style in config.tagBasedStyles if style.id == selected_id), None)
    selected_id = config.selectedNaturalStyleId
    if not selected_id:
        return None
    return next((style.model_dump() for style in config.naturalStyles if style.id == selected_id), None)


def _resolve_generation_recipe(
    *,
    settings_row: UserSettings,
    prompt_text: str,
    requested_ratio: str,
) -> dict[str, Any]:
    config = _get_image_settings(settings_row)
    provider_name = config.provider
    provider = _provider_template(provider_name)
    prompt_type = provider.get_prompt_type()
    requested_ratio_value = _parse_ratio_value(requested_ratio)
    style = _find_style(config) or {}

    provider_settings: dict[str, Any] = {}
    resolved_size: str | None = None
    resolved_ratio: str | None = None

    if provider_name == "gemini":
        resolved_ratio = _pick_nearest_ratio_label(GEMINI_ASPECT_RATIOS, requested_ratio_value)
        provider_settings = {
            "aspect_ratio": resolved_ratio,
            "image_resolution": config.geminiSettings.image_resolution,
        }
        resolved_size = config.size
    else:
        resolved_size = _pick_nearest_size(provider.get_supported_sizes(), requested_ratio_value, config.size)
        resolved_ratio = _ratio_label_from_size(resolved_size)
        if provider_name == "openai":
            provider_settings = {
                "quality": config.openaiSettings.quality,
                "style": config.openaiSettings.style,
            }
        elif provider_name == "novelai":
            provider_settings = {
                "sampler": config.novelaiSettings.sampler,
                "steps": config.novelaiSettings.steps,
                "scale": config.novelaiSettings.scale,
                "noise_schedule": config.novelaiSettings.noise_schedule,
            }

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
            negative_payload = StyledPrompt(
                prefix=negative_prefix,
                content="",
                postfix=negative_postfix,
            )
    else:
        prompt_payload = StyledPrompt(
            prefix=str(style.get("prefix") or ""),
            content=prompt_text,
            postfix=str(style.get("postfix") or ""),
        )

    return {
        "provider": provider_name,
        "model": config.model,
        "provider_settings": provider_settings,
        "resolved_size": resolved_size,
        "resolved_ratio": resolved_ratio,
        "prompt_type": prompt_type,
        "prompt": prompt_payload,
        "positive_prompt": positive_payload,
        "negative_prompt": negative_payload,
    }


async def _generate_image_result(
    *,
    db: Session,
    settings_row: UserSettings,
    user_id: UUID,
    project_id: UUID,
    prompt_text: str,
    requested_ratio: str,
) -> tuple[dict[str, Any], ImageGenerationResult]:
    recipe = _resolve_generation_recipe(
        settings_row=settings_row,
        prompt_text=prompt_text,
        requested_ratio=requested_ratio,
    )
    provider_name = str(recipe["provider"])
    provider_config = credential_service.get_provider_config(db, user_id, provider_name)
    provider = ImageProviderRegistry.get_provider(provider_name, provider_config)
    if not provider.validate_config():
        raise ValueError("Invalid provider configuration")

    prompt_payload = recipe.get("prompt")
    positive_prompt = recipe.get("positive_prompt")
    negative_prompt = recipe.get("negative_prompt")
    size = str(recipe.get("resolved_size") or "1024x1024")
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
        model=str(recipe["model"]),
        size=size,
        quality=str((recipe.get("provider_settings") or {}).get("quality") or "standard"),
        style=str((recipe.get("provider_settings") or {}).get("style") or "natural"),
        provider_settings=recipe.get("provider_settings") or None,
    )
    if not result.success:
        raise ValueError(result.error or "Image generation failed")
    return recipe, result


def _persist_generated_asset(
    *,
    db: Session,
    user_id: UUID,
    project_id: UUID,
    tool_call_id: UUID,
    kind: str,
    recipe: dict[str, Any],
    result: ImageGenerationResult,
) -> Asset:
    if result.image_b64:
        file_path, mime_type, width, height, file_size = storage_service.save_generated_image(
            base64_data=result.image_b64,
            project_id=project_id,
            format=result.format,
        )
    elif result.image_data:
        file_path, mime_type, width, height, file_size = storage_service.save_generated_image_from_url(
            image_bytes=result.image_data,
            project_id=project_id,
            format=result.format,
        )
    else:
        raise ValueError("No image data returned from provider")

    try:
        enforce_user_asset_quota(
            db,
            user_id=user_id,
            additional_bytes=int(file_size or 0),
        )
    except StorageQuotaExceededError as exc:
        storage_service.delete_asset_files(file_path)
        raise ValueError("Storage quota exceeded") from exc

    prompt_payload = recipe.get("prompt")
    positive_prompt = recipe.get("positive_prompt")
    negative_prompt = recipe.get("negative_prompt")
    asset = Asset(
        id=uuid4(),
        project_id=project_id,
        preview_tool_call_id=tool_call_id,
        name=f"Generated Preview {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        file_path=file_path,
        mime_type=mime_type,
        asset_type="scene" if kind == "scene" else "object",
        generation_prompt=prompt_payload.model_dump() if isinstance(prompt_payload, StyledPrompt) else None,
        generation_positive_prompt=positive_prompt.model_dump() if isinstance(positive_prompt, StyledPrompt) else None,
        generation_negative_prompt=negative_prompt.model_dump() if isinstance(negative_prompt, StyledPrompt) else None,
        generation_provider=str(recipe["provider"]),
        generation_model=str(recipe["model"]),
        generation_settings=recipe.get("provider_settings") or None,
        width=width or result.width,
        height=height or result.height,
        file_size=file_size,
    )
    db.add(asset)
    try:
        db.flush()
    except Exception:
        storage_service.delete_asset_files(file_path)
        raise
    return asset


async def generate_preview_for_tool_call(
    db: Session,
    *,
    tool_call: RunToolCallModel,
    user_id: UUID,
) -> dict[str, Any]:
    extra = tool_call.extra_content if isinstance(tool_call.extra_content, dict) else {}
    kind = str(extra.get("kind") or "")
    if kind not in {"object", "scene"}:
        raise ValueError("Image tool session is not initialized")
    settings_row = settings_service._get_settings(db, user_id)  # pylint: disable=protected-access
    prompt_text = str(tool_call.arguments.get("prompt") or "").strip() if isinstance(tool_call.arguments, dict) else ""
    requested_ratio = str(tool_call.arguments.get("ratio") or "").strip() if isinstance(tool_call.arguments, dict) else ""
    recipe, generation_result = await _generate_image_result(
        db=db,
        settings_row=settings_row,
        user_id=user_id,
        project_id=tool_call.thread.project_id,
        prompt_text=prompt_text,
        requested_ratio=requested_ratio,
    )
    asset = _persist_generated_asset(
        db=db,
        user_id=user_id,
        project_id=tool_call.thread.project_id,
        tool_call_id=tool_call.id,
        kind=kind,
        recipe=recipe,
        result=generation_result,
    )
    db.flush()

    updated_extra = merge_extra_content(
        extra,
        {
            "image_state": "generated",
            "preview_asset_id": str(asset.id),
            "preview_asset_url": f"/storage/assets/{asset.file_path}",
            "provider": str(recipe["provider"]),
            "model": str(recipe["model"]),
            "resolved_ratio": recipe.get("resolved_ratio"),
            "resolved_size": recipe.get("resolved_size"),
        },
    )
    tool_call.extra_content = updated_extra
    tool_call.updated_at = datetime.utcnow()
    return {
        "success": True,
        "message": "Generated image preview",
        "data": {
            "asset_id": str(asset.id),
            "asset_url": f"/storage/assets/{asset.file_path}",
        },
    }


def _preview_asset_for_tool_call(db: Session, tool_call: RunToolCallModel) -> Asset:
    extra = tool_call.extra_content if isinstance(tool_call.extra_content, dict) else {}
    raw_asset_id = extra.get("preview_asset_id")
    if not raw_asset_id:
        raise ValueError("Preview asset is missing")
    try:
        asset_id = UUID(str(raw_asset_id))
    except (TypeError, ValueError) as exc:
        raise ValueError("Preview asset is invalid") from exc
    asset = (
        db.query(Asset)
        .filter(
            Asset.id == asset_id,
            Asset.project_id == tool_call.thread.project_id,
            Asset.preview_tool_call_id == tool_call.id,
        )
        .first()
    )
    if asset is None:
        raise ValueError("Preview asset not found")
    return asset


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


async def apply_preview_for_tool_call(
    db: Session,
    *,
    tool_call: RunToolCallModel,
    user_id: UUID,
    language: str,
    sidecar: SidecarClient | None,
) -> dict[str, Any]:
    extra = tool_call.extra_content if isinstance(tool_call.extra_content, dict) else {}
    kind = str(extra.get("kind") or "")
    asset = _preview_asset_for_tool_call(db, tool_call)

    if kind == "object":
        object_type = normalize_object_type(str(extra.get("object_type") or ""))
        raw_object_id = extra.get("object_id")
        try:
            object_id = UUID(str(raw_object_id))
        except (TypeError, ValueError) as exc:
            raise ValueError("Resolved object target is invalid") from exc

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
        asset.preview_tool_call_id = None
        asset.updated_at = datetime.utcnow()
        queue_object_change(
            db,
            project_id=tool_call.thread.project_id,
            object_type=object_type,
            object_id=object_id,
            action="updated",
        )
        return {
            "success": True,
            "message": "Applied generated image as main image",
            "objectId": str(object_id),
            "objectType": object_type,
            "data": {"asset_id": str(asset.id)},
        }

    if kind != "scene":
        raise ValueError("Unsupported image tool kind")
    if sidecar is None:
        raise ValueError("SIDECAR_ERROR: sidecar client unavailable")

    raw_manuscript_id = extra.get("manuscript_id")
    anchor = str(extra.get("insert_before") or "").strip()
    try:
        manuscript_id = UUID(str(raw_manuscript_id))
    except (TypeError, ValueError) as exc:
        raise ValueError("Resolved manuscript target is invalid") from exc

    markdown, original_doc, _obj = await _markdown_for_manuscript(
        db,
        project_id=tool_call.thread.project_id,
        manuscript_id=manuscript_id,
        language=language,
        sidecar=sidecar,
    )
    if markdown.count(anchor) != 1:
        raise ValueError("insert_before must still match exactly once before applying")

    image_src = f"/storage/assets/{asset.file_path}"
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
        project_id=tool_call.thread.project_id,
        object_type="manuscript",
        object_id=manuscript_id,
        data={"doc": next_doc, "wordCount": len(next_markdown.split())},
        language=language,
        user_request="tool:generate_scene_image",
        created_by=user_id,
        create_new_version=True,
    )
    asset.preview_tool_call_id = None
    asset.manuscript_id = manuscript_id
    asset.updated_at = datetime.utcnow()
    return {
        "success": True,
        "message": "Applied generated image to manuscript",
        "objectId": str(manuscript_id),
        "objectType": "manuscript",
        "data": {"asset_id": str(asset.id)},
    }


def reject_generated_preview(tool_call: RunToolCallModel) -> dict[str, Any]:
    _ = tool_call
    return {
        "success": False,
        "message": "Generated image rejected by user",
        "error": "Generated image rejected by user",
        "data": {"failure_code": "user_rejected_generated_image"},
    }


def cleanup_preview_assets(db: Session, *, tool_call_id: UUID, project_id: UUID) -> list[UUID]:
    assets = (
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.preview_tool_call_id == tool_call_id,
        )
        .all()
    )
    if not assets:
        return []
    return delete_assets_with_files(
        db,
        assets=assets,
        scrub_references_in_project_id=project_id,
    )
