import type { Asset } from '../api/assetService';
import type { ImageGenerationRecipe, ReferenceImageRef } from './types';

function inferSize(asset: Asset): string | undefined {
  if (asset.width && asset.height) return `${asset.width}x${asset.height}`;
  return undefined;
}

function mapReferenceImages(asset: Asset): ReferenceImageRef[] | undefined {
  const refs = asset.generation_reference_images;
  if (!refs || refs.length === 0) return undefined;
  return refs.map((r) => ({ assetId: r.asset_id, strength: r.strength }));
}

export function recipeFromAsset(asset: Asset): ImageGenerationRecipe | null {
  const provider = asset.generation_provider;
  const model = asset.generation_model;
  if (!provider || !model) return null;

  const providerSettings = asset.generation_settings ?? undefined;
  const referenceImages = mapReferenceImages(asset);
  const size = inferSize(asset);

  if (asset.generation_positive_prompt) {
    return {
      promptType: 'tag_based',
      provider,
      model,
      size: size ?? '1024x1024',
      positive: asset.generation_positive_prompt,
      negative: asset.generation_negative_prompt ?? undefined,
      providerSettings,
      styleId: null,
      referenceImages,
    };
  }

  if (asset.generation_prompt) {
    return {
      promptType: 'natural',
      provider,
      model,
      size,
      prompt: asset.generation_prompt,
      providerSettings,
      styleId: null,
      referenceImages,
    };
  }

  return null;
}
