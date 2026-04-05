"""Migrate rich text storage to ContentTree and rich_text_image_refs."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import UUID, uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Session

from models.db_models import (
    Asset,
    BasicInfo,
    Guidelines,
    Manuscript,
    Outline,
    ProjectStorageUsage,
    RichTextImageRef,
    StoryEntity,
)
from models.translation_models import ObjectVersion
from services.asset_markdown import build_markdown_image_alt
from services.rich_text import (
    empty_doc,
    extract_image_refs,
    get_rich_text_fields,
    markdown_to_tree,
    normalize_tree,
    tiptap_to_tree,
    word_count,
)
from services.storage_service import storage_service


revision = "0006_content_tree_rich_text"
down_revision = "0005_timeline"
branch_labels = None
depends_on = None


def _public_asset_url(storage_key: str) -> str:
    return storage_service.build_public_asset_path(storage_key)


def _is_uuid_stem_internal_src(src: str) -> str | None:
    parsed = urlparse(str(src or ""))
    path = parsed.path or str(src or "")
    if not path.startswith("/storage/assets/originals/"):
        return None
    stem = Path(path).stem
    try:
        return str(UUID(stem))
    except Exception:
        return None


def _rewrite_asset_storage(asset: Asset) -> tuple[str, str]:
    old_storage_key = str(asset.file_path or "").strip()
    if not old_storage_key:
        raise ValueError(f"Asset {asset.id} is missing file_path")

    new_storage_key = f"originals/{asset.id}.avif"
    old_public_src = _public_asset_url(old_storage_key)

    if old_storage_key != new_storage_key:
        image_bytes = storage_service.read_asset_file(old_storage_key)
        saved_key, mime_type, width, height, file_size = storage_service.save_generated_image_from_url(
            image_bytes=image_bytes,
            project_id=asset.project_id,
            asset_id=asset.id,
            format="png",
        )
        asset.file_path = saved_key
        asset.mime_type = mime_type
        asset.width = width
        asset.height = height
        asset.file_size = file_size
        storage_service.delete_asset_files(old_storage_key)
    else:
        asset.file_path = new_storage_key

    return old_public_src, _public_asset_url(str(asset.file_path))


def _rewrite_tree_images(
    node: Any,
    *,
    old_src_to_asset_id: dict[str, str],
    asset_by_id: dict[str, Asset],
    new_src_by_asset_id: dict[str, str],
) -> Any:
    if not isinstance(node, dict):
        return node

    next_node = dict(node)
    attrs = next_node.get("attrs")
    if str(next_node.get("type") or "") == "image" and isinstance(attrs, dict):
        next_attrs = dict(attrs)
        src = str(next_attrs.get("src") or "").strip()
        asset_id = str(next_attrs.get("assetId") or "").strip() or None
        if asset_id is None and src:
            asset_id = old_src_to_asset_id.get(src) or _is_uuid_stem_internal_src(src)

        if asset_id and asset_id in asset_by_id:
            next_attrs["assetId"] = asset_id
            next_attrs["src"] = new_src_by_asset_id.get(asset_id, src)
            if not str(next_attrs.get("alt") or "").strip():
                generated_alt = build_markdown_image_alt(asset_by_id[asset_id])
                if generated_alt:
                    next_attrs["alt"] = generated_alt
        else:
            next_attrs.pop("assetId", None)
        next_node["attrs"] = next_attrs

    content = next_node.get("content")
    if isinstance(content, list):
        next_node["content"] = [
            _rewrite_tree_images(
                child,
                old_src_to_asset_id=old_src_to_asset_id,
                asset_by_id=asset_by_id,
                new_src_by_asset_id=new_src_by_asset_id,
            )
            for child in content
        ]
    return next_node


def _coerce_markdown_tree(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return normalize_tree(value)
    if value is None:
        return empty_doc()
    return markdown_to_tree(str(value))


def _rewrite_rich_tree(
    tree: Any,
    *,
    old_src_to_asset_id: dict[str, str],
    asset_by_id: dict[str, Asset],
    new_src_by_asset_id: dict[str, str],
) -> dict[str, Any]:
    normalized = normalize_tree(tree)
    rewritten = _rewrite_tree_images(
        normalized,
        old_src_to_asset_id=old_src_to_asset_id,
        asset_by_id=asset_by_id,
        new_src_by_asset_id=new_src_by_asset_id,
    )
    return normalize_tree(rewritten)


def _rewrite_version_language_blob(
    *,
    object_type: str,
    lang_blob: dict[str, Any],
    old_src_to_asset_id: dict[str, str],
    asset_by_id: dict[str, Asset],
    new_src_by_asset_id: dict[str, str],
) -> dict[str, Any]:
    current = dict(lang_blob or {})

    if object_type == "manuscript":
        if isinstance(current.get("content"), dict):
            tree = normalize_tree(current.get("content"))
        elif isinstance(current.get("content"), str):
            tree = markdown_to_tree(current.get("content"))
        else:
            tree = tiptap_to_tree(current.get("doc"))
        tree = _rewrite_rich_tree(
            tree,
            old_src_to_asset_id=old_src_to_asset_id,
            asset_by_id=asset_by_id,
            new_src_by_asset_id=new_src_by_asset_id,
        )
        return {"content": tree, "wordCount": int(word_count(tree))}

    if object_type == "guidelines":
        tree = _coerce_markdown_tree(current.get("authorNote"))
        tree = _rewrite_rich_tree(
            tree,
            old_src_to_asset_id=old_src_to_asset_id,
            asset_by_id=asset_by_id,
            new_src_by_asset_id=new_src_by_asset_id,
        )
        return {"authorNote": tree}

    if object_type in {"story_entity", "outline"}:
        tree = _coerce_markdown_tree(current.get("content"))
        tree = _rewrite_rich_tree(
            tree,
            old_src_to_asset_id=old_src_to_asset_id,
            asset_by_id=asset_by_id,
            new_src_by_asset_id=new_src_by_asset_id,
        )
        return {
            "name": str(current.get("name") or ""),
            "description": str(current.get("description") or ""),
            "content": tree,
        }

    return current


def _load_project_ids(session: Session) -> dict[tuple[str, UUID], UUID]:
    mapping: dict[tuple[str, UUID], UUID] = {}

    for row_id, project_id in session.query(BasicInfo.id, BasicInfo.project_id).all():
        mapping[("basic_info", row_id)] = project_id
    for row_id, project_id in session.query(Guidelines.id, Guidelines.project_id).all():
        mapping[("guidelines", row_id)] = project_id
    for row_id, project_id in session.query(StoryEntity.id, StoryEntity.project_id).all():
        mapping[("story_entity", row_id)] = project_id
    for row_id, project_id in session.query(Outline.id, Outline.project_id).all():
        mapping[("outline", row_id)] = project_id
    for manuscript_id, project_id in (
        session.query(Manuscript.id, Outline.project_id)
        .join(Outline, Outline.id == Manuscript.chapter_id)
        .all()
    ):
        mapping[("manuscript", manuscript_id)] = project_id

    return mapping


def _rebuild_rich_text_refs_for_object(
    session: Session,
    *,
    project_id: UUID,
    object_type: str,
    object_id: UUID,
    language: str,
    version_data: dict[str, Any],
) -> None:
    (
        session.query(RichTextImageRef)
        .filter(
            RichTextImageRef.object_type == object_type,
            RichTextImageRef.object_id == object_id,
            RichTextImageRef.language == language,
        )
        .delete(synchronize_session=False)
    )

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
            session.add(
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


def upgrade() -> None:
    op.create_table(
        "rich_text_image_refs",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("project_id", PG_UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_type", sa.String(length=50), nullable=False),
        sa.Column("object_id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column("language", sa.String(length=50), nullable=False),
        sa.Column("field_name", sa.String(length=100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("asset_id", PG_UUID(as_uuid=True), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rich_text_image_refs_project_asset", "rich_text_image_refs", ["project_id", "asset_id"])
    op.create_index(
        "ix_rich_text_image_refs_object_lang_field",
        "rich_text_image_refs",
        ["object_type", "object_id", "language", "field_name"],
    )
    op.create_index("ix_rich_text_image_refs_project_object", "rich_text_image_refs", ["project_id", "object_type"])

    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        assets = session.query(Asset).order_by(Asset.created_at.asc()).all()
        asset_by_id = {str(asset.id): asset for asset in assets}
        old_src_to_asset_id: dict[str, str] = {}
        new_src_by_asset_id: dict[str, str] = {}

        for asset in assets:
            old_public_src, new_public_src = _rewrite_asset_storage(asset)
            old_src_to_asset_id[old_public_src] = str(asset.id)
            new_src_by_asset_id[str(asset.id)] = new_public_src
        session.flush()

        latest_by_object: dict[tuple[str, UUID], ObjectVersion] = {}
        versions = (
            session.query(ObjectVersion)
            .order_by(ObjectVersion.object_type.asc(), ObjectVersion.object_id.asc(), ObjectVersion.version_number.asc())
            .all()
        )
        for version in versions:
            version_data = version.data if isinstance(version.data, dict) else {}
            rewritten_data: dict[str, Any] = {}
            for language, lang_blob in version_data.items():
                if not isinstance(lang_blob, dict):
                    continue
                rewritten_data[language] = _rewrite_version_language_blob(
                    object_type=str(version.object_type),
                    lang_blob=lang_blob,
                    old_src_to_asset_id=old_src_to_asset_id,
                    asset_by_id=asset_by_id,
                    new_src_by_asset_id=new_src_by_asset_id,
                )
            version.data = rewritten_data
            latest_by_object[(str(version.object_type), version.object_id)] = version
        session.flush()

        project_ids = _load_project_ids(session)
        for (object_type, object_id), version in latest_by_object.items():
            project_id = project_ids.get((object_type, object_id))
            if project_id is None or not isinstance(version.data, dict):
                continue
            for language, lang_blob in version.data.items():
                if not isinstance(lang_blob, dict):
                    continue
                if not get_rich_text_fields(object_type):
                    continue
                _rebuild_rich_text_refs_for_object(
                    session,
                    project_id=project_id,
                    object_type=object_type,
                    object_id=object_id,
                    language=language,
                    version_data=lang_blob,
                )

        session.query(ProjectStorageUsage).update(
            {ProjectStorageUsage.needs_reconcile: True},
            synchronize_session=False,
        )
        session.flush()
        session.commit()
    finally:
        session.close()

    inspector = sa.inspect(bind)
    if inspector.has_table("manuscript_images"):
        op.drop_table("manuscript_images")


def downgrade() -> None:
    raise RuntimeError("0006_content_tree_rich_text is irreversible")
