"""Pydantic schemas for asset management"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime


# ============================================================================
# IMAGE GENERATION
# ============================================================================

class StyledPrompt(BaseModel):
    """Structured prompt with style components"""
    prefix: str = ""
    content: str = ""
    postfix: str = ""


class ReferenceImage(BaseModel):
    """Reference image for image-to-image generation"""
    asset_id: str
    strength: float = 0.7  # How much to use this reference (0-1)


class ReferenceObject(BaseModel):
    """Reference object used during generation (stored in metadata)"""
    id: str
    type: str  # 'character', 'location', 'organization', 'lorebook'
    name: str


class ImageRunRecipe(BaseModel):
    prompt_type: Literal["natural", "tag_based"]
    provider: str
    model: str
    requested_aspect_ratio: str
    requested_image_size: str
    style_id: Optional[str] = None
    prompt: Optional[StyledPrompt] = None
    positive_prompt: Optional[StyledPrompt] = None
    negative_prompt: Optional[StyledPrompt] = None
    provider_settings: Optional[Dict[str, Any]] = None
    reference_images: Optional[List[ReferenceImage]] = None
    reference_objects: Optional[List[ReferenceObject]] = None


class ImageRunTarget(BaseModel):
    type: Literal["object", "scene"]
    manuscript_id: Optional[str] = None
    object_type: Optional[str] = None
    object_id: Optional[str] = None


class CreateImageRunRequest(BaseModel):
    client_request_id: Optional[str] = None
    recipe: ImageRunRecipe
    target: ImageRunTarget


class ImageRunDecisionRequest(BaseModel):
    decision: Literal["accept", "reject"]


class ImageRunResponse(BaseModel):
    id: str
    project_id: str
    user_id: str
    thread_id: Optional[str] = None
    tool_call_id: Optional[str] = None
    client_request_id: Optional[str] = None
    origin: Literal["direct", "tool_preview"]
    review_mode: Literal["auto", "manual"]
    status: Literal["queued", "running", "review", "applying", "applied", "rejected", "failed", "canceled"]
    stage: Optional[Literal["preparing", "generating", "saving", "binding"]] = None
    request_snapshot: Dict[str, Any]
    preview_asset_id: Optional[str] = None
    preview_asset_url: Optional[str] = None
    final_asset_id: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    requested_aspect_ratio: Optional[str] = None
    requested_image_size: Optional[str] = None
    resolved_aspect_ratio: Optional[str] = None
    resolved_image_size: Optional[str] = None
    resolved_native_size: Optional[str] = None
    revised_prompt: Optional[str] = None
    before_excerpt: Optional[str] = None
    after_excerpt: Optional[str] = None
    failure_code: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ImageRunListResponse(BaseModel):
    items: List[ImageRunResponse]


class ImageProviderInfo(BaseModel):
    """Information about an image provider"""
    name: str
    display_name: str
    prompt_type: str = "natural"  # 'natural' or 'tag_based'
    settings_schema: Optional[Dict[str, Any]] = None  # Provider-specific settings schema
    supports_image_input: bool = False  # Whether provider supports image-to-image generation


class ImageProvidersResponse(BaseModel):
    """Response listing available image providers"""
    providers: List[ImageProviderInfo]


class ImageModelInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    canonical_slug: Optional[str] = None
    prompt_type: Literal["natural", "tag_based"]
    supports_image_input: bool = False
    supported_aspect_ratios: List[str]
    supported_image_sizes: List[str]
    default_aspect_ratio: str
    default_image_size: str
    ui_resolution_mode: Literal["native_tier", "translated_fixed"]
    architecture: Optional[Dict[str, Any]] = None
    pricing: Optional[Dict[str, Any]] = None


class ImageModelsResponse(BaseModel):
    """Response listing available models for a provider"""
    data: List[ImageModelInfo]


# ============================================================================
# ASSETS
# ============================================================================


class AssetUsage(BaseModel):
    usage_type: Literal["rich_text", "object_main", "generation_reference"]
    object_type: str
    object_id: str
    object_name: str
    field_name: Optional[str] = None
    language: Optional[str] = None

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
    mime_type: str
    asset_type: Optional[str] = None  # 'scene', 'object', or null
    manuscript_id: Optional[str] = None  # Ownership for scene assets
    # Structured prompts (StyledPrompt with prefix/content/postfix)
    generation_prompt: Optional[StyledPrompt] = None  # Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt: Optional[StyledPrompt] = None  # Positive prompt for tag-based (NovelAI)
    generation_negative_prompt: Optional[StyledPrompt] = None  # Negative prompt for tag-based (NovelAI)
    generation_provider: Optional[str] = None
    generation_model: Optional[str] = None
    generation_style_id: Optional[str] = None
    generation_settings: Optional[Dict[str, Any]] = None  # Provider-specific settings
    generation_reference_images: Optional[List[ReferenceImage]] = None  # Reference images used during generation
    generation_reference_objects: Optional[List[Dict[str, Any]]] = None  # Project objects referenced
    width: Optional[int] = None
    height: Optional[int] = None
    file_size: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    # URL for frontend access
    file_url: str
    markdown_alt: Optional[str] = None
    usages: List["AssetUsage"] = Field(default_factory=list)

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
# OBJECT ASSET LINKS
# ============================================================================


class ObjectAssetLinkResponse(BaseModel):
    """Response for an object asset link."""
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


class ObjectAssetLinksResponse(BaseModel):
    """Response for listing object asset links."""
    assets: List[ObjectAssetLinkResponse]
    main_asset: Optional[ObjectAssetLinkResponse] = None


class SetMainAssetRequest(BaseModel):
    """Request to set the main asset for an object."""
    asset_id: str


# ============================================================================
# SCENE ASSETS (Usage is derived from rich_text_image_refs)
# ============================================================================

class ManuscriptInfo(BaseModel):
    """Minimal manuscript info for usage display"""
    id: str
    name: str  # Chapter name
    act_name: Optional[str] = None


class SceneAssetResponse(BaseModel):
    """Scene asset with manuscript usage information"""
    id: str
    project_id: str
    name: str
    file_path: str
    mime_type: str
    asset_type: Optional[str] = None
    manuscript_id: Optional[str] = None  # Ownership - which manuscript this belongs to
    # Structured prompts (StyledPrompt with prefix/content/postfix)
    generation_prompt: Optional[StyledPrompt] = None
    generation_positive_prompt: Optional[StyledPrompt] = None
    generation_negative_prompt: Optional[StyledPrompt] = None
    generation_provider: Optional[str] = None
    generation_model: Optional[str] = None
    generation_style_id: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    file_size: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    file_url: str
    markdown_alt: Optional[str] = None
    usages: List["AssetUsage"] = Field(default_factory=list)
    usage_count: int = 0

    class Config:
        from_attributes = True


class SceneAssetsResponse(BaseModel):
    """Response for listing scene assets with usage info"""
    assets: List[SceneAssetResponse]
    total: int


# ============================================================================
# IMAGE CLEANUP
# ============================================================================

class ImageCleanupPolicy(BaseModel):
    """Policy for selecting candidate assets for cleanup"""
    delete_non_main_object_images: bool = False
    delete_unused_rich_text_images: bool = True

    keep_recent_days: int = 7  # 0 disables

    # If true, assets referenced by other assets' generation_reference_images are treated as "used"
    treat_reference_images_as_used: bool = True


class ImageCleanupPreviewItem(BaseModel):
    asset_id: str
    name: str
    asset_type: Optional[str] = None
    manuscript_id: Optional[str] = None
    created_at: datetime
    file_size: Optional[int] = None
    file_url: str
    reasons: List[str] = []
    referenced_by_count: int = 0


class ImageCleanupPreviewResponse(BaseModel):
    candidates: List[ImageCleanupPreviewItem]
    total_candidates: int
    total_size_bytes: int


class ImageCleanupExecuteRequest(BaseModel):
    policy: ImageCleanupPolicy
    asset_ids: List[str]


class ImageCleanupExecuteSkipped(BaseModel):
    asset_id: str
    reason: str


class ImageCleanupExecuteError(BaseModel):
    asset_id: str
    error: str


class ImageCleanupExecuteResponse(BaseModel):
    deleted: List[str]
    skipped: List[ImageCleanupExecuteSkipped] = []
    errors: List[ImageCleanupExecuteError] = []
    scrubbed_reference_entries: int = 0


class RebuildRichTextImageRefsResponse(BaseModel):
    objects_processed: int
    languages_processed: int
    refs_deleted: int
    refs_inserted: int
