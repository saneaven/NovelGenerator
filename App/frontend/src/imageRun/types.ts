import type { StyledPrompt } from '../api/assetService';
import type { NovelAICharacterPrompt } from '../domain/imagePrompt';

export type ImageGenerationBinding =
  | { type: 'scene'; manuscriptId: string }
  | { type: 'object'; objectType: string; objectId: string };

export type ReferenceImageRef = {
  assetId: string;
  strength: number;
};

export type MaskImageRef = {
  assetId: string;
};

type CommonImageGenerationRecipe = {
  provider: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  providerSettings?: Record<string, unknown>;
  styleId?: string | null;
  referenceImages?: ReferenceImageRef[];
  maskImage?: MaskImageRef;
};

export type ImageGenerationRecipe = CommonImageGenerationRecipe & (
  | {
      promptFormat: 'natural';
      promptData: {
        prompt: StyledPrompt;
      };
    }
  | {
      promptFormat: 'positive_negative';
      promptData: {
        positive: StyledPrompt;
        negative: StyledPrompt;
      };
    }
  | {
      promptFormat: 'novelai';
      promptData: {
        positive: StyledPrompt;
        negative: StyledPrompt;
        characters: NovelAICharacterPrompt[];
      };
    }
);
