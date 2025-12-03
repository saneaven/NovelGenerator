"""Pydantic schemas for asset management"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


# ============================================================================
# IMAGE GENERATION
# ============================================================================

class ReferenceImage(BaseModel):
    """Reference image for image-to-image generation"""
    asset_id: str
    strength: float = 0.7  # How much to use this reference (0-1)


class ReferenceObject(BaseModel):
    """Reference object used during generation (stored in metadata)"""
    id: str
    type: str  # 'character', 'location', 'organization', 'lorebook'
    name: str


class ImageGenerationRequest(BaseModel):
    """Request to generate an image"""
    # API key for the image provider (sent in request body for consistency with LLM endpoints)
    api_key: str

    # For natural language providers (OpenAI, Gemini, xAI)
    prompt: Optional[str] = None

    # For tag-based providers (NovelAI)
    positive_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None

    provider: str  # 'openai', 'gemini', 'xai', 'novelai'
    model: str
    size: str = "1024x1024"
    quality: str = "standard"
    style: str = "natural"

    # Provider-specific settings (e.g., sampler, steps for NovelAI)
    provider_settings: Optional[Dict[str, Any]] = None

    # For prompt enhancement (optional)
    enhance_prompt: bool = False
    enhancement_provider: Optional[str] = None
    enhancement_model: Optional[str] = None

    # Reference images for image-to-image generation (OpenAI GPT-Image, Gemini)
    reference_images: Optional[List[ReferenceImage]] = None

    # Reference objects used (stored in Asset metadata)
    reference_objects: Optional[List[ReferenceObject]] = None


class ImageGenerationResponse(BaseModel):
    """Response from image generation"""
    success: bool
    asset_id: Optional[str] = None
    file_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    revised_prompt: Optional[str] = None
    error: Optional[str] = None


class ImageProviderInfo(BaseModel):
    """Information about an image provider"""
    name: str
    display_name: str
    prompt_type: str = "natural"  # 'natural' or 'tag_based'
    supported_sizes: List[str]
    supported_qualities: List[str]
    supported_styles: List[str]
    settings_schema: Optional[Dict[str, Any]] = None  # Provider-specific settings schema
    supports_image_input: bool = False  # Whether provider supports image-to-image generation


class ImageProvidersResponse(BaseModel):
    """Response listing available image providers"""
    providers: List[ImageProviderInfo]


class ImageModelsResponse(BaseModel):
    """Response listing available models for a provider"""
    data: List[Dict[str, Any]]


# ============================================================================
# ASSETS
# ============================================================================

class AssetBase(BaseModel):
    """Base asset schema"""
    name: str
    generation_prompt: Optional[str] = None


class AssetCreate(AssetBase):
    """Schema for creating an asset (upload)"""
    pass


class AssetResponse(BaseModel):
    """Response for asset operations"""
    id: str
    project_id: str
    name: str
    file_path: str
    thumbnail_path: Optional[str] = None
    mime_type: str
    # Prompts stored separately by provider type
    generation_prompt: Optional[str] = None  # Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt: Optional[str] = None  # Positive prompt for tag-based (NovelAI)
    generation_negative_prompt: Optional[str] = None  # Negative prompt for tag-based (NovelAI)
    generation_provider: Optional[str] = None
    generation_model: Optional[str] = None
    generation_settings: Optional[Dict[str, Any]] = None  # Provider-specific settings
    generation_reference_objects: Optional[List[Dict[str, Any]]] = None  # Story objects referenced
    width: Optional[int] = None
    height: Optional[int] = None
    file_size: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    # URL for frontend access
    file_url: str
    thumbnail_url: Optional[str] = None

    class Config:
        from_attributes = True


class AssetListResponse(BaseModel):
    """Response for listing assets"""
    assets: List[AssetResponse]
    total: int


class AssetUpdateRequest(BaseModel):
    """Request to update asset metadata"""
    name: Optional[str] = None


# ============================================================================
# STORY OBJECT ASSETS
# ============================================================================

class StoryObjectAssetCreate(BaseModel):
    """Request to link an asset to a story object"""
    asset_id: str
    is_main: bool = False


class StoryObjectAssetResponse(BaseModel):
    """Response for story object asset link"""
    id: str
    object_type: str
    object_id: str
    asset_id: str
    is_main: bool
    display_order: int
    created_at: datetime
    asset: AssetResponse

    class Config:
        from_attributes = True


class StoryObjectAssetsResponse(BaseModel):
    """Response for listing story object assets"""
    assets: List[StoryObjectAssetResponse]
    main_asset: Optional[StoryObjectAssetResponse] = None


class SetMainAssetRequest(BaseModel):
    """Request to set main asset for a story object"""
    asset_id: str


# ============================================================================
# MANUSCRIPT IMAGES
# ============================================================================

class ManuscriptImageCreate(BaseModel):
    """Request to add an image to manuscript"""
    position: int
    source_type: str  # 'asset' or 'story_object'
    asset_id: Optional[str] = None
    story_object_type: Optional[str] = None
    story_object_id: Optional[str] = None
    generation_prompt: Optional[str] = None
    display_width: int = 400
    caption: Optional[str] = None


class ManuscriptImageResponse(BaseModel):
    """Response for manuscript image"""
    id: str
    manuscript_id: str
    position: int
    source_type: str
    asset_id: Optional[str] = None
    story_object_type: Optional[str] = None
    story_object_id: Optional[str] = None
    generation_prompt: Optional[str] = None
    display_width: int
    caption: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Resolved asset info
    asset: Optional[AssetResponse] = None

    class Config:
        from_attributes = True


class ManuscriptImagesResponse(BaseModel):
    """Response for listing manuscript images"""
    images: List[ManuscriptImageResponse]


class ManuscriptImageUpdateRequest(BaseModel):
    """Request to update manuscript image"""
    position: Optional[int] = None
    display_width: Optional[int] = None
    caption: Optional[str] = None
