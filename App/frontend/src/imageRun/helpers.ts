import type { ImageRun, StyledPrompt } from '../api/assetService';
import type { ImageGenerationBinding, ImageGenerationRecipe } from './types';

function simplifyRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${Math.floor(width / divisor)}:${Math.floor(height / divisor)}`;
}

function ratioFromSize(size?: string): string {
  const match = String(size ?? '').trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return '1:1';
  return simplifyRatio(Number(match[1]), Number(match[2]));
}

export function requestedRatioForRecipe(recipe: ImageGenerationRecipe): string {
  const explicitAspect = recipe.providerSettings?.aspect_ratio;
  if (typeof explicitAspect === 'string' && explicitAspect.trim()) {
    return explicitAspect.trim();
  }
  if (typeof recipe.size === 'string' && recipe.size.trim()) {
    return ratioFromSize(recipe.size);
  }
  return '1:1';
}

export function imageRunBindingFromSnapshot(run: ImageRun): ImageGenerationBinding | null {
  const target = run.request_snapshot?.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const record = target as Record<string, unknown>;
  if (record.type === 'scene' && typeof record.manuscript_id === 'string') {
    return { type: 'scene', manuscriptId: record.manuscript_id };
  }
  if (
    record.type === 'object'
    && typeof record.object_type === 'string'
    && typeof record.object_id === 'string'
  ) {
    return {
      type: 'object',
      objectType: record.object_type,
      objectId: record.object_id,
    };
  }
  return null;
}

export function generationRecipeFromImageRun(run: ImageRun): ImageGenerationRecipe | null {
  const snapshot = run.request_snapshot;
  const recipeValue = snapshot?.recipe;
  if (!recipeValue || typeof recipeValue !== 'object' || Array.isArray(recipeValue)) return null;
  const recipe = recipeValue as Record<string, unknown>;
  const promptType = recipe.prompt_type;
  const provider = recipe.provider;
  const model = recipe.model;
  const requestedRatio = typeof recipe.requested_ratio === 'string' && recipe.requested_ratio.trim()
    ? recipe.requested_ratio.trim()
    : undefined;
  const providerSettings = (
    recipe.provider_settings
    && typeof recipe.provider_settings === 'object'
    && !Array.isArray(recipe.provider_settings)
      ? { ...(recipe.provider_settings as Record<string, unknown>) }
      : {}
  );
  if (requestedRatio && typeof providerSettings.aspect_ratio !== 'string') {
    providerSettings.aspect_ratio = requestedRatio;
  }

  if (promptType === 'natural' && typeof provider === 'string' && typeof model === 'string') {
    const prompt = recipe.prompt;
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return null;
    return {
      promptType: 'natural',
      provider,
      model,
      prompt: prompt as StyledPrompt,
      size: run.resolved_size ?? undefined,
      providerSettings: Object.keys(providerSettings).length > 0 ? providerSettings : undefined,
      styleId: null,
      referenceImages: Array.isArray(recipe.reference_images)
        ? recipe.reference_images
            .filter((item): item is { asset_id: string; strength: number } => (
              !!item
              && typeof item === 'object'
              && !Array.isArray(item)
              && typeof (item as { asset_id?: unknown }).asset_id === 'string'
            ))
            .map((item) => ({ assetId: item.asset_id, strength: Number(item.strength ?? 0.7) }))
        : undefined,
    };
  }

  if (promptType === 'tag_based' && typeof provider === 'string' && typeof model === 'string') {
    const positive = recipe.positive_prompt;
    if (!positive || typeof positive !== 'object' || Array.isArray(positive)) return null;
    const negative = recipe.negative_prompt;
    return {
      promptType: 'tag_based',
      provider,
      model,
      positive: positive as StyledPrompt,
      negative: negative && typeof negative === 'object' && !Array.isArray(negative) ? (negative as StyledPrompt) : undefined,
      size: run.resolved_size ?? '1024x1024',
      providerSettings: Object.keys(providerSettings).length > 0 ? providerSettings : undefined,
      styleId: null,
      referenceImages: Array.isArray(recipe.reference_images)
        ? recipe.reference_images
            .filter((item): item is { asset_id: string; strength: number } => (
              !!item
              && typeof item === 'object'
              && !Array.isArray(item)
              && typeof (item as { asset_id?: unknown }).asset_id === 'string'
            ))
            .map((item) => ({ assetId: item.asset_id, strength: Number(item.strength ?? 0.7) }))
        : undefined,
    };
  }

  return null;
}

export function isTerminalImageRunStatus(status: ImageRun['status']): boolean {
  return status === 'applied' || status === 'rejected' || status === 'failed' || status === 'cancelled';
}
