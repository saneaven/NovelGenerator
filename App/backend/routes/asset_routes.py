"""Asset management routes"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any, cast
from collections import defaultdict
from uuid import UUID, uuid4
from datetime import datetime, timedelta

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import (
    User,
    Project,
    Asset,
    StoryObjectAsset,
    ManuscriptImage,
    Manuscript,
    Chapter,
    Act,
    Outline,
    BasicInfo,
    Character,
    Organization,
    Location,
    LorebookEntry,
)
from ..models.translation_models import ObjectVersion
from ..schemas.assets import (
    AssetResponse, AssetListResponse, AssetUpdateRequest,
    StoryObjectAssetResponse, StoryObjectAssetsResponse, SetMainAssetRequest,
    ManuscriptImageCreate, ManuscriptImageResponse, ManuscriptImagesResponse, ManuscriptImageUpdateRequest,
    ImageGenerationRequest, ImageGenerationResponse,
    ImageProvidersResponse, ImageProviderInfo, ImageModelsResponse,
    SceneAssetResponse, SceneAssetsResponse, ManuscriptInfo,
    ImageCleanupPolicy, ImageCleanupPreviewResponse, ImageCleanupPreviewItem,
    ImageCleanupExecuteRequest, ImageCleanupExecuteResponse, ImageCleanupExecuteSkipped, ImageCleanupExecuteError,
    RebuildManuscriptImagesResponse,
    StyledPrompt
)
from ..services.storage_service import storage_service
from ..services.deletion_service import delete_assets_with_files
from ..services.manuscript_image_index_service import rebuild_manuscript_images_for_language
from ..services.object_change_events import queue_object_change
from ..services.storage_quota_service import StorageQuotaExceededError, enforce_user_asset_quota
from ..services.credential_service import CredentialServiceError, credential_service
from ..services.notification_service import serialize_notification, upsert_notification
from ..services.ownership import require_owned_manuscript, require_owned_object
from ..services.runtime_event_dispatcher import runtime_event_dispatcher
from ..image_providers.registry import ImageProviderRegistry
from ..image_providers.base import ReferenceImageData
from ..utils.object_type_aliases import normalize_object_type

# Import providers to register them
from ..image_providers import openai_image, gemini_image, xai_image, novelai_image

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])


# Object types allowed for image ownership binding (asset generation -> StoryObjectAsset)
OBJECT_BINDING_MODELS = {
    "basic_info": BasicInfo,
    "character": Character,
    "organization": Organization,
    "location": Location,
    "lorebook": LorebookEntry,
}


def _collect_story_object_refs_for_asset_ids(
    db: Session,
    *,
    asset_ids: list[UUID],
) -> list[tuple[str, UUID]]:
    if not asset_ids:
        return []
    rows = (
        db.query(StoryObjectAsset.object_type, StoryObjectAsset.object_id)
        .filter(StoryObjectAsset.asset_id.in_(asset_ids))
        .all()
    )
    out: list[tuple[str, UUID]] = []
    for object_type, object_id in rows:
        if isinstance(object_type, str) and isinstance(object_id, UUID):
            out.append((object_type, object_id))
    return out


def _queue_story_object_updates(
    db: Session,
    *,
    project_id: UUID,
    refs: list[tuple[str, UUID]],
) -> None:
    for object_type, object_id in set(refs):
        queue_object_change(
            db,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            action="updated",
        )


def _jsonb_to_styled_prompt(data: Optional[Dict[str, Any]]) -> Optional[StyledPrompt]:
    """Convert JSONB dict to StyledPrompt object"""
    if data is None:
        return None
    return StyledPrompt(
        prefix=data.get('prefix', ''),
        content=data.get('content', ''),
        postfix=data.get('postfix', '')
    )


def _asset_to_response(asset: Asset) -> AssetResponse:
    """Convert Asset model to response schema"""
    # Cast all SQLAlchemy Column types to their Python types for type checker
    return AssetResponse(
        id=str(asset.id),
        project_id=str(asset.project_id),
        name=cast(str, asset.name),
        file_path=cast(str, asset.file_path),
        mime_type=cast(str, asset.mime_type),
        asset_type=cast(Optional[str], asset.asset_type),
        manuscript_id=str(asset.manuscript_id) if asset.manuscript_id is not None else None,
        generation_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_prompt)),
        generation_positive_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_positive_prompt)),
        generation_negative_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_negative_prompt)),
        generation_provider=cast(Optional[str], asset.generation_provider),
        generation_model=cast(Optional[str], asset.generation_model),
        generation_settings=cast(Optional[Dict[str, Any]], asset.generation_settings),
        generation_reference_images=cast(Optional[List[Dict[str, Any]]], asset.generation_reference_images),
        generation_reference_objects=cast(Optional[List[Dict[str, Any]]], asset.generation_reference_objects),
        width=cast(Optional[int], asset.width),
        height=cast(Optional[int], asset.height),
        file_size=cast(Optional[int], asset.file_size),
        created_at=cast(datetime, asset.created_at),
        updated_at=cast(datetime, asset.updated_at),
        file_url=f"/storage/assets/{cast(str, asset.file_path)}",
    )


def _asset_to_scene_response(asset: Asset, used_in_manuscripts: List[ManuscriptInfo]) -> SceneAssetResponse:
    """Convert Asset model to SceneAssetResponse with manuscript usage info"""
    return SceneAssetResponse(
        id=str(asset.id),
        project_id=str(asset.project_id),
        name=cast(str, asset.name),
        file_path=cast(str, asset.file_path),
        mime_type=cast(str, asset.mime_type),
        asset_type=cast(Optional[str], asset.asset_type),
        manuscript_id=str(asset.manuscript_id) if asset.manuscript_id is not None else None,
        generation_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_prompt)),
        generation_positive_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_positive_prompt)),
        generation_negative_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_negative_prompt)),
        generation_provider=cast(Optional[str], asset.generation_provider),
        generation_model=cast(Optional[str], asset.generation_model),
        width=cast(Optional[int], asset.width),
        height=cast(Optional[int], asset.height),
        file_size=cast(Optional[int], asset.file_size),
        created_at=cast(datetime, asset.created_at),
        updated_at=cast(datetime, asset.updated_at),
        file_url=f"/storage/assets/{cast(str, asset.file_path)}",
        used_in_manuscripts=used_in_manuscripts,
        usage_count=len(used_in_manuscripts)
    )


# ============================================================================
# IMAGE PROVIDERS
# ============================================================================

@router.get("/image-providers", response_model=ImageProvidersResponse)
async def list_image_providers():
    """List available image generation providers"""
    providers = ImageProviderRegistry.list_providers()
    return ImageProvidersResponse(
        providers=[
            ImageProviderInfo(
                name=p["name"],
                display_name=p["display_name"],
                prompt_type=p.get("prompt_type", "natural"),
                supported_sizes=p["supported_sizes"],
                supported_qualities=p["supported_qualities"],
                supported_styles=p["supported_styles"],
                settings_schema=p.get("settings_schema"),
                supports_image_input=p.get("supports_image_input", False)
            )
            for p in providers
        ]
    )


@router.post("/image-providers/{provider}/models", response_model=ImageModelsResponse)
async def get_image_models(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get available models for an image provider"""
    try:
        provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        provider_instance = ImageProviderRegistry.get_provider(provider, provider_config)
        if not provider_instance.validate_config():
            raise HTTPException(status_code=400, detail="Invalid API key")
        models = await provider_instance.get_models()
        return ImageModelsResponse(data=models.get("data", []))
    except CredentialServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================================
