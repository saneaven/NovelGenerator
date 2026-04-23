import type { Asset } from '../api/assetService';
import type { ImageGenerationRecipe, ReferenceImageRef } from './types';

function mapReferenceImages(asset: Asset): ReferenceImageRef[] | undefined {
  const refs = asset.generation_reference_images;
  if (!refs || refs.length === 0) return undefined;
  return refs.map((r) => ({ assetId: r.asset_id, strength: r.strength }));
}

function mapMaskImage(asset: Asset): { assetId: string } | undefined {
  const mask = asset.generation_mask_image;
  if (!mask || !mask.asset_id) return undefined;
  return { assetId: mask.asset_id };
}

export function recipeFromAsset(asset: Asset): ImageGenerationRecipe | null {
  const provider = asset.generation_provider;
  const model = asset.generation_model;
  const aspectRatio = asset.generation_requested_aspect_ratio;
  const imageSize = asset.generation_requested_image_size;
  if (!provider || !model || !aspectRatio || !imageSize) return null;

  const providerSettings = asset.generation_settings ?? undefined;
  const referenceImages = mapReferenceImages(asset);
  const maskImage = mapMaskImage(asset);
  const styleId = asset.generation_style_id ?? null;

  if (asset.generation_positive_prompt) {
    return {
      promptType: 'tag_based',
      provider,
      model,
      aspectRatio,
      imageSize,
      positive: asset.generation_positive_prompt,
      negative: asset.generation_negative_prompt ?? undefined,
      providerSettings,
      styleId,
      referenceImages,
      maskImage,
    };
  }

  if (asset.generation_prompt) {
    return {
      promptType: 'natural',
      provider,
      model,
      aspectRatio,
      imageSize,
      prompt: asset.generation_prompt,
      providerSettings,
      styleId,
      referenceImages,
      maskImage,
    };
  }

  return null;
}
