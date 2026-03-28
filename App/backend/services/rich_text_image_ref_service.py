from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from ..models.db_models import RichTextImageRef
from .rich_text import extract_image_refs, get_rich_text_fields


def rebuild_rich_text_refs_for_object(
    db: Session,
    *,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
    version_data: dict[str, Any],
) -> dict[str, int]:
    deleted = (
        db.query(RichTextImageRef)
        .filter(
            RichTextImageRef.object_type == object_type,
            RichTextImageRef.object_id == object_id,
            RichTextImageRef.language == language,
        )
        .delete(synchronize_session=False)
    )

    inserted = 0
    fields = get_rich_text_fields(object_type)
    for field_name in fields:
        tree = version_data.get(field_name)
        if not isinstance(tree, dict):
            continue
        refs = extract_image_refs(
            tree,
            object_type=object_type,
            object_id=object_id,
            language=language,
            field_name=field_name,
        )
        for ref in refs:
            db.add(
                RichTextImageRef(
                    id=uuid4(),
                    project_id=project_id,
                    object_type=ref.object_type,
                    object_id=ref.object_id,
                    language=ref.language,
                    field_name=ref.field_name,
                    position=ref.position,
                    asset_id=ref.asset_id,
                )
            )
            inserted += 1
    return {"deleted": int(deleted), "inserted": int(inserted)}
