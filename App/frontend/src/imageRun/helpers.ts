import type { ImageRun, StyledPrompt } from '../api/assetService';
import type { NovelAICharacterPrompt, PromptFormat } from '../domain/imagePrompt';
import type { ImageGenerationBinding, ImageGenerationRecipe, ReferenceImageRef } from './types';

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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStyledPrompt(value: unknown): StyledPrompt | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    prefix: typeof record.prefix === 'string' ? record.prefix : '',
    content: typeof record.content === 'string' ? record.content : '',
    postfix: typeof record.postfix === 'string' ? record.postfix : '',
  };
}

function readCharacters(value: unknown): NovelAICharacterPrompt[] | null {
  if (!Array.isArray(value)) return null;
  const characters: NovelAICharacterPrompt[] = [];
  for (const rawCharacter of value) {
    const character = readRecord(rawCharacter);
    if (!character || typeof character.positive !== 'string' || typeof character.negative !== 'string') {
      return null;
    }
    characters.push({ positive: character.positive, negative: character.negative });
  }
  return characters;
}

function readReferenceImages(value: unknown): ReferenceImageRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is { asset_id: string; strength?: unknown } => (
      !!item
      && typeof item === 'object'
      && !Array.isArray(item)
      && typeof (item as { asset_id?: unknown }).asset_id === 'string'
    ))
    .map((item) => ({ assetId: item.asset_id, strength: Number(item.strength ?? 0.7) }));
}

function readMaskImage(value: unknown): { assetId: string } | undefined {
  const mask = readRecord(value);
  return mask && typeof mask.asset_id === 'string' ? { assetId: mask.asset_id } : undefined;
}

export function generationRecipeFromImageRun(run: ImageRun): ImageGenerationRecipe | null {
  const recipe = readRecord(run.request_snapshot?.recipe);
  if (!recipe) return null;

  const promptFormat = recipe.prompt_format;
  const provider = recipe.provider;
  const model = recipe.model;
  if (!isPromptFormat(promptFormat) || typeof provider !== 'string' || typeof model !== 'string') return null;

  const aspectRatio = typeof recipe.requested_aspect_ratio === 'string' ? recipe.requested_aspect_ratio.trim() : '';
  const imageSize = typeof recipe.requested_image_size === 'string' ? recipe.requested_image_size.trim() : '';
  if (!aspectRatio || !imageSize) return null;

  const promptData = readRecord(recipe.prompt_data);
  if (!promptData) return null;

  const providerSettingsRecord = readRecord(recipe.provider_settings);
  const providerSettings = providerSettingsRecord && Object.keys(providerSettingsRecord).length > 0
    ? { ...providerSettingsRecord }
    : undefined;
  const common = {
    provider,
    model,
    aspectRatio,
    imageSize,
    providerSettings,
    styleId: typeof recipe.style_id === 'string' ? recipe.style_id : null,
    referenceImages: readReferenceImages(recipe.reference_images),
    maskImage: readMaskImage(recipe.mask_image),
  };

  if (promptFormat === 'natural') {
    const prompt = readStyledPrompt(promptData.prompt);
    return prompt ? { ...common, promptFormat, promptData: { prompt } } : null;
  }

  const positive = readStyledPrompt(promptData.positive);
  const negative = readStyledPrompt(promptData.negative);
  if (!positive || !negative) return null;
  if (promptFormat === 'positive_negative') {
    return { ...common, promptFormat, promptData: { positive, negative } };
  }

  const characters = readCharacters(promptData.characters);
  return characters
    ? { ...common, promptFormat, promptData: { positive, negative, characters } }
    : null;
}

function isPromptFormat(value: unknown): value is PromptFormat {
  return value === 'natural' || value === 'positive_negative' || value === 'novelai';
}

export function isTerminalImageRunStatus(status: ImageRun['status']): boolean {
  return status === 'applied' || status === 'rejected' || status === 'failed' || status === 'canceled';
}
