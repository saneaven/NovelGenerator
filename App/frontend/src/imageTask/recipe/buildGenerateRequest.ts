import type { StyledPrompt } from '../../api/assetService';
import type { ImageTaskBinding, ImageTaskInput, ReferenceImageRef } from '../types';

export type GenerateRequestBody = {
  provider: string;
  model: string;
  size?: string;

  // Natural prompt
  prompt?: StyledPrompt;
  // Tag-based prompt
  positive_prompt?: StyledPrompt;
  negative_prompt?: StyledPrompt;

  provider_settings?: Record<string, unknown>;
  reference_images?: Array<{ asset_id: string; strength: number }>;

  asset_type?: 'scene' | 'object' | 'cover';
};

function bindingToQuery(binding: ImageTaskBinding): string {
  if (binding.type === 'scene') {
    return `manuscript_id=${encodeURIComponent(binding.manuscriptId)}`;
  }
  return `object_type=${encodeURIComponent(binding.objectType)}&object_id=${encodeURIComponent(binding.objectId)}`;
}

function refsToRequest(refs?: ReferenceImageRef[]): Array<{ asset_id: string; strength: number }> | undefined {
  if (!refs || refs.length === 0) return undefined;
  return refs.map((r) => ({ asset_id: r.assetId, strength: r.strength }));
}

export function buildGenerateRequest(
  input: ImageTaskInput
): { url: string; body: GenerateRequestBody } {
  const { projectId, binding, recipe } = input;
  const qs = bindingToQuery(binding);
  const url = `/api/v1/assets/${projectId}/generate?${qs}`;

  const base: GenerateRequestBody = {
    provider: recipe.provider,
    model: recipe.model,
    size: recipe.size,
    provider_settings: recipe.providerSettings,
    reference_images: refsToRequest(recipe.referenceImages),
    asset_type: binding.type === 'scene' ? 'scene' : 'object',
  };

  if (recipe.promptType === 'natural') {
    return { url, body: { ...base, prompt: recipe.prompt } };
  }

  return { url, body: { ...base, positive_prompt: recipe.positive, negative_prompt: recipe.negative } };
}
