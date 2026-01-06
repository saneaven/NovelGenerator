/**
 * useImageGeneration Hook
 * Main interface for components to generate images
 */

import { useRef, useCallback, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useAssetStore } from '../../store/assetStore';
import { ImageRequestManager } from '../ImageRequestManager';
import { useImageTaskStore } from '../store/imageTaskStore';
import { getApiKey, type ProviderCredentials } from '../config/providerConfig';
import type {
    ImageGenerationRequest,
    ImageTaskType,
    ProcessedImageResult,
    ImagePipelineContext,
    ImageRetryContext,
} from '../types';

export interface UseImageGenerationOptions {
    taskType?: ImageTaskType;
    onComplete?: (result: ProcessedImageResult) => void;
    onError?: (error: Error) => void;
}

/**
 * Generate a temporary ID for task tracking
 */
function generateTaskId(): string {
    return `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function useImageGeneration(options: UseImageGenerationOptions = {}) {
    const { currentProjectId } = useProjectStore();
    const { settings } = useSettingsStore();

    const { startTask, updateProgress, completeTask, failTask, cancelTask, getTask } =
        useImageTaskStore();

    const abortControllerRef = useRef<AbortController | null>(null);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const managerRef = useRef<ImageRequestManager | null>(null);

    /**
     * Generate an image
     */
    const generate = useCallback(
        async (request: ImageGenerationRequest) => {
            if (!currentProjectId) {
                const error = new Error('No project selected');
                options.onError?.(error);
                throw error;
            }

            // Get API key for the provider
            const apiKey = getApiKey(
                request.provider,
                settings.providerCredentials as ProviderCredentials
            );
            if (!apiKey) {
                const error = new Error(`API key not configured for ${request.provider}`);
                options.onError?.(error);
                throw error;
            }

            // Create task ID
            const taskId = generateTaskId();
            setCurrentTaskId(taskId);

            // Build pipeline context
            const context: ImagePipelineContext = {
                projectId: currentProjectId,
                provider: request.provider,
                providerConfig: { apiKey },
                naturalStyles: settings.imageGenConfig.naturalStyles,
                tagBasedStyles: settings.imageGenConfig.tagBasedStyles,
                selectedNaturalStyleId: settings.imageGenConfig.selectedNaturalStyleId,
                selectedTagBasedStyleId: settings.imageGenConfig.selectedTagBasedStyleId,
            };

            // Build retry context for notification retry support
            const retryContext: ImageRetryContext = {
                request,
                projectId: currentProjectId,
                provider: request.provider,
                model: request.model,
                size: request.size,
                styleId: request.styleId,
            };

            // Start task in store with retry context
            startTask(taskId, options.taskType || 'object-image', 'Generating image...', retryContext);

            // Create manager
            managerRef.current = new ImageRequestManager(
                {
                    projectId: currentProjectId,
                    apiKey,
                    context,
                    abortControllerRef,
                },
                {
                    onProgress: (progress) => {
                        updateProgress(taskId, progress.stage, progress.message, progress.percentage);
                    },
                    onComplete: (result) => {
                        completeTask(taskId, {
                            assetId: result.asset?.id,
                            revisedPrompt: result.revisedPrompt,
                            thumbnailUrl: result.asset?.thumbnailUrl ?? undefined,
                        });

                        // Add asset to asset store for display
                        if (result.asset) {
                            // Transform to Asset format expected by assetStore
                            const manuscriptIdForAsset =
                                request.assetType === 'scene' ? request.manuscriptId ?? null : null;
                            const asset = {
                                id: result.asset.id,
                                project_id: result.asset.projectId,
                                manuscript_id: manuscriptIdForAsset,
                                name: result.asset.name,
                                file_path: result.asset.filePath,
                                thumbnail_path: result.asset.thumbnailPath,
                                mime_type: result.asset.mimeType,
                                asset_type: result.asset.assetType,
                                generation_prompt: result.asset.generationPrompt,
                                generation_positive_prompt: result.asset.generationPositivePrompt,
                                generation_negative_prompt: result.asset.generationNegativePrompt,
                                generation_provider: result.asset.generationProvider,
                                generation_model: result.asset.generationModel,
                                generation_settings: result.asset.generationSettings,
                                generation_reference_objects: null,
                                width: result.asset.width,
                                height: result.asset.height,
                                file_size: result.asset.fileSize,
                                created_at: result.asset.createdAt,
                                updated_at: result.asset.updatedAt,
                                file_url: result.asset.fileUrl,
                                thumbnail_url: result.asset.thumbnailUrl,
                            };

                            // Update asset store
                            useAssetStore.setState((state) => ({
                                assets: [asset, ...state.assets],
                            }));
                        }

                        options.onComplete?.(result);
                    },
                    onError: (error) => {
                        failTask(taskId, error.message);
                        options.onError?.(error);
                    },
                }
            );

            // Execute generation
            await managerRef.current.generate(request);
        },
        [
            currentProjectId,
            settings.providerCredentials,
            settings.imageGenConfig.naturalStyles,
            settings.imageGenConfig.tagBasedStyles,
            settings.imageGenConfig.selectedNaturalStyleId,
            settings.imageGenConfig.selectedTagBasedStyleId,
            options,
            startTask,
            updateProgress,
            completeTask,
            failTask,
        ]
    );

    /**
     * Abort current generation
     */
    const abort = useCallback(() => {
        managerRef.current?.abort();
        if (currentTaskId) {
            cancelTask(currentTaskId);
        }
    }, [currentTaskId, cancelTask]);

    /**
     * Check if currently generating
     */
    const isGenerating = currentTaskId
        ? (() => {
              const task = getTask(currentTaskId);
              return (
                  task?.status === 'preparing' ||
                  task?.status === 'generating' ||
                  task?.status === 'processing'
              );
          })()
        : false;

    /**
     * Get current task state
     */
    const currentTask = currentTaskId ? getTask(currentTaskId) : undefined;

    /**
     * Get error message if any
     */
    const error = currentTask?.status === 'error' ? currentTask.error : null;

    return {
        generate,
        abort,
        isGenerating,
        currentTaskId,
        currentTask,
        error,
    };
}

export default useImageGeneration;
