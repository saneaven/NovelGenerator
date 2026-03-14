import { assetService, type Asset, type CreateImageRunRequest, type ImageRun } from '../api/assetService';
import { useImageRunStore } from './store';
import { generateTempId } from '../utils/tempId';
import type { ImageGenerationBinding, ImageGenerationRecipe } from './types';
import { isTerminalImageRunStatus } from './helpers';

type ImageRunInput = {
  projectId: string;
  label?: string;
  binding: ImageGenerationBinding;
  recipe: ImageGenerationRecipe;
};

type ImageRunHandlers = {
  onSuccess?: (result: { assetId: string; asset: Asset; revisedPrompt?: string }) => void;
  onError?: (error: Error) => void;
  onCancelled?: () => void;
  onFinally?: () => void;
};

const handlersByRunId = new Map<string, { projectId: string; handlers: ImageRunHandlers }>();
const finalizedRunIds = new Set<string>();

function buildCreateImageRunRequest(input: ImageRunInput, clientRequestId: string): CreateImageRunRequest {
  const target = input.binding.type === 'scene'
    ? {
        type: 'scene' as const,
        manuscript_id: input.binding.manuscriptId,
      }
    : {
        type: 'object' as const,
        object_type: input.binding.objectType,
        object_id: input.binding.objectId,
      };

  const baseRecipe = {
    prompt_type: input.recipe.promptType,
    provider: input.recipe.provider,
    model: input.recipe.model,
    requested_aspect_ratio: input.recipe.aspectRatio,
    requested_image_size: input.recipe.imageSize,
    style_id: input.recipe.styleId ?? null,
    provider_settings: input.recipe.providerSettings,
    reference_images: input.recipe.referenceImages?.map((item) => ({
      asset_id: item.assetId,
      strength: item.strength,
    })),
    reference_objects: undefined,
  };

  const recipe = input.recipe.promptType === 'natural'
    ? {
        ...baseRecipe,
        prompt: input.recipe.prompt,
      }
    : {
        ...baseRecipe,
        positive_prompt: input.recipe.positive,
        negative_prompt: input.recipe.negative,
      };

  return {
    client_request_id: clientRequestId,
    recipe,
    target,
  };
}

async function handleTerminalRun(run: ImageRun): Promise<void> {
  if (!isTerminalImageRunStatus(run.status)) return;
  if (finalizedRunIds.has(run.id)) return;

  const registration = handlersByRunId.get(run.id);
  if (!registration) return;
  finalizedRunIds.add(run.id);
  handlersByRunId.delete(run.id);

  const { projectId, handlers } = registration;
  try {
    if (run.status === 'applied' && run.final_asset_id) {
      const asset = await assetService.getAsset(projectId, run.final_asset_id);
      handlers.onSuccess?.({
        assetId: asset.id,
        asset,
        revisedPrompt: run.revised_prompt ?? undefined,
      });
      return;
    }
    if (run.status === 'canceled' || run.status === 'rejected') {
      handlers.onCancelled?.();
      return;
    }
    handlers.onError?.(new Error(run.error_message || 'Image generation failed'));
  } finally {
    handlers.onFinally?.();
  }
}

export const ImageRunRuntime = {
  async start(input: ImageRunInput, handlers?: ImageRunHandlers): Promise<{ imageRunId: string }> {
    const clientRequestId = generateTempId();
    const run = await assetService.createImageRun(
      input.projectId,
      buildCreateImageRunRequest(input, clientRequestId),
    );
    useImageRunStore.getState().upsertRun(run);
    if (handlers) {
      handlersByRunId.set(run.id, { projectId: input.projectId, handlers });
    }
    await handleTerminalRun(run);
    return { imageRunId: run.id };
  },

  async cancel(projectId: string, imageRunId: string): Promise<void> {
    const run = await assetService.cancelImageRun(projectId, imageRunId);
    useImageRunStore.getState().upsertRun(run);
    await handleTerminalRun(run);
  },

  async handleUpdate(run: ImageRun): Promise<void> {
    useImageRunStore.getState().upsertRun(run);
    await handleTerminalRun(run);
  },
};

export type { ImageRunInput, ImageRunHandlers };