# IMAGE GENERATION
# ============================================================================

@router.post("/{project_id}/generate", response_model=ImageGenerationResponse)
async def generate_image(
    project_id: UUID,
    request: ImageGenerationRequest,
    manuscript_id: Optional[UUID] = Query(None),
    object_type: Optional[str] = Query(None),
    object_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Generate an image and save as asset"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate binding: require either manuscript_id (scene) OR (object_type + object_id) (object/cover)
    normalized_object_type = normalize_object_type(object_type) if object_type else None
    if manuscript_id and (normalized_object_type or object_id):
        raise HTTPException(status_code=400, detail="Provide either manuscript_id or object_type/object_id, not both")
    if (normalized_object_type and not object_id) or (object_id and not normalized_object_type):
        raise HTTPException(status_code=400, detail="Both object_type and object_id are required for object binding")
    if not manuscript_id and not (normalized_object_type and object_id):
        raise HTTPException(status_code=400, detail="Binding required: manuscript_id or object_type/object_id")

    implied_asset_type = "scene" if manuscript_id else "object"
    if request.asset_type and request.asset_type not in ("scene", "object"):
        raise HTTPException(status_code=400, detail="Invalid asset_type. Allowed: 'scene', 'object'")
    if request.asset_type and request.asset_type != implied_asset_type:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid asset_type for binding. Expected '{implied_asset_type}'.",
        )
    asset_type = request.asset_type or implied_asset_type

    # Verify binding target exists and belongs to project
    if manuscript_id:
        manuscript = (
            db.query(Manuscript)
            .join(Chapter, Manuscript.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .filter(Manuscript.id == manuscript_id, Outline.project_id == project_id)
            .first()
        )
        if not manuscript:
            raise HTTPException(status_code=404, detail="Manuscript not found")
    else:
        model_class = OBJECT_BINDING_MODELS.get(normalized_object_type)
        if not model_class:
            raise HTTPException(status_code=400, detail=f"Unsupported object_type: {normalized_object_type}")
        obj = db.query(model_class).filter(
            model_class.id == object_id,
            model_class.project_id == project_id
        ).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Object not found")

    notification_source_ref_id = str(request.notification_source_ref_id or "").strip()
    if not notification_source_ref_id:
        raise HTTPException(status_code=422, detail="notification_source_ref_id is required")

    notification_label = str(request.notification_label or "").strip() or "Image generation"
    incoming_notification_meta = (
        dict(request.notification_meta)
        if isinstance(request.notification_meta, dict)
        else {}
    )
    notification_id: Optional[str] = None

    def _build_image_notification_meta(*, asset_id: UUID | str | None = None) -> Dict[str, Any]:
        resolved_asset_id = str(asset_id) if asset_id is not None else None
        return {
            **incoming_notification_meta,
            "project_id": str(project_id),
            "binding_type": "scene" if manuscript_id else "object",
            "manuscript_id": str(manuscript_id) if manuscript_id else None,
            "object_type": normalized_object_type if normalized_object_type else None,
            "object_id": str(object_id) if object_id else None,
            "asset_id": resolved_asset_id,
        }

    async def _emit_notification_upsert(
        *,
        status: str,
        message: str,
        warning: Optional[str] = None,
        progress: Optional[Dict[str, Any]] = None,
        custom_slot: Optional[Dict[str, Any]] = None,
        asset_id: UUID | str | None = None,
    ) -> None:
        nonlocal notification_id
        row = upsert_notification(
            db,
            user_id=current_user.id,
            project_id=project_id,
            source="imageTask",
            source_ref_id=notification_source_ref_id,
            status=status,
            label=notification_label,
            message=message,
            warning=warning,
            progress=progress,
            custom_slot=custom_slot or {"type": "none"},
            meta=_build_image_notification_meta(asset_id=asset_id),
        )
        db.commit()
        db.refresh(row)
        notification_id = str(row.id)
        await runtime_event_dispatcher.emit_project_event(
            project_id=project_id,
            event_name="notification:upsert",
            data=serialize_notification(row),
        )

    try:
        await _emit_notification_upsert(
            status="running",
            message="Preparing...",
            progress={"current": 1, "total": 4, "stage": "preparing", "percentage": 25},
        )

        # Get provider instance
        provider_cfg = credential_service.get_provider_config(db, current_user.id, request.provider)
        provider = ImageProviderRegistry.get_provider(request.provider, provider_cfg)

        if not provider.validate_config():
            await _emit_notification_upsert(
                status="error",
                message="Invalid provider configuration",
                warning="Invalid provider configuration",
            )
            return ImageGenerationResponse(
                success=False,
                error="Invalid provider configuration",
                notification_id=notification_id,
            )

        # Load reference images if provided and provider supports image input
        reference_image_data: Optional[List[ReferenceImageData]] = None
        if request.reference_images and provider.supports_image_input():
            reference_image_data = []
            for ref_img in request.reference_images:
                # Load image from storage using asset_id
                ref_asset = db.query(Asset).filter(
                    Asset.id == UUID(ref_img.asset_id),
                    Asset.project_id == project_id
                ).first()
                if ref_asset:
                    try:
                        image_bytes = storage_service.read_asset_file(str(ref_asset.file_path))
                        # Store originals as AVIF, but providers typically accept PNG/JPEG/WebP for reference inputs.
                        image_bytes = storage_service.to_png_bytes(image_bytes)
                        reference_image_data.append(ReferenceImageData(
                            image_data=image_bytes,
                            strength=ref_img.strength
                        ))
                    except FileNotFoundError:
                        # Skip missing files
                        pass
                    except Exception as e:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Failed to decode reference image asset {ref_img.asset_id}: {str(e)}"
                        )

        # Construct final prompt strings from StyledPrompt objects
        final_prompt: Optional[str] = None
        final_positive_prompt: Optional[str] = None
        final_negative_prompt: Optional[str] = None

        if request.prompt:
            final_prompt = f"{request.prompt.prefix}{request.prompt.content}{request.prompt.postfix}"
        if request.positive_prompt:
            final_positive_prompt = f"{request.positive_prompt.prefix}{request.positive_prompt.content}{request.positive_prompt.postfix}"
        if request.negative_prompt:
            final_negative_prompt = f"{request.negative_prompt.prefix}{request.negative_prompt.content}{request.negative_prompt.postfix}"

        # Provider-specific knobs are passed via provider_settings (single source of truth)
        provider_settings: Dict[str, Any] = request.provider_settings or {}
        quality = provider_settings.get("quality") or "standard"
        style = provider_settings.get("style") or "natural"

        await _emit_notification_upsert(
            status="running",
            message="Generating...",
            progress={"current": 2, "total": 4, "stage": "generating", "percentage": 50},
        )

        # Generate image
        result = await provider.generate_image(
            prompt=final_prompt,
            model=request.model,
            size=request.size,
            quality=quality,
            style=style,
            positive_prompt=final_positive_prompt,
            negative_prompt=final_negative_prompt,
            provider_settings=provider_settings or None,
            reference_images=reference_image_data,
        )

        if not result.success:
            failure_message = result.error or "Image generation failed"
            await _emit_notification_upsert(
                status="error",
                message=failure_message,
                warning=failure_message,
            )
            return ImageGenerationResponse(
                success=False,
                error=result.error,
                notification_id=notification_id,
            )

        await _emit_notification_upsert(
            status="running",
            message="Saving...",
            progress={"current": 3, "total": 4, "stage": "saving", "percentage": 75},
        )

        # Save to storage
        if result.image_b64:
            file_path, mime_type, width, height, file_size = storage_service.save_generated_image(
                base64_data=result.image_b64,
                project_id=project_id,
                format=result.format
            )
        elif result.image_data:
            file_path, mime_type, width, height, file_size = storage_service.save_generated_image_from_url(
                image_bytes=result.image_data,
                project_id=project_id,
                format=result.format
            )
        else:
            await _emit_notification_upsert(
                status="error",
                message="No image data returned from provider",
                warning="No image data returned from provider",
            )
            return ImageGenerationResponse(
                success=False,
                error="No image data returned from provider",
                notification_id=notification_id,
            )

        # Prepare reference images metadata for persistence (regen restoration)
        reference_images_meta = None
        if request.reference_images:
            reference_images_meta = [
                {"asset_id": ref.asset_id, "strength": ref.strength}
                for ref in request.reference_images
            ]

        # Create asset record (and bind atomically if object binding)
        # Store prompts separately based on provider type:
        # - Natural language (OpenAI, Gemini, xAI): generation_prompt only
        # - Tag-based (NovelAI): generation_positive_prompt + generation_negative_prompt only
        # Convert reference_objects to list of dicts for JSONB storage
        ref_objects_data = None
        if request.reference_objects:
            ref_objects_data = [
                {"id": obj.id, "type": obj.type, "name": obj.name}
                for obj in request.reference_objects
            ]

        await _emit_notification_upsert(
            status="running",
            message="Binding...",
            progress={"current": 4, "total": 4, "stage": "binding", "percentage": 90},
        )

        # Enforce user storage quota after we know actual sizes.
        try:
            enforce_user_asset_quota(
                db,
                user_id=current_user.id,
                additional_bytes=int(file_size or 0),
            )
        except StorageQuotaExceededError:
            storage_service.delete_asset_files(file_path)
            raise HTTPException(status_code=413, detail="Storage quota exceeded")

        asset = Asset(
            id=uuid4(),
            project_id=project_id,
            manuscript_id=manuscript_id,  # Ownership for scene assets
            name=f"Generated Image {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
            file_path=file_path,
            mime_type=mime_type,
            asset_type=asset_type,
            # Store StyledPrompt as JSONB dicts
            generation_prompt=request.prompt.model_dump() if request.prompt else None,
            generation_positive_prompt=request.positive_prompt.model_dump() if request.positive_prompt else None,
            generation_negative_prompt=request.negative_prompt.model_dump() if request.negative_prompt else None,
            generation_provider=request.provider,
            generation_model=request.model,
            generation_settings=provider_settings or None,
            generation_reference_images=reference_images_meta,
            generation_reference_objects=ref_objects_data,  # Story objects used during generation
            width=width or result.width,
            height=height or result.height,
            file_size=file_size,
        )
        db.add(asset)

        link = None
        if normalized_object_type and object_id:
            max_order = db.query(StoryObjectAsset).filter(
                StoryObjectAsset.object_type == normalized_object_type,
                StoryObjectAsset.object_id == object_id
            ).count()
            link = StoryObjectAsset(
                id=uuid4(),
                object_type=normalized_object_type,
                object_id=object_id,
                asset_id=asset.id,
                is_main=False,  # user-driven only
                display_order=max_order
            )
            db.add(link)
            queue_object_change(
                db,
                project_id=project_id,
                object_type=normalized_object_type,
                object_id=object_id,
                action="updated",
            )

        try:
            db.commit()
        except Exception:
            db.rollback()
            # Prevent orphan files if DB commit fails
            storage_service.delete_asset_files(file_path)
            raise

        db.refresh(asset)
        if link is not None:
            db.refresh(link)

        object_link = None
        if link is not None:
            object_link = StoryObjectAssetResponse(
                id=str(link.id),
                object_type=link.object_type,
                object_id=str(link.object_id),
                asset_id=str(link.asset_id),
                is_main=link.is_main,
                display_order=link.display_order,
                created_at=cast(datetime, link.created_at),
                asset=_asset_to_response(asset)
            )

        file_url = f"/storage/assets/{file_path}"
        await _emit_notification_upsert(
            status="success",
            message="Completed",
            progress={"current": 4, "total": 4, "stage": "completed", "percentage": 100},
            custom_slot={
                "type": "image",
                "url": file_url,
                "alt": asset.name,
            },
            asset_id=asset.id,
        )

        return ImageGenerationResponse(
            success=True,
            asset_id=str(asset.id),
            file_path=file_url,
            notification_id=notification_id,
            revised_prompt=result.revised_prompt,
            object_link=object_link
        )

    except HTTPException as exc:
        detail_text = exc.detail if isinstance(exc.detail, str) else "Image generation request failed"
        if notification_source_ref_id:
            try:
                await _emit_notification_upsert(
                    status="error",
                    message=detail_text,
                    warning=detail_text,
                )
            except Exception:
                db.rollback()
        raise
    except CredentialServiceError as e:
        if notification_source_ref_id:
            try:
                await _emit_notification_upsert(
                    status="error",
                    message=str(e),
                    warning=str(e),
                )
            except Exception:
                db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        if notification_source_ref_id:
            try:
                await _emit_notification_upsert(
                    status="error",
                    message=str(e),
                    warning=str(e),
                )
            except Exception:
                db.rollback()
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        if notification_source_ref_id:
            try:
                await _emit_notification_upsert(
                    status="error",
                    message=str(e),
                    warning=str(e),
                )
            except Exception:
                db.rollback()
        return ImageGenerationResponse(
            success=False,
            notification_id=notification_id,
            error=str(e)
        )


