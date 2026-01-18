from __future__ import annotations

import re
from urllib.parse import unquote
from uuid import UUID, uuid4

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models.db_models import Asset, ManuscriptImage


_STORAGE_PATH_PATTERN = re.compile(r"(?i)/storage/assets/([^\\s\\)\\\"\\'>]+)")


def extract_storage_paths_with_positions(content: str) -> list[tuple[str, int]]:
    """
    Extract referenced storage-relative paths from manuscript content.

    Examples matched:
      - /storage/assets/originals/xxx.png
      - http://host:port/storage/assets/originals/xxx.png

    Returns:
      - [(relative_path, position_in_content), ...]
        relative_path matches Asset.file_path / Asset.thumbnail_path (e.g. originals/..., thumbnails/...)
    """
    if not content:
        return []

    out: list[tuple[str, int]] = []
    for m in _STORAGE_PATH_PATTERN.finditer(content):
        raw = m.group(1)
        raw = raw.split("?")[0].split("#")[0]
        out.append((unquote(raw), int(m.start())))
    return out


def rebuild_manuscript_images_for_language(
    db: Session,
    project_id: UUID,
    manuscript_id: UUID,
    language: str,
    content: str,
) -> dict:
    """
    Rebuild the `manuscript_images` index for (manuscript_id, language) from the given content.

    Notes:
    - Intended to run on manual-save (create_new_version=true).
    - Only indexes images that resolve to a project-owned Asset (via file_path or thumbnail_path).
    - Best-effort ordering: uses the match's character offset in the content as `position`.
    """
    refs = extract_storage_paths_with_positions(content)
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

    paths: set[str] = {p for p, _pos in refs}

    asset_rows = (
        db.query(Asset.id, Asset.file_path, Asset.thumbnail_path)
        .filter(
            Asset.project_id == project_id,
            or_(Asset.file_path.in_(list(paths)), Asset.thumbnail_path.in_(list(paths))),
        )
        .all()
    )

    path_to_asset_id: dict[str, UUID] = {}
    for asset_id, file_path, thumb_path in asset_rows:
        if file_path:
            path_to_asset_id[str(file_path)] = asset_id
        if thumb_path:
            path_to_asset_id[str(thumb_path)] = asset_id

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
    for path, pos in refs:
        asset_id = path_to_asset_id.get(path)
        if not asset_id:
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
                display_width=400,
            )
        )
        inserted += 1

    return {"deleted": int(deleted), "inserted": int(inserted), "unresolved": int(unresolved)}
