import React, { useState, useCallback } from 'react';
import { useNotificationSync } from '../hooks/useNotificationSync';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useImageTaskStore } from '../imageGeneration/store/imageTaskStore';
import NotificationDetailModal from './Notification/NotificationDetailModal';
import ImagePreviewModal from './Notification/ImagePreviewModal';
import { UnifiedImageModal } from './AssetManager';
import type { ImageTaskState } from '../imageGeneration/types';

/**
 * Container component that manages notification modals and synchronization.
 * Should be rendered at app root level.
 */
export const NotificationModals: React.FC = () => {
  // Modal state
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [imageRetryTask, setImageRetryTask] = useState<ImageTaskState | null>(null);

  // Get session data for detail modal
  const detailSession = useLLMTaskStore((state) =>
    detailSessionId ? state.sessions[detailSessionId] : null
  );
  const clearLLMNotification = useLLMTaskStore((state) => state.clearNotification);
  const clearImageTask = useImageTaskStore((state) => state.clearTask);

  // Set up notification sync with modal handlers
  useNotificationSync({
    onOpenLLMDetail: setDetailSessionId,
    onOpenImagePreview: setPreviewAssetId,
    onOpenImageRetry: setImageRetryTask,
  });

  // LLM Detail Modal handlers
  const handleCloseDetail = useCallback(() => {
    setDetailSessionId(null);
  }, []);

  const handleDismissToast = useCallback(() => {
    if (detailSessionId) {
      clearLLMNotification(detailSessionId);
      setDetailSessionId(null);
    }
  }, [detailSessionId, clearLLMNotification]);

  // Image Retry Modal handlers
  const handleImageRetryClose = useCallback(() => {
    if (imageRetryTask) {
      clearImageTask(imageRetryTask.id);
    }
    setImageRetryTask(null);
  }, [imageRetryTask, clearImageTask]);

  // Image Preview Modal handlers
  const handlePreviewClose = useCallback(() => {
    setPreviewAssetId(null);
  }, []);

  // Render image retry modal with settings from failed request
  const renderImageRetryModal = () => {
    if (!imageRetryTask?.retryContext) return null;

    const { request } = imageRetryTask.retryContext;

    return (
      <UnifiedImageModal
        isOpen={true}
        onClose={handleImageRetryClose}
        preset={imageRetryTask.taskType === 'scene-image' ? 'sceneManager' : 'objectManager'}
        onImageGenerated={handleImageRetryClose}
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
  };

  return (
    <>
      {/* LLM Task Detail Modal */}
      {detailSession && (
        <NotificationDetailModal
          session={detailSession}
          onClose={handleCloseDetail}
          onDismissToast={handleDismissToast}
        />
      )}

      {/* Image Retry Modal */}
      {renderImageRetryModal()}

      {/* Image Preview Modal */}
      {previewAssetId && (
        <ImagePreviewModal
          isOpen={true}
          onClose={handlePreviewClose}
          assetId={previewAssetId}
        />
      )}
    </>
  );
};

export default NotificationModals;
