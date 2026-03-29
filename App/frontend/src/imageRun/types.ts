import type { StyledPrompt } from '../api/assetService';

export type ImageGenerationBinding =
  | { type: 'scene'; manuscriptId: string }
  | { type: 'object'; objectType: string; objectId: string };

export type ReferenceImageRef = {
  assetId: string;
  strength: number;
};

export type ImageGenerationRecipe =
  | {
      promptType: 'natural';
      provider: string;
      model: string;
      aspectRatio: string;
      imageSize: string;
      prompt: StyledPrompt;
      providerSettings?: Record<string, unknown>;
      styleId?: string | null;
      referenceImages?: ReferenceImageRef[];
    }
  | {
      promptType: 'tag_based';
      provider: string;
      model: string;
      aspectRatio: string;
      imageSize: string;
      positive: StyledPrompt;
      negative?: StyledPrompt;
      providerSettings?: Record<string, unknown>;
      styleId?: string | null;
      referenceImages?: ReferenceImageRef[];
    };
