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
    ObjectAssetLink,
    RichTextImageRef,
    Manuscript,
    Outline,
    BasicInfo,
    StoryEntity,
    Guidelines,
)
from ..models.translation_models import ObjectVersion, ObjectVersionLanguage
from ..schemas.assets import (
    AssetResponse, AssetListResponse, AssetUpdateRequest,
    ObjectAssetLinkResponse, ObjectAssetLinksResponse, SetMainAssetRequest,
    ImageProvidersResponse, ImageProviderInfo, ImageModelsResponse, ImageModelInfo,
    SceneAssetResponse, SceneAssetsResponse, AssetUsage,
    ImageCleanupPolicy, ImageCleanupPreviewResponse, ImageCleanupPreviewItem,
    ImageCleanupExecuteRequest, ImageCleanupExecuteResponse, ImageCleanupExecuteSkipped, ImageCleanupExecuteError,
    RebuildRichTextImageRefsResponse,
    StyledPrompt
)
from ..services.asset_change_events import (
    queue_project_assets_change,
    queue_scene_assets_change,
    queue_object_assets_change,
)
from ..services.asset_markdown import build_markdown_image_alt
from ..services.storage_service import storage_service
from ..services.deletion_service import delete_assets_with_files
from ..services.image_model_catalog_service import image_model_catalog_service
from ..services.rich_text_image_ref_service import rebuild_rich_text_refs_for_object
from ..services.object_change_events import queue_object_change
from ..services.storage_usage_service import (
    StorageQuotaExceededError,
    apply_project_usage_delta,
    apply_project_usage_deltas,
    build_asset_delta,
    build_asset_rows_delta,
    snapshot_asset_row,
    snapshot_rows,
)
from ..services.credential_service import CredentialServiceError, credential_service
from ..services.ownership import require_owned_object
from ..provider_engine.registry import list_providers as list_provider_specs, require_provider
from ..utils.story_entities import STORY_ENTITY_TYPE

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])


# Object types allowed for image ownership binding (asset generation -> ObjectAssetLink)
OBJECT_BINDING_MODELS = {
    "basic_info": BasicInfo,
    STORY_ENTITY_TYPE: StoryEntity,
}


def _collect_object_refs_for_asset_ids(
    db: Session,
    *,
    asset_ids: list[UUID],
) -> list[tuple[str, UUID]]:
    if not asset_ids:
        return []
    rows = (
        db.query(ObjectAssetLink.object_type, ObjectAssetLink.object_id)
        .filter(ObjectAssetLink.asset_id.in_(asset_ids))
        .all()
    )
    out: list[tuple[str, UUID]] = []
    for object_type, object_id in rows:
        if isinstance(object_type, str) and isinstance(object_id, UUID):
            out.append((object_type, object_id))
    return out


def _queue_object_updates(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    refs: list[tuple[str, UUID]],
) -> None:
    for object_type, object_id in set(refs):
        queue_object_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            action="updated",
        )


def _queue_object_asset_updates(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    refs: list[tuple[str, UUID]],
    action: str = "updated",
) -> None:
    for object_type, object_id in set(refs):
        queue_object_assets_change(
            db,
            user_id=user_id,
            project_id=project_id,
            object_type=object_type,
            object_id=object_id,
            action=action,
        )


