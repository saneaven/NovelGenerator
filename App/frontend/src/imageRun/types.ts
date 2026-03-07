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
      provider: 'openai' | 'gemini' | 'xai' | (string & {});
      model: string;
      prompt: StyledPrompt;
      size?: string;
      providerSettings?: Record<string, unknown>;
      styleId?: string | null;
      referenceImages?: ReferenceImageRef[];
    }
  | {
      promptType: 'tag_based';
      provider: 'novelai' | (string & {});
      model: string;
      positive: StyledPrompt;
      negative?: StyledPrompt;
      size: string;
      providerSettings?: Record<string, unknown>;
      styleId?: string | null;
      referenceImages?: ReferenceImageRef[];
    };
