from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from ..models.requests import ProviderConfig


class RagEmbeddingProfileResponse(BaseModel):
    provider: str
    model: str
    dimensions: Optional[int] = None


class RagProjectStatusResponse(BaseModel):
    enabled: bool = False
    profile: Optional[RagEmbeddingProfileResponse] = None
    total_sources: int = 0
    ready_sources: int = 0
    missing_main_language_sources: int = 0
    error_sources: int = 0
    last_indexed_at: Optional[str] = None


class RagIndexObjectRequest(BaseModel):
    object_type: str = Field(..., min_length=1, max_length=50)
    object_id: UUID
    force: bool = False
    config: ProviderConfig = Field(default_factory=ProviderConfig)


class RagDeleteObjectRequest(BaseModel):
    object_type: str = Field(..., min_length=1, max_length=50)
    object_id: UUID


class RagReindexRequest(BaseModel):
    force: bool = False
    config: ProviderConfig = Field(default_factory=ProviderConfig)


class RagReindexResponse(BaseModel):
    indexed_sources: int
    rebuilt_sources: int
    skipped_sources: int
    missing_main_language_sources: int


class RagSearchRequest(BaseModel):
    queries: List[str] = Field(..., min_length=1)
    top_k_per_query: int = Field(default=20, ge=1, le=200)
    neighbor_window: int = Field(default=0, ge=0, le=10)
    config: ProviderConfig = Field(default_factory=ProviderConfig)


class RagSearchResult(BaseModel):
    chunk_id: UUID
    source_id: UUID
    object_type: str
    object_id: UUID

    type_group: str
    story_object_type: Optional[str] = None
    story_object_order: Optional[int] = None
    outline_order: Optional[int] = None
    act_order: Optional[int] = None
    chapter_order: Optional[int] = None
    chapter_id: Optional[UUID] = None

    field_path: str
    chunk_index: int
    text: str

    distance: Optional[float] = None


class RagSearchResponse(BaseModel):
    results: List[RagSearchResult]


class RagKeywordSearchResponse(BaseModel):
    keyword: str = Field(..., min_length=1)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    total: int = Field(default=0, ge=0)
    results: List[RagSearchResult]
