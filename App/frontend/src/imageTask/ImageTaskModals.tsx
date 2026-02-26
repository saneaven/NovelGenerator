/**
 * Image Task Modals
 * Renders a detail modal for image task sessions (notification -> modal)
 */

import React, { useMemo, useCallback, useState } from 'react';
import { BaseModal } from '../components/BaseModal';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { TextButton } from '../components/TextButton';
import { UnifiedImageModal } from '../components/AssetManager';
import { getAssetUrl } from '../utils/assetUrl';
import { useProjectStore } from '../store/projectStore';
import { useImageTaskStore } from './store';
import { ImageTaskRuntime } from './ImageTaskRuntime';
import type { GenerationRecipe, ImageProgressStage, ImageTaskBinding } from './types';

const STAGES: ImageProgressStage[] = ['preparing', 'generating', 'saving', 'binding'];

export const ImageTaskModals: React.FC = () => {
  const detailTaskId = useImageTaskStore((s) => s.detailTaskId);
  const closeDetailModal = useImageTaskStore((s) => s.closeDetailModal);

  const session = useImageTaskStore((s) => (detailTaskId ? s.sessions[detailTaskId] : null));
  const progress = session?.progress;

  const [retryModal, setRetryModal] = useState<
    | null
    | {
        projectId: string;
        binding: ImageTaskBinding;
        recipe: GenerationRecipe;
      }
  >(null);

  const progressBar = useMemo(() => {
    if (!session || session.status !== 'running' || !progress) return null;
    const idx = Math.max(0, STAGES.indexOf(progress.stage));
    return { current: idx + 1, total: STAGES.length, label: progress.message };
  }, [session, progress]);

  const handleRetry = useCallback(() => {
    if (!session) return;
    const { projectId, binding, recipe } = session.input;

    // Switch project if needed, then open the library modal + prefilled generation modal.
    useProjectStore.getState().setCurrentProject(projectId);
    setRetryModal({
      projectId,
      binding,
      recipe,
    });

    // Auto-dismiss the failed/cancelled task being retried to avoid duplicated placeholders.
    useImageTaskStore.getState().clearSession(session.id);
    closeDetailModal();
  }, [session, closeDetailModal]);

  const handleCancel = useCallback(() => {
    if (!session) return;
    ImageTaskRuntime.cancel(session.id);
  }, [session]);

  return (
    <>
      {session && (
        <BaseModal
          isOpen={true}
          onClose={closeDetailModal}
          size="large"
          title={session.input.label ?? 'Image generation'}
          className="image-task-modal"
          footer={
            <>
              {(session.status === 'error' || session.status === 'cancelled') && (
                <TextButton variant="secondary" onClick={handleRetry}>
                  Retry
                </TextButton>
              )}
              {session.status === 'running' && (
                <TextButton variant="danger" onClick={handleCancel}>
                  Cancel
                </TextButton>
              )}
            </>
          }
        >
          {progressBar && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 6 }}>{progressBar.label}</div>
              <NotificationProgressBar current={progressBar.current} total={progressBar.total} />
            </div>
          )}

          {session.status === 'error' && session.error && (
            <div style={{ marginBottom: 12, color: 'var(--color-danger, #c0392b)' }}>{session.error}</div>
          )}

          {session.status === 'success' && session.result?.asset && (
            <div style={{ display: 'grid', gap: 12 }}>
              <img
                src={getAssetUrl(session.result.asset) || ''}
                alt={session.result.asset.name}
                style={{ width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 8 }}
              />
              {session.result.revisedPrompt && (
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  Revised prompt: {session.result.revisedPrompt}
                </div>
              )}
            </div>
          )}
        </BaseModal>
      )}

      {retryModal && (
        <UnifiedImageModal
          preset={retryModal.binding.type === 'scene' ? 'sceneManager' : 'objectManager'}
          isOpen={true}
          onClose={() => setRetryModal(null)}
          manuscriptId={retryModal.binding.type === 'scene' ? retryModal.binding.manuscriptId : undefined}
          objectType={retryModal.binding.type === 'object' ? retryModal.binding.objectType : undefined}
          objectId={retryModal.binding.type === 'object' ? retryModal.binding.objectId : undefined}
          initialGenerationRecipe={retryModal.recipe}
          title="Retry Image Generation"
          zIndexLayer={1}
        />
      )}
    </>
  );
};

export default ImageTaskModals;
