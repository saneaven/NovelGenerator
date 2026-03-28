from __future__ import annotations

from typing import Any
from uuid import UUID

from .normalize import normalize_tree
from .types import ImageRef


def extract_image_refs(
    tree: Any,
    *,
    object_type: str,
    object_id: UUID,
    language: str,
    field_name: str,
) -> list[ImageRef]:
    doc = normalize_tree(tree)
    refs: list[ImageRef] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if str(node.get("type") or "") == "image":
            attrs = node.get("attrs") or {}
            raw_asset_id = str(attrs.get("assetId") or "").strip()
            if raw_asset_id:
                try:
                    asset_id = UUID(raw_asset_id)
                except Exception:
                    asset_id = None
                if asset_id is not None:
                    refs.append(
                        ImageRef(
                            asset_id=asset_id,
                            position=len(refs),
                            object_type=object_type,
                            object_id=object_id,
                            language=language,
                            field_name=field_name,
                        )
                    )
            return
        for child in node.get("content") or []:
            walk(child)

    walk(doc)
    return refs
