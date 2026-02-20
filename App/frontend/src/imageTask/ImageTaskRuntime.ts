import apiClient, { ApiError } from '../api/client';
import { assetService, type Asset } from '../api/assetService';
import { useAssetStore } from '../store/assetStore';
import { generateTempId } from '../utils/tempId';
import { useImageTaskStore } from './store';
import type { ImageProgressStage, ImageTaskInput, ImageTaskSession } from './types';
import { buildGenerateRequest } from './recipe/buildGenerateRequest';

const abortControllers = new Map<string, AbortController>();
const handlersByTaskId = new Map<
  string,
  {
    onSuccess?: (result: { assetId: string; asset: Asset; revisedPrompt?: string }) => void;
    onError?: (error: Error) => void;
    onCancelled?: () => void;
    onFinally?: () => void;
  }
>();

function setStage(taskId: string, stage: ImageProgressStage, message: string) {
  useImageTaskStore.getState().updateSession(taskId, { status: 'running', progress: { stage, message } });
}

function upsertAssetIntoStore(asset: Asset) {
  useAssetStore.setState((state) => {
    const existingIndex = state.assets.findIndex((a) => a.id === asset.id);
    if (existingIndex >= 0) {
      const next = [...state.assets];
      next[existingIndex] = asset;
      return { assets: next };
    }
    return { assets: [asset, ...state.assets] };
  });
}

async function runTask(taskId: string) {
  const store = useImageTaskStore.getState();
  const session = store.sessions[taskId];
  if (!session) return;

  const handlers = handlersByTaskId.get(taskId);

  const controller = new AbortController();
  abortControllers.set(taskId, controller);

  try {
    const { projectId, binding } = session.input;

    setStage(taskId, 'preparing', 'Preparing...');

    const { url, body } = buildGenerateRequest(session.input, { notificationSourceRefId: taskId });

    setStage(taskId, 'generating', 'Generating...');
    const resp = await apiClient.post<{
      success: boolean;
      asset_id?: string;
      notification_id?: string;
      revised_prompt?: string;
      object_link?: any;
      error?: string;
    }>(url, body, undefined, { signal: controller.signal });

    if (!resp.success || !resp.asset_id) {
      throw new Error(resp.error ?? 'Image generation failed');
    }

    setStage(taskId, 'saving', 'Saving...');
    const asset = await assetService.getAsset(projectId, resp.asset_id);
    upsertAssetIntoStore(asset);

    setStage(taskId, 'binding', 'Binding...');

    const assetStore = useAssetStore.getState();
    if (binding.type === 'object') {
      // Best-effort refresh (server is source of truth)
      await assetStore.fetchStoryObjectAssets(projectId, binding.objectType, binding.objectId, true);
    } else {
      await assetStore.fetchSceneAssets(projectId, binding.manuscriptId);
    }

    useImageTaskStore.getState().updateSession(taskId, {
      status: 'success',
      progress: undefined,
      result: { assetId: asset.id, asset, revisedPrompt: resp.revised_prompt },
    });

    handlers?.onSuccess?.({ assetId: asset.id, asset, revisedPrompt: resp.revised_prompt });
  } catch (err) {
    // Abort -> cancelled
    if (controller.signal.aborted || (err instanceof ApiError && err.status === 0)) {
      useImageTaskStore.getState().updateSession(taskId, { status: 'cancelled', progress: undefined });
      handlers?.onCancelled?.();
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    useImageTaskStore.getState().updateSession(taskId, { status: 'error', error: message, progress: undefined });
    handlers?.onError?.(err instanceof Error ? err : new Error(message));
  } finally {
    abortControllers.delete(taskId);
    handlers?.onFinally?.();
    handlersByTaskId.delete(taskId);
  }
}

export const ImageTaskRuntime = {
  start(
    input: ImageTaskInput,
    handlers?: {
      onSuccess?: (result: { assetId: string; asset: Asset; revisedPrompt?: string }) => void;
      onError?: (error: Error) => void;
      onCancelled?: () => void;
      onFinally?: () => void;
    }
  ): { taskId: string } {
    // Use temp IDs because crypto.randomUUID() is not guaranteed in HTTP/mobile WebViews.
    const taskId = generateTempId();
    const now = Date.now();

    const session: ImageTaskSession = {
      id: taskId,
      input,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      progress: { stage: 'preparing', message: 'Preparing...' },
    };

    useImageTaskStore.getState().createSession(session);
    if (handlers) handlersByTaskId.set(taskId, handlers);

    void runTask(taskId);
    return { taskId };
  },

  cancel(taskId: string) {
    const controller = abortControllers.get(taskId);
    if (controller) controller.abort();
    abortControllers.delete(taskId);

    useImageTaskStore.getState().updateSession(taskId, { status: 'cancelled', progress: undefined });
  },

  retry(taskId: string) {
    const session = useImageTaskStore.getState().sessions[taskId];
    if (!session) return;
    ImageTaskRuntime.start(session.input);
  },
};

export default ImageTaskRuntime;
