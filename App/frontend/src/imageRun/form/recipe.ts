import type { StyledPrompt } from '../../api/assetService';
import type { NovelAICharacterPrompt } from '../../domain/imagePrompt';
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
    promptFormat: 'natural',
    provider: input.provider,
    model: input.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    promptData: { prompt: input.prompt },
    providerSettings: input.providerSettings,
    styleId: input.styleId ?? null,
    referenceImages: input.referenceImages,
    maskImage: input.maskImage,
  };
}

export function buildPositiveNegativeImageRecipe(
  input: CommonRecipeInput & {
    positive: StyledPrompt;
    negative: StyledPrompt;
  },
): ImageGenerationRecipe {
  return {
    promptFormat: 'positive_negative',
    provider: input.provider,
    model: input.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    promptData: {
      positive: input.positive,
      negative: input.negative,
    },
    providerSettings: input.providerSettings,
    styleId: input.styleId ?? null,
    referenceImages: input.referenceImages,
    maskImage: input.maskImage,
  };
}

export function buildNovelAIImageRecipe(
  input: CommonRecipeInput & {
    positive: StyledPrompt;
    negative: StyledPrompt;
    characters: NovelAICharacterPrompt[];
  },
): ImageGenerationRecipe {
  return {
    promptFormat: 'novelai',
    provider: input.provider,
    model: input.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    promptData: {
      positive: input.positive,
      negative: input.negative,
      characters: input.characters,
    },
    providerSettings: input.providerSettings,
    styleId: input.styleId ?? null,
    referenceImages: input.referenceImages,
    maskImage: input.maskImage,
  };
}