# ============================================================================
# SCENE ASSETS (must be before generic /{asset_id} routes)
# ============================================================================

@router.get("/{project_id}/scene", response_model=SceneAssetsResponse)
async def list_scene_assets(
    project_id: UUID,
    manuscript_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List scene assets with manuscript usage information. Optionally filter by manuscript ownership."""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get scene assets (optionally filtered by manuscript ownership)
    query = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.asset_type == 'scene'
    )
    if manuscript_id:
        query = query.filter(Asset.manuscript_id == manuscript_id)
    assets = query.order_by(Asset.created_at.desc()).all()

    # Precompute manuscript usage via manuscript_images (distinct per manuscript)
    usage_by_asset: Dict[UUID, set[UUID]] = defaultdict(set)
    asset_ids: List[UUID] = [a.id for a in assets]
    if asset_ids:
        pairs = (
            db.query(ManuscriptImage.asset_id, ManuscriptImage.manuscript_id)
            .filter(ManuscriptImage.asset_id.in_(asset_ids))
            .distinct()
            .all()
        )
        for asset_id_val, manuscript_id_val in pairs:
            if asset_id_val and manuscript_id_val:
                usage_by_asset[asset_id_val].add(manuscript_id_val)

    manuscript_ids: set[UUID] = set()
    for mids in usage_by_asset.values():
        manuscript_ids.update(mids)

    manuscript_meta: Dict[UUID, tuple[int, int]] = {}
    manuscript_info_by_id: Dict[UUID, ManuscriptInfo] = {}
    if manuscript_ids:
        meta_rows = (
            db.query(Manuscript.id, Chapter.order, Act.order)
            .join(Chapter, Manuscript.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .filter(Manuscript.id.in_(list(manuscript_ids)))
            .all()
        )
        for m_id, chapter_order, act_order in meta_rows:
            act_num = int(act_order) if act_order is not None else 0
            chapter_num = int(chapter_order) if chapter_order is not None else 0
            manuscript_meta[m_id] = (act_num, chapter_num)
            manuscript_info_by_id[m_id] = ManuscriptInfo(
                id=str(m_id),
                name=f"Chapter {chapter_num + 1}",
                act_name=f"Act {act_num + 1}" if act_order is not None else None,
            )

    # Build response with manuscript usage
    responses = []
    for asset in assets:
        used_ids = usage_by_asset.get(asset.id, set())
        used_in_manuscripts = [
            manuscript_info_by_id[m_id]
            for m_id in sorted(
                used_ids,
                key=lambda mid: manuscript_meta.get(mid, (10_000, 10_000)),
            )
            if m_id in manuscript_info_by_id
        ]
        responses.append(_asset_to_scene_response(asset, used_in_manuscripts))

    return SceneAssetsResponse(assets=responses, total=len(responses))


# ============================================================================
# ASSET CRUD
# ============================================================================

@router.get("/{project_id}", response_model=AssetListResponse)
async def list_assets(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all assets for a project"""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    assets = db.query(Asset).filter(Asset.project_id == project_id).order_by(Asset.created_at.desc()).all()

    return AssetListResponse(
        assets=[_asset_to_response(a) for a in assets],
        total=len(assets)
    )


@router.post("/{project_id}/upload", response_model=AssetResponse)
async def upload_asset(
    project_id: UUID,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    asset_type: Optional[str] = Form(None),  # 'scene', 'object', or None
    manuscript_id: Optional[UUID] = Query(None),
    object_type: Optional[str] = Query(None),
    object_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload an image asset"""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: PNG, JPEG, GIF, WebP, AVIF")

    # Validate binding: require either manuscript_id (scene) OR (object_type + object_id) (object/cover)
    normalized_object_type = normalize_object_type(object_type) if object_type else None
    if manuscript_id and (normalized_object_type or object_id):
        raise HTTPException(status_code=400, detail="Provide either manuscript_id or object_type/object_id, not both")
    if (normalized_object_type and not object_id) or (object_id and not normalized_object_type):
        raise HTTPException(status_code=400, detail="Both object_type and object_id are required for object binding")
    if not manuscript_id and not (normalized_object_type and object_id):
        raise HTTPException(status_code=400, detail="Binding required: manuscript_id or object_type/object_id")

    implied_asset_type = "scene" if manuscript_id else "object"
    if asset_type and asset_type not in ("scene", "object"):
        raise HTTPException(status_code=400, detail="Invalid asset_type. Allowed: 'scene', 'object'")
    if asset_type and asset_type != implied_asset_type:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid asset_type for binding. Expected '{implied_asset_type}'.",
        )
    asset_type = asset_type or implied_asset_type

    # Verify binding target exists and belongs to project
    if manuscript_id:
        manuscript = (
            db.query(Manuscript)
            .join(Chapter, Manuscript.chapter_id == Chapter.id)
            .join(Act, Chapter.act_id == Act.id)
            .join(Outline, Act.outline_id == Outline.id)
            .filter(Manuscript.id == manuscript_id, Outline.project_id == project_id)
            .first()
        )
        if not manuscript:
            raise HTTPException(status_code=404, detail="Manuscript not found")
    else:
        model_class = OBJECT_BINDING_MODELS.get(cast(str, normalized_object_type))
        if not model_class:
            raise HTTPException(status_code=400, detail=f"Unsupported object_type: {normalized_object_type}")
        obj = db.query(model_class).filter(
            model_class.id == object_id,
            model_class.project_id == project_id
        ).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Object not found")

    # Read file content
    content = await file.read()

    # Save to storage
    file_path, mime_type, width, height, file_size = storage_service.save_uploaded_file(
        file_content=content,
        original_filename=file.filename or "upload.png",
        project_id=project_id
    )

    try:
        # Enforce user storage quota after we know actual sizes.
        try:
            enforce_user_asset_quota(
                db,
                user_id=current_user.id,
                additional_bytes=int(file_size or 0),
            )
        except StorageQuotaExceededError:
            raise HTTPException(status_code=413, detail="Storage quota exceeded")

        # Create asset record
        asset = Asset(
            id=uuid4(),
            project_id=project_id,
            manuscript_id=manuscript_id,
            name=name or file.filename or "Uploaded Image",
            file_path=file_path,
            mime_type=mime_type,
            asset_type=asset_type,
            width=width,
            height=height,
            file_size=file_size,
        )
        db.add(asset)

        # If object binding, auto-link to story object
        if normalized_object_type and object_id:
            max_order = db.query(StoryObjectAsset).filter(
                StoryObjectAsset.object_type == normalized_object_type,
                StoryObjectAsset.object_id == object_id
            ).count()
            link = StoryObjectAsset(
                id=uuid4(),
                object_type=normalized_object_type,
                object_id=object_id,
                asset_id=asset.id,
                is_main=False,  # user-driven only
                display_order=max_order
            )
            db.add(link)
            queue_object_change(
                db,
                project_id=project_id,
                object_type=normalized_object_type,
                object_id=object_id,
                action="updated",
            )

        db.commit()
        db.refresh(asset)
    except Exception:
        db.rollback()
        # Prevent orphan files if DB commit fails
        storage_service.delete_asset_files(file_path)
        raise

    return _asset_to_response(asset)


@router.get("/{project_id}/{asset_id}", response_model=AssetResponse)
async def get_asset(
    project_id: UUID,
    asset_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get a specific asset"""
    asset = db.query(Asset).join(Project).filter(
        Asset.id == asset_id,
        Asset.project_id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    return _asset_to_response(asset)


@router.patch("/{project_id}/{asset_id}", response_model=AssetResponse)
async def update_asset(
    project_id: UUID,
    asset_id: UUID,
    request: AssetUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update asset metadata"""
    asset = db.query(Asset).join(Project).filter(
        Asset.id == asset_id,
        Asset.project_id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    if request.name is not None:
        asset.name = request.name

    asset.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(asset)

    return _asset_to_response(asset)


@router.delete("/{project_id}/{asset_id}")
async def delete_asset(
    project_id: UUID,
    asset_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete an asset"""
    asset = db.query(Asset).join(Project).filter(
        Asset.id == asset_id,
        Asset.project_id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    affected_refs = _collect_story_object_refs_for_asset_ids(db, asset_ids=[asset_id])

    # Delete from storage + DB, and scrub stale generation_reference_images pointers.
    delete_assets_with_files(db, assets=[asset], scrub_references_in_project_id=project_id)
    _queue_story_object_updates(db, project_id=project_id, refs=affected_refs)
    db.commit()

    return {"success": True}


# ============================================================================
# IMAGE CLEANUP
# ============================================================================

def _build_reference_reverse_index(assets: List[Asset]) -> Dict[UUID, set[UUID]]:
    """Build reverse index: target_asset_id -> set(of assets that reference it)."""
    referenced_by: Dict[UUID, set[UUID]] = defaultdict(set)
    for src in assets:
        refs = cast(Optional[List[Dict[str, Any]]], src.generation_reference_images)
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            target_id_raw = ref.get("asset_id")
            if not target_id_raw:
                continue
            try:
                target_id = UUID(str(target_id_raw))
            except Exception:
                continue
            referenced_by[target_id].add(src.id)
    return referenced_by


def _candidate_reasons_for_asset(
    asset: Asset,
    policy: ImageCleanupPolicy,
    used_in_manuscripts: set[UUID],
    story_non_main_assets: set[UUID],
) -> List[str]:
    if asset.id in used_in_manuscripts:
        return []

    reasons: List[str] = []

    if policy.delete_non_main_story_object_images and asset.asset_type == "object" and asset.id in story_non_main_assets:
        reasons.append("story_object_non_main")

    if (
        policy.delete_unused_manuscript_images
        and asset.asset_type == "scene"
    ):
        reasons.append("unused_in_manuscripts")

    # De-dupe while keeping order
    out: List[str] = []
    seen: set[str] = set()
    for r in reasons:
        if r in seen:
            continue
        out.append(r)
        seen.add(r)
    return out


@router.post("/{project_id}/cleanup/preview", response_model=ImageCleanupPreviewResponse)
async def preview_image_cleanup(
    project_id: UUID,
    policy: ImageCleanupPolicy,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview which assets would be deleted under the given cleanup policy."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Clamp keep_recent_days to non-negative
    keep_recent_days = max(int(policy.keep_recent_days or 0), 0)
    cutoff = datetime.utcnow() - timedelta(days=keep_recent_days) if keep_recent_days > 0 else None

    assets = db.query(Asset).filter(Asset.project_id == project_id).order_by(Asset.created_at.desc()).all()

    used_in_manuscripts_rows = (
        db.query(ManuscriptImage.asset_id)
        .join(Asset, Asset.id == ManuscriptImage.asset_id)
        .filter(
            Asset.project_id == project_id,
            ManuscriptImage.asset_id.isnot(None),
        )
        .distinct()
        .all()
    )
    used_in_manuscripts: set[UUID] = {row[0] for row in used_in_manuscripts_rows if row[0]}

    story_non_main_rows = (
        db.query(StoryObjectAsset.asset_id)
        .join(Asset, Asset.id == StoryObjectAsset.asset_id)
        .filter(
            Asset.project_id == project_id,
            StoryObjectAsset.is_main == False,
        )
        .all()
    )
    story_non_main_assets: set[UUID] = {row[0] for row in story_non_main_rows if row[0]}

    referenced_by = _build_reference_reverse_index(assets)

    candidates: List[ImageCleanupPreviewItem] = []
    total_size = 0
    for asset in assets:
        reasons = _candidate_reasons_for_asset(
            asset=asset,
            policy=policy,
            used_in_manuscripts=used_in_manuscripts,
            story_non_main_assets=story_non_main_assets,
        )
        if not reasons:
            continue

        if cutoff and asset.created_at and asset.created_at >= cutoff:
            continue

        referenced_by_count = len(referenced_by.get(asset.id, set()))
        if policy.treat_reference_images_as_used and referenced_by_count > 0:
            continue

        candidates.append(
            ImageCleanupPreviewItem(
                asset_id=str(asset.id),
                name=cast(str, asset.name),
                asset_type=cast(Optional[str], asset.asset_type),
                manuscript_id=str(asset.manuscript_id) if asset.manuscript_id else None,
                created_at=cast(datetime, asset.created_at),
                file_size=cast(Optional[int], asset.file_size),
                file_url=f"/storage/assets/{cast(str, asset.file_path)}",
                reasons=reasons,
                referenced_by_count=referenced_by_count,
            )
        )
        total_size += int(asset.file_size or 0)

    return ImageCleanupPreviewResponse(
        candidates=candidates,
        total_candidates=len(candidates),
        total_size_bytes=total_size,
    )


@router.post("/{project_id}/cleanup/execute", response_model=ImageCleanupExecuteResponse)
async def execute_image_cleanup(
    project_id: UUID,
    request: ImageCleanupExecuteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete selected assets under the given policy (re-validates eligibility)."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    policy = request.policy
    keep_recent_days = max(int(policy.keep_recent_days or 0), 0)
    cutoff = datetime.utcnow() - timedelta(days=keep_recent_days) if keep_recent_days > 0 else None

    valid_ids: List[UUID] = []
    errors: List[ImageCleanupExecuteError] = []
    for raw_id in request.asset_ids:
        try:
            valid_ids.append(UUID(raw_id))
        except Exception:
            errors.append(ImageCleanupExecuteError(asset_id=str(raw_id), error="Invalid UUID"))

    if not valid_ids:
        return ImageCleanupExecuteResponse(deleted=[], skipped=[], errors=errors, scrubbed_reference_entries=0)

    assets_by_id = {
        a.id: a
        for a in db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.id.in_(valid_ids))
        .all()
    }

    skipped: List[ImageCleanupExecuteSkipped] = []
    for a_id in valid_ids:
        if a_id not in assets_by_id:
            skipped.append(ImageCleanupExecuteSkipped(asset_id=str(a_id), reason="Asset not found"))

    # Usage sets (project-wide)
    used_in_manuscripts_rows = (
        db.query(ManuscriptImage.asset_id)
        .join(Asset, Asset.id == ManuscriptImage.asset_id)
        .filter(Asset.project_id == project_id, ManuscriptImage.asset_id.isnot(None))
        .distinct()
        .all()
    )
    used_in_manuscripts: set[UUID] = {row[0] for row in used_in_manuscripts_rows if row[0]}

    story_non_main_rows = (
        db.query(StoryObjectAsset.asset_id)
        .join(Asset, Asset.id == StoryObjectAsset.asset_id)
        .filter(
            Asset.project_id == project_id,
            StoryObjectAsset.is_main == False,
        )
        .all()
    )
    story_non_main_assets: set[UUID] = {row[0] for row in story_non_main_rows if row[0]}

    # Reference index (project-wide) for eligibility checks
    all_assets = db.query(Asset).filter(Asset.project_id == project_id).all()
    referenced_by = _build_reference_reverse_index(all_assets)

    eligible: List[Asset] = []
    for asset in assets_by_id.values():
        reasons = _candidate_reasons_for_asset(
            asset=asset,
            policy=policy,
            used_in_manuscripts=used_in_manuscripts,
            story_non_main_assets=story_non_main_assets,
        )
        if not reasons:
            skipped.append(ImageCleanupExecuteSkipped(asset_id=str(asset.id), reason="Not eligible by policy"))
            continue

        if cutoff and asset.created_at and asset.created_at >= cutoff:
            skipped.append(ImageCleanupExecuteSkipped(asset_id=str(asset.id), reason="Keep recent"))
            continue

        eligible.append(asset)

    delete_ids: set[UUID] = {a.id for a in eligible}
    if policy.treat_reference_images_as_used and delete_ids:
        # Iteratively remove assets referenced by any remaining assets.
        while True:
            blocked = {
                a_id
                for a_id in delete_ids
                if len(referenced_by.get(a_id, set()) - delete_ids) > 0
            }
            if not blocked:
                break
            delete_ids.difference_update(blocked)

        for asset in eligible:
            if asset.id in delete_ids:
                continue
            blocking_count = len(referenced_by.get(asset.id, set()) - delete_ids)
            skipped.append(
                ImageCleanupExecuteSkipped(
                    asset_id=str(asset.id),
                    reason=f"Referenced by generation_reference_images ({blocking_count})",
                )
            )

    to_delete: List[Asset] = [assets_by_id[a_id] for a_id in delete_ids]
    affected_story_object_refs = _collect_story_object_refs_for_asset_ids(
        db,
        asset_ids=[asset.id for asset in to_delete],
    )

    scrubbed_entries = 0
    deleted: List[str] = []

    # Scrub deleted IDs from other assets' generation_reference_images when allowed.
    if to_delete and not policy.treat_reference_images_as_used:
        delete_id_strings = {str(a.id) for a in to_delete}
        assets_with_refs = (
            db.query(Asset)
            .filter(Asset.project_id == project_id, Asset.generation_reference_images.isnot(None))
            .all()
        )
        for src in assets_with_refs:
            refs = cast(Optional[List[Dict[str, Any]]], src.generation_reference_images)
            if not isinstance(refs, list):
                continue
            new_refs: List[Dict[str, Any]] = []
            changed = False
            for ref in refs:
                if isinstance(ref, dict) and str(ref.get("asset_id")) in delete_id_strings:
                    scrubbed_entries += 1
                    changed = True
                    continue
                if isinstance(ref, dict):
                    new_refs.append(ref)
                else:
                    # Preserve unknown entries
                    new_refs.append(cast(Dict[str, Any], ref))
            if changed:
                src.generation_reference_images = new_refs
                src.updated_at = datetime.utcnow()

    # Delete DB rows first (files are best-effort after commit)
    file_deletions: List[str] = []
    for asset in to_delete:
        file_deletions.append(cast(str, asset.file_path))
        db.delete(asset)
        deleted.append(str(asset.id))

    _queue_story_object_updates(db, project_id=project_id, refs=affected_story_object_refs)
    db.commit()

    for file_path in file_deletions:
        storage_service.delete_asset_files(file_path)

    return ImageCleanupExecuteResponse(
        deleted=deleted,
        skipped=skipped,
        errors=errors,
        scrubbed_reference_entries=scrubbed_entries,
    )


@router.post("/{project_id}/cleanup/rebuild-manuscript-images", response_model=RebuildManuscriptImagesResponse)
async def rebuild_manuscript_images_index(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rebuild manuscript_images for all manuscripts/languages in a project from saved doc(JSON)."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    manuscripts = (
        db.query(Manuscript)
        .join(Chapter, Manuscript.chapter_id == Chapter.id)
        .join(Act, Chapter.act_id == Act.id)
        .join(Outline, Act.outline_id == Outline.id)
        .filter(Outline.project_id == project_id)
        .all()
    )

    manuscripts_processed = 0
    languages_processed = 0
    images_deleted = 0
    images_inserted = 0
    unresolved_refs = 0

    for manuscript in manuscripts:
        manuscripts_processed += 1
        latest_version = db.query(ObjectVersion).filter(
            ObjectVersion.object_type == "manuscript",
            ObjectVersion.object_id == manuscript.id,
        ).order_by(ObjectVersion.version_number.desc()).first()

        version_data = latest_version.data if latest_version else {}
        if not isinstance(version_data, dict):
            continue

        for lang, lang_data in version_data.items():
            if not isinstance(lang_data, dict):
                continue
            doc = lang_data.get("doc")
            if not isinstance(doc, dict):
                continue

            stats = rebuild_manuscript_images_for_language(
                db=db,
                project_id=project_id,
                manuscript_id=cast(UUID, manuscript.id),
                language=cast(str, lang),
                doc=doc,
            )
            languages_processed += 1
            images_deleted += int(stats.get("deleted", 0))
            images_inserted += int(stats.get("inserted", 0))
            unresolved_refs += int(stats.get("unresolved", 0))

    db.commit()

    return RebuildManuscriptImagesResponse(
        manuscripts_processed=manuscripts_processed,
        languages_processed=languages_processed,
        images_deleted=images_deleted,
        images_inserted=images_inserted,
        unresolved_refs=unresolved_refs,
    )


# ============================================================================
# STORY OBJECT ASSETS
# ============================================================================

@router.get("/{project_id}/object/{object_type}/{object_id}", response_model=StoryObjectAssetsResponse)
async def get_story_object_assets(
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all assets linked to a story object"""
    object_type = normalize_object_type(object_type)
    require_owned_object(
        db,
        user_id=current_user.id,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
    )

    rows = (
        db.query(StoryObjectAsset, Asset)
        .join(Asset, Asset.id == StoryObjectAsset.asset_id)
        .filter(
            StoryObjectAsset.object_type == object_type,
            StoryObjectAsset.object_id == object_id,
            Asset.project_id == project_id,
        )
        .order_by(StoryObjectAsset.display_order)
        .all()
    )

    responses = []
    main_asset = None

    for link, asset in rows:
        response = StoryObjectAssetResponse(
            id=str(link.id),
            object_type=link.object_type,
            object_id=str(link.object_id),
            asset_id=str(link.asset_id),
            is_main=link.is_main,
            display_order=link.display_order,
            created_at=link.created_at,
            asset=_asset_to_response(asset)
        )
        responses.append(response)
        if link.is_main:
            main_asset = response

    return StoryObjectAssetsResponse(assets=responses, main_asset=main_asset)


@router.patch("/{project_id}/object/{object_type}/{object_id}/main", response_model=StoryObjectAssetResponse)
async def set_main_asset(
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    request: SetMainAssetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set the main asset for a story object"""
    object_type = normalize_object_type(object_type)
    require_owned_object(
        db,
        user_id=current_user.id,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
    )

    # Find the link to set as main
    asset_id = UUID(request.asset_id)
    link = (
        db.query(StoryObjectAsset)
        .join(Asset, Asset.id == StoryObjectAsset.asset_id)
        .filter(
            StoryObjectAsset.object_type == object_type,
            StoryObjectAsset.object_id == object_id,
            StoryObjectAsset.asset_id == asset_id,
            Asset.project_id == project_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Asset not linked to this object")

    # Unset all mains and set the new one
    db.query(StoryObjectAsset).filter(
        StoryObjectAsset.object_type == object_type,
        StoryObjectAsset.object_id == object_id
    ).update({"is_main": False})

    link.is_main = True
    queue_object_change(
        db,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        action="updated",
    )
    db.commit()
    db.refresh(link)

    asset = db.query(Asset).filter(Asset.id == link.asset_id, Asset.project_id == project_id).first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not linked to this object")

    return StoryObjectAssetResponse(
        id=str(link.id),
        object_type=link.object_type,
        object_id=str(link.object_id),
        asset_id=str(link.asset_id),
        is_main=link.is_main,
        display_order=link.display_order,
        created_at=link.created_at,
        asset=_asset_to_response(asset)
    )


# ============================================================================
# MANUSCRIPT IMAGES
# ============================================================================

@router.get("/{project_id}/manuscript/{manuscript_id}/images", response_model=ManuscriptImagesResponse)
async def get_manuscript_images(
    project_id: UUID,
    manuscript_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all images in a manuscript"""
    require_owned_manuscript(
        db,
        user_id=current_user.id,
        manuscript_id=manuscript_id,
        project_id=project_id,
    )

    images = db.query(ManuscriptImage).filter(
        ManuscriptImage.manuscript_id == manuscript_id
    ).order_by(ManuscriptImage.position).all()

    asset_ids = [img.asset_id for img in images if img.asset_id is not None]
    assets_by_id: dict[UUID, Asset] = {}
    if asset_ids:
        assets = (
            db.query(Asset)
            .filter(Asset.project_id == project_id, Asset.id.in_(asset_ids))
            .all()
        )
        assets_by_id = {asset.id: asset for asset in assets}

    responses = []
    for img in images:
        asset = None
        if img.asset_id:
            asset_model = assets_by_id.get(img.asset_id)
            if asset_model:
                asset = _asset_to_response(asset_model)

        responses.append(ManuscriptImageResponse(
            id=str(img.id),
            manuscript_id=str(img.manuscript_id),
            language=cast(Optional[str], img.language),
            position=img.position,
            source_type=img.source_type,
            asset_id=str(img.asset_id) if img.asset_id else None,
            story_object_type=img.story_object_type,
            story_object_id=str(img.story_object_id) if img.story_object_id else None,
            generation_prompt=img.generation_prompt,
            display_width=img.display_width,
            caption=img.caption,
            created_at=img.created_at,
            updated_at=img.updated_at,
            asset=asset
        ))

    return ManuscriptImagesResponse(images=responses)


@router.post("/{project_id}/manuscript/{manuscript_id}/images", response_model=ManuscriptImageResponse)
async def add_manuscript_image(
    project_id: UUID,
    manuscript_id: UUID,
    request: ManuscriptImageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add an image to a manuscript (deprecated).

    The manuscript_images table is a derived index rebuilt from TipTap doc JSON
    on manuscript save. Manually editing it creates drift and stale references.
    """
    raise HTTPException(
        status_code=410,
        detail="manuscript_images is a derived index. Edit the manuscript doc and save to rebuild.",
    )


@router.patch("/{project_id}/manuscript/{manuscript_id}/images/{image_id}", response_model=ManuscriptImageResponse)
async def update_manuscript_image(
    project_id: UUID,
    manuscript_id: UUID,
    image_id: UUID,
    request: ManuscriptImageUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a manuscript image (deprecated).

    manuscript_images is rebuilt from manuscript doc JSON; manual edits are disallowed.
    """
    raise HTTPException(
        status_code=410,
        detail="manuscript_images is a derived index. Edit the manuscript doc and save to rebuild.",
    )


@router.delete("/{project_id}/manuscript/{manuscript_id}/images/{image_id}")
async def delete_manuscript_image(
    project_id: UUID,
    manuscript_id: UUID,
    image_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a manuscript image (deprecated).

    manuscript_images is rebuilt from manuscript doc JSON; manual edits are disallowed.
    """
    raise HTTPException(
        status_code=410,
        detail="manuscript_images is a derived index. Edit the manuscript doc and save to rebuild.",
    )