def _queue_scene_asset_updates(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    manuscript_ids: list[UUID | None],
    action: str = "updated",
) -> None:
    if not manuscript_ids:
        return

    queue_scene_assets_change(
        db,
        user_id=user_id,
        project_id=project_id,
        manuscript_id=None,
        action=action,
    )
    for manuscript_id in {value for value in manuscript_ids if isinstance(value, UUID)}:
        queue_scene_assets_change(
            db,
            user_id=user_id,
            project_id=project_id,
            manuscript_id=manuscript_id,
            action=action,
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


def _latest_version_display_name(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    preferred_language: str | None = None,
) -> str:
    latest = (
        db.query(ObjectVersion)
        .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
        .order_by(ObjectVersion.version_number.desc())
        .first()
    )
    if latest is None:
        return object_type.replace("_", " ").title()
    rows = (
        db.query(ObjectVersionLanguage)
        .filter(ObjectVersionLanguage.version_id == latest.id)
        .order_by(ObjectVersionLanguage.created_at.asc())
        .all()
    )
    payloads: list[dict[str, Any]] = []
    if preferred_language:
        payloads.extend(
            cast(Dict[str, Any], row.data)
            for row in rows
            if row.language == preferred_language and isinstance(row.data, dict)
        )
    payloads.extend(
        cast(Dict[str, Any], row.data)
        for row in rows
        if row.language != preferred_language and isinstance(row.data, dict)
    )
    for payload in payloads:
        for key in ("name", "title"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return object_type.replace("_", " ").title()


def _manuscript_display_name(db: Session, manuscript_id: UUID) -> str:
    row = (
        db.query(Manuscript, Outline)
        .join(Outline, Manuscript.chapter_id == Outline.id)
        .filter(Manuscript.id == manuscript_id, Outline.kind == "chapter")
        .first()
    )
    if not row:
        return "Manuscript"
    manuscript, chapter = row
    title = _latest_version_display_name(db, object_type="outline", object_id=chapter.id)
    if title and title != "Outline":
        return title
    chapter_position = int(chapter.position or 0) + 1
    return f"Chapter {chapter_position}"


def _display_name_for_usage(
    db: Session,
    *,
    object_type: str,
    object_id: UUID,
    language: str | None = None,
) -> str:
    if object_type == "manuscript":
        return _manuscript_display_name(db, object_id)
    if object_type == "guidelines":
        return "Guidelines"
    return _latest_version_display_name(
        db,
        object_type=object_type,
        object_id=object_id,
        preferred_language=language,
    )


def _build_asset_usages_map(
    db: Session,
    *,
    project_id: UUID,
    asset_ids: list[UUID],
) -> dict[UUID, list[AssetUsage]]:
    usage_map: dict[UUID, list[AssetUsage]] = {asset_id: [] for asset_id in asset_ids}
    if not asset_ids:
        return usage_map

    object_name_cache: dict[tuple[str, UUID, str | None], str] = {}

    def object_name(object_type: str, object_id: UUID, language: str | None = None) -> str:
        key = (object_type, object_id, language)
        cached = object_name_cache.get(key)
        if cached is not None:
            return cached
        resolved = _display_name_for_usage(
            db,
            object_type=object_type,
            object_id=object_id,
            language=language,
        )
        object_name_cache[key] = resolved
        return resolved

    rich_rows = (
        db.query(RichTextImageRef)
        .filter(
            RichTextImageRef.project_id == project_id,
            RichTextImageRef.asset_id.in_(asset_ids),
        )
        .order_by(
            RichTextImageRef.object_type.asc(),
            RichTextImageRef.object_id.asc(),
            RichTextImageRef.language.asc(),
            RichTextImageRef.field_name.asc(),
            RichTextImageRef.position.asc(),
        )
        .all()
    )
    for row in rich_rows:
        usage_map.setdefault(row.asset_id, []).append(
            AssetUsage(
                usage_type="rich_text",
                object_type=row.object_type,
                object_id=str(row.object_id),
                object_name=object_name(row.object_type, row.object_id, str(row.language)),
                field_name=str(row.field_name),
                language=str(row.language),
            )
        )

    link_rows = (
        db.query(ObjectAssetLink)
        .join(Asset, Asset.id == ObjectAssetLink.asset_id)
        .filter(
            Asset.project_id == project_id,
            ObjectAssetLink.asset_id.in_(asset_ids),
            ObjectAssetLink.is_main == True,
        )
        .order_by(ObjectAssetLink.object_type.asc(), ObjectAssetLink.object_id.asc())
        .all()
    )
    for row in link_rows:
        usage_map.setdefault(row.asset_id, []).append(
            AssetUsage(
                usage_type="object_main",
                object_type=row.object_type,
                object_id=str(row.object_id),
                object_name=object_name(row.object_type, row.object_id),
                field_name=None,
                language=None,
            )
        )

    assets_with_refs = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.generation_reference_images.isnot(None))
        .all()
    )
    target_ids = {str(asset_id) for asset_id in asset_ids}
    for src_asset in assets_with_refs:
        refs = cast(Optional[List[Dict[str, Any]]], src_asset.generation_reference_images)
        if not isinstance(refs, list):
            continue
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            ref_asset_id = str(ref.get("asset_id") or "")
            if ref_asset_id not in target_ids:
                continue
            target_uuid = UUID(ref_asset_id)
            usage_map.setdefault(target_uuid, []).append(
                AssetUsage(
                    usage_type="generation_reference",
                    object_type="asset",
                    object_id=str(src_asset.id),
                    object_name=str(src_asset.name),
                    field_name=None,
                    language=None,
                )
            )

    for usages in usage_map.values():
        usages.sort(key=lambda item: (item.usage_type, item.object_type, item.object_name, item.field_name or "", item.language or ""))
    return usage_map


