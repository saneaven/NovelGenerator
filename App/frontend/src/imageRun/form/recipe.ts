import type { StyledPrompt } from '../../api/assetService';
import type { ImageGenerationRecipe, ReferenceImageRef, MaskImageRef } from '../types';

interface CommonRecipeInput {
  provider: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  providerSettings?: Record<string, unknown>;
  styleId?: string | null;
  referenceImages?: ReferenceImageRef[];
  maskImage?: MaskImageRef;
}

export function buildNaturalImageRecipe(
  input: CommonRecipeInput & {
    prompt: StyledPrompt;
  },
): ImageGenerationRecipe {
  return {
    promptType: 'natural',
    provider: input.provider,
    model: input.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    prompt: input.prompt,
    providerSettings: input.providerSettings,
    styleId: input.styleId ?? null,
    referenceImages: input.referenceImages,
    maskImage: input.maskImage,
  };
}

export function buildTagBasedImageRecipe(
  input: CommonRecipeInput & {
    positive: StyledPrompt;
    negative?: StyledPrompt;
  },
): ImageGenerationRecipe {
  return {
    promptType: 'tag_based',
    provider: input.provider,
    model: input.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    positive: input.positive,
    negative: input.negative,
    providerSettings: input.providerSettings,
    styleId: input.styleId ?? null,
    referenceImages: input.referenceImages,
    maskImage: input.maskImage,
  };
}
