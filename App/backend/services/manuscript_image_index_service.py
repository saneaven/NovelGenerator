from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models.db_models import Asset, ManuscriptImage


def extract_asset_ids_with_positions(doc: Any) -> list[tuple[UUID, int, int | None]]:
    """
    Extract referenced Asset IDs from TipTap JSON doc.

    Only images with an explicit asset ID are considered "used".
    External images (no asset id) are intentionally ignored.

    Returns:
      - [(asset_id, position_index, width), ...]
        position_index is the 0-based order of appearance in the document.
    """
    if not isinstance(doc, dict):
        return []

    out: list[tuple[UUID, int, int | None]] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return

        if node.get("type") == "image":
            attrs = node.get("attrs")
            if not isinstance(attrs, dict):
                return

            raw_asset_id = attrs.get("data-asset-id") or attrs.get("assetId")
            if not raw_asset_id:
                return
            try:
                asset_id = UUID(str(raw_asset_id))
            except Exception:
                return

            raw_width = attrs.get("width")
            width = int(raw_width) if isinstance(raw_width, int) else None
            out.append((asset_id, len(out), width))
            return

        children = node.get("content")
        if isinstance(children, list):
            for child in children:
                walk(child)

    walk(doc)
    return out


def rebuild_manuscript_images_for_language(
    db: Session,
    project_id: UUID,
    manuscript_id: UUID,
    language: str,
    doc: Any,
) -> dict:
    """
    Rebuild the `manuscript_images` index for (manuscript_id, language) from the given doc.

    Notes:
    - Intended to run on manual-save (create_new_version=true).
    - Only indexes images that resolve to a project-owned Asset (via asset id).
    - Ordering: uses appearance order in the document as `position` (0-based index).
    """
    refs = extract_asset_ids_with_positions(doc)
    if not refs:
        deleted = (
            db.query(ManuscriptImage)
            .filter(
                ManuscriptImage.manuscript_id == manuscript_id,
                or_(ManuscriptImage.language == language, ManuscriptImage.language.is_(None)),
            )
            .delete(synchronize_session=False)
        )
        return {"deleted": int(deleted), "inserted": 0, "unresolved": 0}

    asset_ids: set[UUID] = {asset_id for asset_id, _pos, _w in refs}
    owned_asset_ids: set[UUID] = {
        row[0]
        for row in db.query(Asset.id).filter(Asset.project_id == project_id, Asset.id.in_(list(asset_ids))).all()
        if row and row[0]
    }

    deleted = (
        db.query(ManuscriptImage)
        .filter(
            ManuscriptImage.manuscript_id == manuscript_id,
            or_(ManuscriptImage.language == language, ManuscriptImage.language.is_(None)),
        )
        .delete(synchronize_session=False)
    )

    inserted = 0
    unresolved = 0
    for asset_id, pos, width in refs:
        if asset_id not in owned_asset_ids:
            unresolved += 1
            continue

        db.add(
            ManuscriptImage(
                id=uuid4(),
                manuscript_id=manuscript_id,
                language=language,
                position=pos,
                source_type="asset",
                asset_id=asset_id,
                display_width=int(width or 400),
            )
        )
        inserted += 1

    return {"deleted": int(deleted), "inserted": int(inserted), "unresolved": int(unresolved)}


def restore_image_asset_ids(new_doc: Any, original_doc: Any) -> Any:
    """
    Restore ``data-asset-id`` attributes lost during a markdown roundtrip.

    Standard markdown ``![alt](url)`` cannot represent custom HTML attributes,
    so converting doc → markdown → doc strips ``data-asset-id``.  This function
    re-attaches them by matching image ``src`` URLs between the original and new docs.

    Mutates *new_doc* in place and returns it.
    """
    if not isinstance(new_doc, dict) or not isinstance(original_doc, dict):
        return new_doc

    src_to_asset_id: dict[str, str] = {}

    def _extract(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "image":
            attrs = node.get("attrs") or {}
            src = attrs.get("src")
            asset_id = attrs.get("data-asset-id") or attrs.get("assetId")
            if src and asset_id:
                src_to_asset_id[src] = str(asset_id)
            return
        for child in node.get("content") or []:
            _extract(child)

    _extract(original_doc)

    if not src_to_asset_id:
        return new_doc

    def _restore(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "image":
            attrs = node.get("attrs")
            if isinstance(attrs, dict):
                src = attrs.get("src")
                if src and not (attrs.get("data-asset-id") or attrs.get("assetId")):
                    aid = src_to_asset_id.get(src)
                    if aid:
                        attrs["data-asset-id"] = aid
            return
        for child in node.get("content") or []:
            _restore(child)

    _restore(new_doc)
    return new_doc
