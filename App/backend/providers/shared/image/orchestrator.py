from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from .contracts import PreparedImageRequest, PreparedMaskImage, PreparedReferenceImage
from .request_validation import build_image_selection, build_prompt_payload
from ....models.db_models import Asset
from ...registry import create_image_adapter
from ....schemas.assets import ImageRunRecipe
from ....services.credential_service import credential_service
from ....services.image_model_catalog_service import image_model_catalog_service
from ....services.storage_service import storage_service


def _load_asset_bytes(
    db: Session,
    *,
    project_id: UUID,
    asset_id: str,
    field_name: str,
) -> bytes:
    asset = db.query(Asset).filter(
        Asset.id == UUID(str(asset_id)),
        Asset.project_id == project_id,
    ).first()
    if asset is None:
        raise ValueError(f"Unknown {field_name}: {asset_id}")
    raw_bytes = storage_service.read_asset_file(str(asset.file_path))
    return storage_service.to_png_bytes(raw_bytes)


async def prepare_image_request(
    db: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    raw_recipe: dict[str, Any],
) -> tuple[dict[str, Any], PreparedImageRequest, Any]:
    recipe = ImageRunRecipe.model_validate(raw_recipe)
    provider_config = credential_service.get_provider_config(db, user_id, recipe.provider)
    descriptor = await image_model_catalog_service.get_descriptor(
        provider=recipe.provider,
        model=recipe.model,
        provider_config=provider_config,
    )
    if descriptor is None:
        raise ValueError(f"Unknown image model '{recipe.model}' for provider '{recipe.provider}'")

    prompt_payload = build_prompt_payload(recipe, descriptor)
    selection = build_image_selection(recipe)
    resolved_geometry = await image_model_catalog_service.resolve_geometry(
        provider=selection.provider,
        model=selection.model,
        requested_aspect_ratio=selection.requested_aspect_ratio,
        requested_image_size=selection.requested_image_size,
        provider_config=provider_config,
    )

    raw_refs = recipe.reference_images or []
    if raw_refs and not descriptor.supports_image_input:
        raise ValueError("The selected model does not support reference images.")
    if len(raw_refs) > 1 and not descriptor.supports_multi_image_input:
        raise ValueError("The selected model supports only one input image.")

    reference_images: list[PreparedReferenceImage] = []
    for ref in raw_refs:
        image_bytes = _load_asset_bytes(
            db,
            project_id=project_id,
            asset_id=ref.asset_id,
            field_name="reference asset_id",
        )
        reference_images.append(
            PreparedReferenceImage(
                image_data=image_bytes,
                strength=float(ref.strength or 0.7),
            )
        )

    mask_image = recipe.mask_image
    prepared_mask: PreparedMaskImage | None = None
    if mask_image is not None:
        if not descriptor.supports_mask_input:
            raise ValueError("The selected model does not support mask input.")
        if not reference_images:
            raise ValueError("Add a reference image before using a mask.")
        image_bytes = _load_asset_bytes(
            db,
            project_id=project_id,
            asset_id=mask_image.asset_id,
            field_name="mask asset_id",
        )
        prepared_mask = PreparedMaskImage(image_data=image_bytes)

    prepared_request = PreparedImageRequest(
        provider=recipe.provider,
        model_descriptor=descriptor,
        prompt_payload=prompt_payload,
        resolved_geometry=resolved_geometry,
        reference_images=tuple(reference_images),
        mask_image=prepared_mask,
        provider_settings=selection.provider_settings,
    )
    sanitized_recipe = {
        **recipe.model_dump(),
        "model": descriptor.id,
        "requested_aspect_ratio": resolved_geometry.requested_aspect_ratio,
        "requested_image_size": resolved_geometry.requested_image_size,
        "provider_settings": selection.provider_settings or None,
    }
    adapter = create_image_adapter(recipe.provider, provider_config)
    return sanitized_recipe, prepared_request, adapter