def _asset_to_response(asset: Asset, *, usages: Optional[List[AssetUsage]] = None) -> AssetResponse:
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
        generation_style_id=cast(Optional[str], asset.generation_style_id),
        generation_requested_aspect_ratio=cast(Optional[str], asset.generation_requested_aspect_ratio),
        generation_requested_image_size=cast(Optional[str], asset.generation_requested_image_size),
        generation_settings=cast(Optional[Dict[str, Any]], asset.generation_settings),
        generation_reference_images=cast(Optional[List[Dict[str, Any]]], asset.generation_reference_images),
        generation_mask_image=cast(Optional[Dict[str, Any]], asset.generation_mask_image),
        generation_reference_objects=cast(Optional[List[Dict[str, Any]]], asset.generation_reference_objects),
        width=cast(Optional[int], asset.width),
        height=cast(Optional[int], asset.height),
        file_size=cast(Optional[int], asset.file_size),
        created_at=cast(datetime, asset.created_at),
        updated_at=cast(datetime, asset.updated_at),
        file_url=storage_service.build_public_asset_path(cast(str, asset.file_path)),
        markdown_alt=build_markdown_image_alt(asset),
        usages=list(usages or []),
    )


def _asset_to_scene_response(asset: Asset, usages: List[AssetUsage]) -> SceneAssetResponse:
    """Convert Asset model to SceneAssetResponse with generic usage info."""
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
        generation_style_id=cast(Optional[str], asset.generation_style_id),
        generation_requested_aspect_ratio=cast(Optional[str], asset.generation_requested_aspect_ratio),
        generation_requested_image_size=cast(Optional[str], asset.generation_requested_image_size),
        width=cast(Optional[int], asset.width),
        height=cast(Optional[int], asset.height),
        file_size=cast(Optional[int], asset.file_size),
        created_at=cast(datetime, asset.created_at),
        updated_at=cast(datetime, asset.updated_at),
        file_url=storage_service.build_public_asset_path(cast(str, asset.file_path)),
        markdown_alt=build_markdown_image_alt(asset),
        usages=list(usages),
        usage_count=len(usages),
    )


# ============================================================================
# IMAGE PROVIDERS
# ============================================================================

