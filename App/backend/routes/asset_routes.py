"""Asset management routes"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any, cast
from uuid import UUID, uuid4
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User, Project, Asset, StoryObjectAsset, ManuscriptImage, Manuscript, ChapterAsset, Chapter, Act
from ..schemas.assets import (
    AssetResponse, AssetListResponse, AssetUpdateRequest,
    StoryObjectAssetCreate, StoryObjectAssetResponse, StoryObjectAssetsResponse, SetMainAssetRequest,
    ManuscriptImageCreate, ManuscriptImageResponse, ManuscriptImagesResponse, ManuscriptImageUpdateRequest,
    ImageGenerationRequest, ImageGenerationResponse,
    ImageProvidersResponse, ImageProviderInfo, ImageModelsResponse,
    ChapterAssetCreate, ChapterAssetResponse, ChapterAssetsResponse,
    SceneAssetResponse, SceneAssetsResponse, ChapterInfo,
    StyledPrompt
)
from ..services.storage_service import storage_service
from ..image_providers.registry import ImageProviderRegistry
from ..image_providers.base import ReferenceImageData

# Import providers to register them
from ..image_providers import openai_image, gemini_image, xai_image, novelai_image

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])


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
        thumbnail_path=cast(Optional[str], asset.thumbnail_path),
        mime_type=cast(str, asset.mime_type),
        asset_type=cast(Optional[str], asset.asset_type),
        generation_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_prompt)),
        generation_positive_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_positive_prompt)),
        generation_negative_prompt=_jsonb_to_styled_prompt(cast(Optional[Dict[str, Any]], asset.generation_negative_prompt)),
        generation_provider=cast(Optional[str], asset.generation_provider),
        generation_model=cast(Optional[str], asset.generation_model),
        generation_settings=cast(Optional[Dict[str, Any]], asset.generation_settings),
        generation_reference_objects=cast(Optional[List[Dict[str, Any]]], asset.generation_reference_objects),
        width=cast(Optional[int], asset.width),
        height=cast(Optional[int], asset.height),
        file_size=cast(Optional[int], asset.file_size),
        created_at=cast(datetime, asset.created_at),
        updated_at=cast(datetime, asset.updated_at),
        file_url=f"/storage/assets/{cast(str, asset.file_path)}",
        thumbnail_url=f"/storage/assets/{cast(str, asset.thumbnail_path)}" if asset.thumbnail_path is not None else None
    )


def _asset_to_scene_response(asset: Asset, used_in_chapters: List[ChapterInfo]) -> SceneAssetResponse:
    """Convert Asset model to SceneAssetResponse with chapter usage info"""
    return SceneAssetResponse(
        id=str(asset.id),
        project_id=str(asset.project_id),
        name=cast(str, asset.name),
        file_path=cast(str, asset.file_path),
        thumbnail_path=cast(Optional[str], asset.thumbnail_path),
        mime_type=cast(str, asset.mime_type),
        asset_type=cast(Optional[str], asset.asset_type),
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
        thumbnail_url=f"/storage/assets/{cast(str, asset.thumbnail_path)}" if asset.thumbnail_path is not None else None,
        used_in_chapters=used_in_chapters,
        usage_count=len(used_in_chapters)
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
    api_key: str = Form(...)
):
    """Get available models for an image provider"""
    try:
        provider_instance = ImageProviderRegistry.get_provider(provider, {"api_key": api_key})
        if not provider_instance.validate_config():
            raise HTTPException(status_code=400, detail="Invalid API key")
        models = await provider_instance.get_models()
        return ImageModelsResponse(data=models.get("data", []))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================================
# IMAGE GENERATION
# ============================================================================

@router.post("/{project_id}/generate", response_model=ImageGenerationResponse)
async def generate_image(
    project_id: UUID,
    request: ImageGenerationRequest,
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

    try:
        # Get provider instance
        provider = ImageProviderRegistry.get_provider(
            request.provider,
            {"api_key": request.api_key}
        )

        if not provider.validate_config():
            return ImageGenerationResponse(
                success=False,
                error="Invalid provider configuration"
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
                        reference_image_data.append(ReferenceImageData(
                            image_data=image_bytes,
                            strength=ref_img.strength
                        ))
                    except FileNotFoundError:
                        # Skip missing files
                        pass

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

        # Generate image
        result = await provider.generate_image(
            prompt=final_prompt,
            model=request.model,
            size=request.size,
            quality=request.quality,
            style=request.style,
            positive_prompt=final_positive_prompt,
            negative_prompt=final_negative_prompt,
            provider_settings=request.provider_settings,
            reference_images=reference_image_data,
        )

        if not result.success:
            return ImageGenerationResponse(
                success=False,
                error=result.error
            )

        # Save to storage
        if result.image_b64:
            import base64
            file_path, thumb_path, mime_type, width, height, file_size = storage_service.save_generated_image(
                base64_data=result.image_b64,
                project_id=project_id,
                format=result.format
            )
        elif result.image_data:
            file_path, thumb_path, mime_type, width, height, file_size = storage_service.save_generated_image_from_url(
                image_bytes=result.image_data,
                project_id=project_id,
                format=result.format
            )
        else:
            return ImageGenerationResponse(
                success=False,
                error="No image data returned from provider"
            )

        # Create asset record
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

        asset = Asset(
            id=uuid4(),
            project_id=project_id,
            name=f"Generated Image {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
            file_path=file_path,
            thumbnail_path=thumb_path,
            mime_type=mime_type,
            asset_type=request.asset_type,  # 'scene', 'object', or None - passed from frontend
            # Store StyledPrompt as JSONB dicts
            generation_prompt=request.prompt.model_dump() if request.prompt else None,
            generation_positive_prompt=request.positive_prompt.model_dump() if request.positive_prompt else None,
            generation_negative_prompt=request.negative_prompt.model_dump() if request.negative_prompt else None,
            generation_provider=request.provider,
            generation_model=request.model,
            generation_settings=request.provider_settings,
            generation_reference_objects=ref_objects_data,  # Story objects used during generation
            width=width or result.width,
            height=height or result.height,
            file_size=file_size
        )
        db.add(asset)
        db.commit()
        db.refresh(asset)

        return ImageGenerationResponse(
            success=True,
            asset_id=str(asset.id),
            file_path=f"/storage/assets/{file_path}",
            thumbnail_path=f"/storage/assets/{thumb_path}" if thumb_path else None,
            revised_prompt=result.revised_prompt
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        return ImageGenerationResponse(
            success=False,
            error=str(e)
        )


# ============================================================================
# SCENE ASSETS (must be before generic /{asset_id} routes)
# ============================================================================

@router.get("/{project_id}/scene", response_model=SceneAssetsResponse)
async def list_scene_assets(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all scene assets with chapter usage information"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all scene assets
    assets = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.asset_type == 'scene'
    ).order_by(Asset.created_at.desc()).all()

    # Build response with chapter usage
    responses = []
    for asset in assets:
        # Get chapters using this asset
        chapter_links = db.query(ChapterAsset).filter(
            ChapterAsset.asset_id == asset.id
        ).all()

        used_in_chapters = []
        for link in chapter_links:
            chapter = db.query(Chapter).filter(Chapter.id == link.chapter_id).first()
            if chapter:
                # Get act info for chapter name context
                act = db.query(Act).filter(Act.id == chapter.act_id).first()
                # Get chapter name from object_translations if available
                # For now, use a placeholder - in production, join with translations
                used_in_chapters.append(ChapterInfo(
                    id=str(chapter.id),
                    name=f"Chapter {chapter.order + 1}",  # Fallback name
                    act_name=f"Act {act.order + 1}" if act else None
                ))

        responses.append(_asset_to_scene_response(asset, used_in_chapters))

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
    allowed_types = {"image/png", "image/jpeg", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: PNG, JPEG, GIF, WebP")

    # Validate asset_type if provided
    if asset_type and asset_type not in ('scene', 'object'):
        raise HTTPException(status_code=400, detail="Invalid asset_type. Allowed: 'scene', 'object'")

    # Read file content
    content = await file.read()

    # Save to storage
    file_path, thumb_path, mime_type, width, height, file_size = storage_service.save_uploaded_file(
        file_content=content,
        original_filename=file.filename or "upload.png",
        project_id=project_id
    )

    # Create asset record
    asset = Asset(
        id=uuid4(),
        project_id=project_id,
        name=name or file.filename or "Uploaded Image",
        file_path=file_path,
        thumbnail_path=thumb_path,
        mime_type=mime_type,
        asset_type=asset_type,
        width=width,
        height=height,
        file_size=file_size
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

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

    # Delete files from storage
    storage_service.delete_asset_files(asset.file_path, asset.thumbnail_path)

    # Delete from database (cascades to story_object_assets and manuscript_images)
    db.delete(asset)
    db.commit()

    return {"success": True}


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
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all linked assets
    links = db.query(StoryObjectAsset).filter(
        StoryObjectAsset.object_type == object_type,
        StoryObjectAsset.object_id == object_id
    ).order_by(StoryObjectAsset.display_order).all()

    responses = []
    main_asset = None

    for link in links:
        asset = db.query(Asset).filter(Asset.id == link.asset_id).first()
        if asset:
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


@router.post("/{project_id}/object/{object_type}/{object_id}", response_model=StoryObjectAssetResponse)
async def link_asset_to_object(
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    request: StoryObjectAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Link an asset to a story object"""
    # Verify project ownership and asset exists
    asset = db.query(Asset).join(Project).filter(
        Asset.id == UUID(request.asset_id),
        Asset.project_id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # If setting as main, unset other mains
    if request.is_main:
        db.query(StoryObjectAsset).filter(
            StoryObjectAsset.object_type == object_type,
            StoryObjectAsset.object_id == object_id
        ).update({"is_main": False})

    # Get max display order
    max_order = db.query(StoryObjectAsset).filter(
        StoryObjectAsset.object_type == object_type,
        StoryObjectAsset.object_id == object_id
    ).count()

    # Create link
    link = StoryObjectAsset(
        id=uuid4(),
        object_type=object_type,
        object_id=object_id,
        asset_id=UUID(request.asset_id),
        is_main=request.is_main,
        display_order=max_order
    )
    db.add(link)
    db.commit()
    db.refresh(link)

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
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Find the link to set as main
    link = db.query(StoryObjectAsset).filter(
        StoryObjectAsset.object_type == object_type,
        StoryObjectAsset.object_id == object_id,
        StoryObjectAsset.asset_id == UUID(request.asset_id)
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Asset not linked to this object")

    # Unset all mains and set the new one
    db.query(StoryObjectAsset).filter(
        StoryObjectAsset.object_type == object_type,
        StoryObjectAsset.object_id == object_id
    ).update({"is_main": False})

    link.is_main = True
    db.commit()
    db.refresh(link)

    asset = db.query(Asset).filter(Asset.id == link.asset_id).first()

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


@router.delete("/{project_id}/object/{object_type}/{object_id}/{link_id}")
async def unlink_asset_from_object(
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    link_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Remove asset link from a story object"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    link = db.query(StoryObjectAsset).filter(
        StoryObjectAsset.id == link_id,
        StoryObjectAsset.object_type == object_type,
        StoryObjectAsset.object_id == object_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True}


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
    # Verify project ownership
    manuscript = db.query(Manuscript).filter(
        Manuscript.id == manuscript_id
    ).first()
    if not manuscript:
        raise HTTPException(status_code=404, detail="Manuscript not found")

    images = db.query(ManuscriptImage).filter(
        ManuscriptImage.manuscript_id == manuscript_id
    ).order_by(ManuscriptImage.position).all()

    responses = []
    for img in images:
        asset = None
        if img.asset_id:
            asset_model = db.query(Asset).filter(Asset.id == img.asset_id).first()
            if asset_model:
                asset = _asset_to_response(asset_model)

        responses.append(ManuscriptImageResponse(
            id=str(img.id),
            manuscript_id=str(img.manuscript_id),
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
    """Add an image to a manuscript"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    manuscript = db.query(Manuscript).filter(
        Manuscript.id == manuscript_id
    ).first()
    if not manuscript:
        raise HTTPException(status_code=404, detail="Manuscript not found")

    # Validate source
    asset = None
    if request.source_type == "asset":
        if not request.asset_id:
            raise HTTPException(status_code=400, detail="asset_id required for source_type 'asset'")
        asset_model = db.query(Asset).filter(
            Asset.id == UUID(request.asset_id),
            Asset.project_id == project_id
        ).first()
        if not asset_model:
            raise HTTPException(status_code=404, detail="Asset not found")
        asset = _asset_to_response(asset_model)

    img = ManuscriptImage(
        id=uuid4(),
        manuscript_id=manuscript_id,
        position=request.position,
        source_type=request.source_type,
        asset_id=UUID(request.asset_id) if request.asset_id else None,
        story_object_type=request.story_object_type,
        story_object_id=UUID(request.story_object_id) if request.story_object_id else None,
        generation_prompt=request.generation_prompt,
        display_width=request.display_width,
        caption=request.caption
    )
    db.add(img)
    db.commit()
    db.refresh(img)

    return ManuscriptImageResponse(
        id=str(img.id),
        manuscript_id=str(img.manuscript_id),
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
    """Update a manuscript image"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    img = db.query(ManuscriptImage).filter(
        ManuscriptImage.id == image_id,
        ManuscriptImage.manuscript_id == manuscript_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    if request.position is not None:
        img.position = request.position
    if request.display_width is not None:
        img.display_width = request.display_width
    if request.caption is not None:
        img.caption = request.caption

    img.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(img)

    asset = None
    if img.asset_id:
        asset_model = db.query(Asset).filter(Asset.id == img.asset_id).first()
        if asset_model:
            asset = _asset_to_response(asset_model)

    return ManuscriptImageResponse(
        id=str(img.id),
        manuscript_id=str(img.manuscript_id),
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
    )


@router.delete("/{project_id}/manuscript/{manuscript_id}/images/{image_id}")
async def delete_manuscript_image(
    project_id: UUID,
    manuscript_id: UUID,
    image_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a manuscript image"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    img = db.query(ManuscriptImage).filter(
        ManuscriptImage.id == image_id,
        ManuscriptImage.manuscript_id == manuscript_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    db.delete(img)
    db.commit()

    return {"success": True}


# ============================================================================
# CHAPTER ASSETS
# ============================================================================

@router.post("/{project_id}/chapter/{chapter_id}", response_model=ChapterAssetResponse)
async def link_asset_to_chapter(
    project_id: UUID,
    chapter_id: UUID,
    request: ChapterAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Link a scene asset to a chapter"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify asset exists and belongs to project
    asset = db.query(Asset).filter(
        Asset.id == UUID(request.asset_id),
        Asset.project_id == project_id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Check if link already exists
    existing = db.query(ChapterAsset).filter(
        ChapterAsset.chapter_id == chapter_id,
        ChapterAsset.asset_id == UUID(request.asset_id)
    ).first()
    if existing:
        # Return existing link instead of error
        return ChapterAssetResponse(
            id=str(existing.id),
            chapter_id=str(existing.chapter_id),
            asset_id=str(existing.asset_id),
            created_at=cast(datetime, existing.created_at),
            asset=_asset_to_response(asset)
        )

    # Create link
    link = ChapterAsset(
        id=uuid4(),
        chapter_id=chapter_id,
        asset_id=UUID(request.asset_id)
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return ChapterAssetResponse(
        id=str(link.id),
        chapter_id=str(link.chapter_id),
        asset_id=str(link.asset_id),
        created_at=cast(datetime, link.created_at),
        asset=_asset_to_response(asset)
    )


@router.delete("/{project_id}/chapter/{chapter_id}/{asset_id}")
async def unlink_asset_from_chapter(
    project_id: UUID,
    chapter_id: UUID,
    asset_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Remove asset link from a chapter"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    link = db.query(ChapterAsset).filter(
        ChapterAsset.chapter_id == chapter_id,
        ChapterAsset.asset_id == asset_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True}


@router.get("/{project_id}/chapter/{chapter_id}/assets", response_model=ChapterAssetsResponse)
async def get_chapter_assets(
    project_id: UUID,
    chapter_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all assets linked to a chapter"""
    # Verify project ownership
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all linked assets
    links = db.query(ChapterAsset).filter(
        ChapterAsset.chapter_id == chapter_id
    ).order_by(ChapterAsset.created_at).all()

    responses = []
    for link in links:
        asset = db.query(Asset).filter(Asset.id == link.asset_id).first()
        if asset:
            responses.append(ChapterAssetResponse(
                id=str(link.id),
                chapter_id=str(link.chapter_id),
                asset_id=str(link.asset_id),
                created_at=cast(datetime, link.created_at),
                asset=_asset_to_response(asset)
            ))

    return ChapterAssetsResponse(assets=responses)
