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

  const promptFormat = asset.generation_prompt_format;
  const promptData = asset.generation_prompt_data;
  if (!promptFormat || !promptData) return null;

  const common = {
    provider,
    model,
    aspectRatio,
    imageSize,
    providerSettings,
    styleId,
    referenceImages,
    maskImage,
  };
  if (promptFormat === 'natural' && 'prompt' in promptData) {
    return { ...common, promptFormat, promptData: { prompt: promptData.prompt } };
  }
  if (
    promptFormat === 'positive_negative'
    && 'positive' in promptData
    && 'negative' in promptData
  ) {
    return {
      ...common,
      promptFormat,
      promptData: { positive: promptData.positive, negative: promptData.negative },
    };
  }
  if (
    promptFormat === 'novelai'
    && 'positive' in promptData
    && 'negative' in promptData
    && 'characters' in promptData
  ) {
    return {
      ...common,
      promptFormat,
      promptData: {
        positive: promptData.positive,
        negative: promptData.negative,
        characters: promptData.characters,
      },
    };
  }
  return null;
}
