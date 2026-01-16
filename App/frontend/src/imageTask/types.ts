import type { Asset, StyledPrompt } from '../api/assetService';

export type ImageTaskStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';
export type ImageProgressStage = 'preparing' | 'generating' | 'saving' | 'binding';

export type ImageTaskProgress = {
  stage: ImageProgressStage;
  message: string;
};

export type ImageTaskBinding =
  | { type: 'scene'; manuscriptId: string }
  | { type: 'object'; objectType: string; objectId: string };

export type ReferenceImageRef = { assetId: string; strength: number };

export type GenerationRecipe =
  | {
      promptType: 'natural';
      provider: 'openai' | 'gemini' | 'xai' | (string & {});
      model: string;
      prompt: StyledPrompt;
      size?: string;
      providerSettings?: Record<string, unknown>;
      styleId?: string | null; // UI-only (rehydration hint); do not send to BE
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
      styleId?: string | null; // UI-only (rehydration hint); do not send to BE
      referenceImages?: ReferenceImageRef[];
    };

export type ImageTaskInput = {
  projectId: string;
  label?: string;
  binding: ImageTaskBinding; // REQUIRED
  recipe: GenerationRecipe; // REQUIRED
};

export type ImageTaskResult = {
  assetId: string;
  asset: Asset;
  revisedPrompt?: string;
};

export type ImageTaskSession = {
  id: string;
  input: ImageTaskInput;
  status: ImageTaskStatus;
  progress?: ImageTaskProgress;
  error?: string;
  result?: ImageTaskResult;
  createdAt: number;
  updatedAt: number;
};

