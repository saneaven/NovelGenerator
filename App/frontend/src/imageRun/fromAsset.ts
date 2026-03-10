import type { Asset } from '../api/assetService';
import type { ImageGenerationRecipe, ReferenceImageRef } from './types';

function inferAspectRatio(asset: Asset): string {
  if (!asset.width || !asset.height) return '1:1';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(asset.width, asset.height) || 1;
  return `${Math.floor(asset.width / divisor)}:${Math.floor(asset.height / divisor)}`;
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
  const aspectRatio = inferAspectRatio(asset);
  const imageSize = '1K';

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
      styleId: null,
      referenceImages,
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
      styleId: null,
      referenceImages,
    };
  }

  return null;
}