@router.get("/image-providers", response_model=ImageProvidersResponse)
async def list_image_providers():
    """List available image generation providers"""
    providers = [spec for spec in list_provider_specs() if spec.image is not None]
    providers.sort(
        key=lambda spec: (
            spec.ui.image_order if spec.ui.image_order is not None else 999,
            spec.id,
        )
    )
    return ImageProvidersResponse(
        providers=[
            ImageProviderInfo(
                name=spec.id,
                display_name=spec.ui.display_name_key,
                prompt_type=spec.image.prompt_type,
                settings_schema=None,
                supports_image_input=spec.image.supports_image_input,
            )
            for spec in providers
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
        provider_spec = require_provider(provider)
        if provider_spec.image is None:
            raise HTTPException(status_code=404, detail=f"Unknown image provider '{provider}'")
        try:
            provider_config = credential_service.get_provider_config(db, current_user.id, provider)
        except CredentialServiceError:
            if not provider_spec.image.allow_missing_credentials_for_model_listing:
                raise
            provider_config = {}
        models = await image_model_catalog_service.list_models(provider, provider_config)
        return ImageModelsResponse(data=[ImageModelInfo.model_validate(model) for model in models])
    except CredentialServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch models: {str(e)}")


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
    """List scene assets with generic usage information. Optionally filter by manuscript ownership."""
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
        Asset.asset_type == 'scene',
        Asset.preview_image_run_id.is_(None),
    )
    if manuscript_id:
        query = query.filter(Asset.manuscript_id == manuscript_id)
    assets = query.order_by(Asset.created_at.desc()).all()

    usage_map = _build_asset_usages_map(
        db,
        project_id=project_id,
        asset_ids=[asset.id for asset in assets],
    )

    responses = []
    for asset in assets:
        responses.append(_asset_to_scene_response(asset, usage_map.get(asset.id, [])))

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

    assets = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.preview_image_run_id.is_(None))
        .order_by(Asset.created_at.desc())
        .all()
    )
    usage_map = _build_asset_usages_map(
        db,
        project_id=project_id,
        asset_ids=[asset.id for asset in assets],
    )

    return AssetListResponse(
        assets=[_asset_to_response(a, usages=usage_map.get(a.id, [])) for a in assets],
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
    normalized_object_type = object_type if object_type else None
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
            .join(Outline, Manuscript.chapter_id == Outline.id)
            .filter(Manuscript.id == manuscript_id, Outline.project_id == project_id, Outline.kind == "chapter")
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

    asset_uuid = uuid4()

    # Save to storage
    file_path, mime_type, width, height, file_size = storage_service.save_uploaded_file(
        file_content=content,
        original_filename=file.filename or "upload.png",
        project_id=project_id,
        asset_id=asset_uuid,
    )

    try:
        # Create asset record
        asset = Asset(
            id=asset_uuid,
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

        # If object binding, auto-link to the canonical object target
        if normalized_object_type and object_id:
            max_order = db.query(ObjectAssetLink).filter(
                ObjectAssetLink.object_type == normalized_object_type,
                ObjectAssetLink.object_id == object_id
            ).count()
            link = ObjectAssetLink(
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
                user_id=current_user.id,
                project_id=project_id,
                object_type=normalized_object_type,
                object_id=object_id,
                action="updated",
            )
            queue_object_assets_change(
                db,
                user_id=current_user.id,
                project_id=project_id,
                object_type=normalized_object_type,
                object_id=object_id,
                action="created",
            )

        queue_project_assets_change(db, user_id=current_user.id, project_id=project_id, action="created")
        if manuscript_id is not None:
            _queue_scene_asset_updates(
                db,
                user_id=current_user.id,
                project_id=project_id,
                manuscript_ids=[manuscript_id],
                action="created",
            )

        db.flush()
        apply_project_usage_delta(
            db,
            user_id=current_user.id,
            project_id=project_id,
            delta=build_asset_delta(None, snapshot_asset_row(asset)),
            enforce_quota=True,
        )
        db.commit()
        db.refresh(asset)
    except StorageQuotaExceededError:
        db.rollback()
        storage_service.delete_asset_files(file_path)
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
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

    usage_map = _build_asset_usages_map(db, project_id=project_id, asset_ids=[asset.id])
    return _asset_to_response(asset, usages=usage_map.get(asset.id, []))


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

    affected_refs = _collect_object_refs_for_asset_ids(db, asset_ids=[asset_id])
    scene_manuscript_ids = [asset.manuscript_id] if asset.asset_type == "scene" else []
    before = snapshot_asset_row(asset)
    if request.name is not None:
        asset.name = request.name

    asset.updated_at = datetime.utcnow()
    queue_project_assets_change(db, user_id=current_user.id, project_id=project_id, action="updated")
    _queue_object_asset_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        refs=affected_refs,
        action="updated",
    )
    _queue_scene_asset_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        manuscript_ids=scene_manuscript_ids,
        action="updated",
    )
    try:
        apply_project_usage_delta(
            db,
            user_id=current_user.id,
            project_id=project_id,
            delta=build_asset_delta(before, snapshot_asset_row(asset)),
            enforce_quota=True,
        )
    except StorageQuotaExceededError:
        db.rollback()
        raise HTTPException(status_code=413, detail="Storage quota exceeded")
    db.commit()
    db.refresh(asset)

    usage_map = _build_asset_usages_map(db, project_id=project_id, asset_ids=[asset.id])
    return _asset_to_response(asset, usages=usage_map.get(asset.id, []))


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

    affected_refs = _collect_object_refs_for_asset_ids(db, asset_ids=[asset_id])
    scene_manuscript_ids = [asset.manuscript_id] if asset.asset_type == "scene" else []
    deleted_asset_before = snapshot_asset_row(asset)
    scrubbed_before = snapshot_rows(
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.generation_reference_images.isnot(None),
            Asset.id != asset_id,
        )
        .all(),
        snapshot_asset_row,
    )

    # Delete from storage + DB, and scrub stale generation_reference_images pointers.
    delete_assets_with_files(db, assets=[asset], scrub_references_in_project_id=project_id)
    _queue_object_updates(db, user_id=current_user.id, project_id=project_id, refs=affected_refs)
    _queue_object_asset_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        refs=affected_refs,
        action="deleted",
    )
    _queue_scene_asset_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        manuscript_ids=scene_manuscript_ids,
        action="deleted",
    )
    queue_project_assets_change(db, user_id=current_user.id, project_id=project_id, action="deleted")
    scrubbed_after = snapshot_rows(
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.generation_reference_images.isnot(None),
            Asset.id != asset_id,
        )
        .all(),
        snapshot_asset_row,
    )
    apply_project_usage_deltas(
        db,
        user_id=current_user.id,
        project_id=project_id,
        deltas=[
            build_asset_delta(deleted_asset_before, None),
            build_asset_rows_delta(scrubbed_before, scrubbed_after),
        ],
        enforce_quota=False,
    )
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
    used_in_rich_text: set[UUID],
    story_non_main_assets: set[UUID],
) -> List[str]:
    if asset.id in used_in_rich_text:
        return []

    reasons: List[str] = []

    if policy.delete_non_main_object_images and asset.asset_type == "object" and asset.id in story_non_main_assets:
        reasons.append("object_non_main")

    if (
        policy.delete_unused_rich_text_images
        and asset.asset_type == "scene"
    ):
        reasons.append("unused_in_rich_text")

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

    assets = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.preview_image_run_id.is_(None))
        .order_by(Asset.created_at.desc())
        .all()
    )

    used_in_rich_text_rows = (
        db.query(RichTextImageRef.asset_id)
        .filter(
            RichTextImageRef.project_id == project_id,
            RichTextImageRef.asset_id.isnot(None),
        )
        .distinct()
        .all()
    )
    used_in_rich_text: set[UUID] = {row[0] for row in used_in_rich_text_rows if row[0]}

    story_non_main_rows = (
        db.query(ObjectAssetLink.asset_id)
        .join(Asset, Asset.id == ObjectAssetLink.asset_id)
        .filter(
            Asset.project_id == project_id,
            ObjectAssetLink.is_main == False,
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
            used_in_rich_text=used_in_rich_text,
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
                file_url=storage_service.build_public_asset_path(cast(str, asset.file_path)),
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
        .filter(
            Asset.project_id == project_id,
            Asset.preview_image_run_id.is_(None),
            Asset.id.in_(valid_ids),
        )
        .all()
    }

    skipped: List[ImageCleanupExecuteSkipped] = []
    for a_id in valid_ids:
        if a_id not in assets_by_id:
            skipped.append(ImageCleanupExecuteSkipped(asset_id=str(a_id), reason="Asset not found"))

    # Usage sets (project-wide)
    used_in_rich_text_rows = (
        db.query(RichTextImageRef.asset_id)
        .filter(RichTextImageRef.project_id == project_id, RichTextImageRef.asset_id.isnot(None))
        .distinct()
        .all()
    )
    used_in_rich_text: set[UUID] = {row[0] for row in used_in_rich_text_rows if row[0]}

    story_non_main_rows = (
        db.query(ObjectAssetLink.asset_id)
        .join(Asset, Asset.id == ObjectAssetLink.asset_id)
        .filter(
            Asset.project_id == project_id,
            ObjectAssetLink.is_main == False,
        )
        .all()
    )
    story_non_main_assets: set[UUID] = {row[0] for row in story_non_main_rows if row[0]}

    # Reference index (project-wide) for eligibility checks
    all_assets = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.preview_image_run_id.is_(None),
    ).all()
    referenced_by = _build_reference_reverse_index(all_assets)

    eligible: List[Asset] = []
    for asset in assets_by_id.values():
        reasons = _candidate_reasons_for_asset(
            asset=asset,
            policy=policy,
            used_in_rich_text=used_in_rich_text,
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
    affected_object_refs = _collect_object_refs_for_asset_ids(
        db,
        asset_ids=[asset.id for asset in to_delete],
    )

    scrubbed_entries = 0
    deleted: List[str] = []

    # Scrub deleted IDs from other assets' generation_reference_images when allowed.
    deleted_asset_before = snapshot_rows(to_delete, snapshot_asset_row)
    scrubbed_before = snapshot_rows(
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.generation_reference_images.isnot(None),
            ~Asset.id.in_([asset.id for asset in to_delete]) if to_delete else True,
        )
        .all(),
        snapshot_asset_row,
    )

    if to_delete and not policy.treat_reference_images_as_used:
        delete_id_strings = {str(a.id) for a in to_delete}
        assets_with_refs = (
            db.query(Asset)
            .filter(
                Asset.project_id == project_id,
                Asset.generation_reference_images.isnot(None),
                ~Asset.id.in_([asset.id for asset in to_delete]) if to_delete else True,
            )
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

    _queue_object_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        refs=affected_object_refs,
    )
    _queue_object_asset_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        refs=affected_object_refs,
        action="deleted",
    )
    scene_manuscript_ids = [asset.manuscript_id for asset in to_delete if asset.asset_type == "scene"]
    _queue_scene_asset_updates(
        db,
        user_id=current_user.id,
        project_id=project_id,
        manuscript_ids=scene_manuscript_ids,
        action="deleted",
    )
    if deleted:
        queue_project_assets_change(db, user_id=current_user.id, project_id=project_id, action="deleted")
    scrubbed_after = snapshot_rows(
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.generation_reference_images.isnot(None),
            ~Asset.id.in_([asset.id for asset in to_delete]) if to_delete else True,
        )
        .all(),
        snapshot_asset_row,
    )
    apply_project_usage_deltas(
        db,
        user_id=current_user.id,
        project_id=project_id,
        deltas=[
            build_asset_rows_delta(deleted_asset_before, []),
            build_asset_rows_delta(scrubbed_before, scrubbed_after),
        ],
        enforce_quota=False,
    )
    db.commit()

    for file_path in file_deletions:
        storage_service.delete_asset_files(file_path)

    return ImageCleanupExecuteResponse(
        deleted=deleted,
        skipped=skipped,
        errors=errors,
        scrubbed_reference_entries=scrubbed_entries,
    )


