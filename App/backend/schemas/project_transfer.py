"""Project export/import schemas (.nbproj)"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


ImageScope = Literal["used_only", "all", "manual"]


class ProjectExportOptions(BaseModel):
    include_images: bool = True
    image_scope: ImageScope = "used_only"
    include_non_main_story_object_images: bool = False
    treat_generation_reference_images_as_used: bool = True


class ProjectExportPreviewSummary(BaseModel):
    objects: int = 0
    assets_total: int = 0
    assets_selected: int = 0
    images_selected_bytes: int = 0


class ProjectExportPreviewAssetItem(BaseModel):
    asset_id: str
    name: str
    asset_type: Optional[str] = None
    file_size: Optional[int] = None
    file_url: str
    used: bool = False
    reasons: List[str] = []


class ProjectExportPreviewResponse(BaseModel):
    summary: ProjectExportPreviewSummary
    assets: List[ProjectExportPreviewAssetItem] = []
    default_selected_asset_ids: List[str] = []


class ProjectExportRequest(BaseModel):
    options: ProjectExportOptions
    asset_ids: Optional[List[str]] = Field(default=None, description="Required when options.image_scope='manual'")


class ProjectExportManifest(BaseModel):
    format_version: str
    exported_at: str
    app: dict
    project: dict
    options: ProjectExportOptions
    counts: dict


class ProjectImportReport(BaseModel):
    project_id: str
    imported_at: datetime
    assets_imported: int = 0
    objects_imported: int = 0
