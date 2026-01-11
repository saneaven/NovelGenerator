/**
 * Image Task Modals
 * Renders modals based on imageTaskStore modal state
 */

import React, { useCallback } from 'react';
import { useImageTaskStore } from './store/imageTaskStore';
import ImagePreviewModal from '../components/Notification/ImagePreviewModal';
import { UnifiedImageModal } from '../components/AssetManager';

export const ImageTaskModals: React.FC = () => {
  // Look up task from tasks record using modalTaskId
  const task = useImageTaskStore((s) =>
    s.modalTaskId ? s.tasks[s.modalTaskId] : null
  );
  const closeModal = useImageTaskStore((s) => s.closeModal);
  const clearTask = useImageTaskStore((s) => s.clearTask);

  const handleRetryClose = useCallback(() => {
    if (task) {
      clearTask(task.id);
    }
    closeModal();
  }, [task, clearTask, closeModal]);

  if (!task) return null;

  // Render based on task status
  if (task.status === 'success' && task.result?.assetId) {
    return (
      <ImagePreviewModal
        isOpen={true}
        onClose={closeModal}
        assetId={task.result.assetId}
      />
    );
  }

  if (task.status === 'error' && task.retryContext) {
    const { request } = task.retryContext;

    return (
      <UnifiedImageModal
        isOpen={true}
        onClose={handleRetryClose}
        preset={task.taskType === 'scene-image' ? 'sceneManager' : 'objectManager'}
        onImageGenerated={handleRetryClose}
        title="Retry Image Generation"
        initialGenerationSettings={{
          provider: request.provider,
          model: request.model,
          size: request.size,
          prompt: request.prompt,
          positivePrompt: request.positivePrompt,
          negativePrompt: request.negativePrompt,
          settings: {
            quality: request.quality,
            style: request.style,
            sampler: request.sampler,
            steps: request.steps,
            scale: request.scale,
            noiseSchedule: request.noiseSchedule,
            styleId: request.styleId,
          },
        }}
      />
    );
  }

  return null;
};

export default ImageTaskModals;
