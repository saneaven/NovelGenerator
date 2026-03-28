from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, TypedDict
from uuid import UUID


class ContentMark(TypedDict, total=False):
    type: Literal["bold", "italic", "strike", "code", "link"]
    attrs: dict[str, Any]


class ContentNode(TypedDict, total=False):
    type: str
    attrs: dict[str, Any]
    content: list["ContentNode"]
    text: str
    marks: list[ContentMark]


ContentTreeDoc = ContentNode


@dataclass(frozen=True)
class ImageRef:
    asset_id: UUID
    position: int
    object_type: str
    object_id: UUID
    language: str
    field_name: str
