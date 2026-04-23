from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Protocol

from ..contracts import ImageModelDescriptor
from ....schemas.assets import StyledPrompt


@dataclass(frozen=True)
class ImagePromptPayload:
    prompt_type: str
    prompt: StyledPrompt | None = None
    positive_prompt: StyledPrompt | None = None
    negative_prompt: StyledPrompt | None = None
    style_id: str | None = None


@dataclass(frozen=True)
class ImageSelection:
    provider: str
    model: str
    requested_aspect_ratio: str
    requested_image_size: str
    provider_settings: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ResolvedGeometry:
    requested_aspect_ratio: str
    requested_image_size: str
    resolved_aspect_ratio: str
    resolved_image_size: str
    resolved_native_size: str


@dataclass(frozen=True)
class PreparedReferenceImage:
    image_data: bytes
    strength: float = 0.7
    mime_type: str = "image/png"


@dataclass(frozen=True)
class PreparedMaskImage:
    image_data: bytes
    mime_type: str = "image/png"


@dataclass(frozen=True)
class PreparedImageRequest:
    provider: str
    model_descriptor: ImageModelDescriptor
    prompt_payload: ImagePromptPayload
    resolved_geometry: ResolvedGeometry
    reference_images: tuple[PreparedReferenceImage, ...] = ()
    mask_image: PreparedMaskImage | None = None
    provider_settings: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ImageGenerationOutput:
    success: bool
    image_data: Optional[bytes] = None
    image_b64: Optional[str] = None
    image_url: Optional[str] = None
    revised_prompt: Optional[str] = None
    error: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format: str = "png"


class ImageGenerationAdapter(Protocol):
    async def generate(self, request: PreparedImageRequest) -> ImageGenerationOutput:
        ...