@router.post("/{project_id}/cleanup/rebuild-rich-text-image-refs", response_model=RebuildRichTextImageRefsResponse)
async def rebuild_rich_text_image_refs_index(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rebuild rich_text_image_refs for all rich-text objects/languages in a project."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    objects_processed = 0
    languages_processed = 0
    refs_deleted = 0
    refs_inserted = 0

    object_rows: list[tuple[str, UUID]] = []
    object_rows.extend(
        ("guidelines", row.id)
        for row in db.query(Guidelines.id).filter(Guidelines.project_id == project_id).all()
        if isinstance(row.id, UUID)
    )
    object_rows.extend(
        (STORY_ENTITY_TYPE, row.id)
        for row in db.query(StoryEntity.id).filter(StoryEntity.project_id == project_id).all()
        if isinstance(row.id, UUID)
    )
    object_rows.extend(
        ("outline", row.id)
        for row in db.query(Outline.id).filter(Outline.project_id == project_id).all()
        if isinstance(row.id, UUID)
    )
    object_rows.extend(
        ("manuscript", row.id)
        for row in (
            db.query(Manuscript.id)
            .join(Outline, Manuscript.chapter_id == Outline.id)
            .filter(Outline.project_id == project_id, Outline.kind == "chapter")
            .all()
        )
        if isinstance(row.id, UUID)
    )

    manuscript_ids: list[UUID] = []
    for object_type, object_id in object_rows:
        objects_processed += 1
        latest_version = (
            db.query(ObjectVersion)
            .filter(ObjectVersion.object_type == object_type, ObjectVersion.object_id == object_id)
            .order_by(ObjectVersion.version_number.desc())
            .first()
        )
        language_rows = (
            db.query(ObjectVersionLanguage)
            .filter(ObjectVersionLanguage.version_id == latest_version.id)
            .all()
            if latest_version is not None
            else []
        )
        for language_row in language_rows:
            if not isinstance(language_row.data, dict):
                continue
            languages_processed += 1
            refs_deleted += (
                db.query(RichTextImageRef)
                .filter(
                    RichTextImageRef.object_type == object_type,
                    RichTextImageRef.object_id == object_id,
                    RichTextImageRef.language == str(language_row.language),
                )
                .count()
            )
            rebuild_rich_text_refs_for_object(
                db,
                project_id=project_id,
                object_type=object_type,
                object_id=object_id,
                language=str(language_row.language),
                version_data=language_row.data,
            )
            refs_inserted += (
                db.query(RichTextImageRef)
                .filter(
                    RichTextImageRef.object_type == object_type,
                    RichTextImageRef.object_id == object_id,
                    RichTextImageRef.language == str(language_row.language),
                )
                .count()
            )
            if object_type == "manuscript":
                manuscript_ids.append(object_id)

    if object_rows:
        queue_project_assets_change(db, user_id=current_user.id, project_id=project_id, action="updated")
    if manuscript_ids:
        _queue_scene_asset_updates(
            db,
            user_id=current_user.id,
            project_id=project_id,
            manuscript_ids=manuscript_ids,
            action="updated",
        )
    db.commit()

    return RebuildRichTextImageRefsResponse(
        objects_processed=objects_processed,
        languages_processed=languages_processed,
        refs_deleted=refs_deleted,
        refs_inserted=refs_inserted,
    )


# ============================================================================
# STORY OBJECT ASSETS
# ============================================================================

@router.get("/{project_id}/object/{object_type}/{object_id}", response_model=ObjectAssetLinksResponse)
async def get_object_asset_links(
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all assets linked to an object, newest first."""
    require_owned_object(
        db,
        user_id=current_user.id,
        object_type=object_type,
        object_id=object_id,
        project_id=project_id,
    )

    rows = (
        db.query(ObjectAssetLink, Asset)
        .join(Asset, Asset.id == ObjectAssetLink.asset_id)
        .filter(
            ObjectAssetLink.object_type == object_type,
            ObjectAssetLink.object_id == object_id,
            Asset.project_id == project_id,
        )
        .order_by(Asset.created_at.desc(), ObjectAssetLink.created_at.desc())
        .all()
    )

    responses = []
    main_asset = None

    for link, asset in rows:
        response = ObjectAssetLinkResponse(
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

    return ObjectAssetLinksResponse(assets=responses, main_asset=main_asset)


@router.patch("/{project_id}/object/{object_type}/{object_id}/main", response_model=ObjectAssetLinkResponse)
async def set_main_asset(
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    request: SetMainAssetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set the main asset for an object."""
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
        db.query(ObjectAssetLink)
        .join(Asset, Asset.id == ObjectAssetLink.asset_id)
        .filter(
            ObjectAssetLink.object_type == object_type,
            ObjectAssetLink.object_id == object_id,
            ObjectAssetLink.asset_id == asset_id,
            Asset.project_id == project_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Asset not linked to this object")

    # Unset all mains and set the new one
    db.query(ObjectAssetLink).filter(
        ObjectAssetLink.object_type == object_type,
        ObjectAssetLink.object_id == object_id
    ).update({"is_main": False})

    link.is_main = True
    queue_object_change(
        db,
        user_id=current_user.id,
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        action="updated",
    )
    queue_object_assets_change(
        db,
        user_id=current_user.id,
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

    return ObjectAssetLinkResponse(
        id=str(link.id),
        object_type=link.object_type,
        object_id=str(link.object_id),
        asset_id=str(link.asset_id),
        is_main=link.is_main,
        display_order=link.display_order,
        created_at=link.created_at,
        asset=_asset_to_response(asset)
    )
