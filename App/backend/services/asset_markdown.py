from __future__ import annotations

from typing import Any, Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.db_models import Asset
from .rich_text import get_rich_text_fields, normalize_tree


def build_markdown_image_alt(asset: Any) -> str | None:
    asset_id = str(getattr(asset, "id", "") or "").strip()
    return asset_id or None


def build_markdown_image_title(asset: Any) -> str:
    return str(getattr(asset, "name", "") or "").strip() or "Image"


def _collect_image_asset_ids(tree: Any, out: set[UUID]) -> None:
    doc = normalize_tree(tree)

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if str(node.get("type") or "") == "image":
            raw_asset_id = str((node.get("attrs") or {}).get("assetId") or "").strip()
            try:
                out.add(UUID(raw_asset_id))
            except (TypeError, ValueError):
                pass
            return
        for child in node.get("content") or []:
            walk(child)

    walk(doc)


def build_asset_title_map(
    db: Session,
    *,
    project_id: UUID,
    trees: Iterable[Any],
) -> dict[str, str]:
    asset_ids: set[UUID] = set()
    for tree in trees:
        _collect_image_asset_ids(tree, asset_ids)
    if not asset_ids:
        return {}

    rows = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.id.in_(asset_ids))
        .all()
    )
    return {
        str(row.id): str(row.name or "").strip() or "Image"
        for row in rows
    }


def build_payload_asset_title_map(
    db: Session,
    *,
    project_id: UUID,
    object_type: str,
    data: dict[str, Any],
) -> dict[str, str]:
    trees = [
        data.get(field_name)
        for field_name in get_rich_text_fields(object_type)
        if isinstance(data.get(field_name), dict)
    ]
    return build_asset_title_map(db, project_id=project_id, trees=trees)
