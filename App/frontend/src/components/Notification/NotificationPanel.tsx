import React, { useCallback, useMemo, useState } from 'react';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import { useImageTaskStore } from '../../imageGeneration/store/imageTaskStore';
import type { ImageTaskState } from '../../imageGeneration/types';
import NotificationItem, { type NotificationTask } from './NotificationItem';
import NotificationDetailModal from './NotificationDetailModal';

// Import modal types for retry functionality
import AIEditModal from '../AIEditModal';
import ManuscriptAIEditModal from '../ManuscriptAIEditModal';
import TranslationModal from '../TranslationModal';
import UnifiedImagePromptModal from '../ImageGeneration/UnifiedImagePromptModal';
import { UnifiedImageModal } from '../AssetManager';

interface NotificationPanelProps {
  onClose: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = () => {
  // LLM Task Store
  const llmSessionsMap = useLLMTaskStore((state) => state.sessions);
  const llmSessions = useMemo(() =>
    Object.values(llmSessionsMap)
      .filter((s): s is LLMTaskSessionState => s !== undefined && s.status !== 'idle'),
    [llmSessionsMap]
  );
  const clearLLMNotification = useLLMTaskStore((state) => state.clearNotification);
  const clearAllLLMNotifications = useLLMTaskStore((state) => state.clearAllNotifications);
  const cancelLLMTask = useLLMTaskStore((state) => state.cancelTask);

  // Image Task Store
  const imageTasksMap = useImageTaskStore((state) => state.tasks);
  const imageTasks = useMemo(() =>
    Object.values(imageTasksMap)
      .filter((t): t is ImageTaskState => t !== undefined && t.status !== 'idle'),
    [imageTasksMap]
  );
  const clearImageTask = useImageTaskStore((state) => state.clearTask);
  const clearAllImageTasks = useImageTaskStore((state) => state.clearAllTasks);
  const cancelImageTask = useImageTaskStore((state) => state.cancelTask);

  // Merge and sort all tasks
  const allTasks = useMemo(() => {
    const combined: NotificationTask[] = [
      ...llmSessions.map(s => ({ ...s, kind: 'llm' as const })),
      ...imageTasks.map(t => ({ ...t, kind: 'image' as const })),
    ];
    return combined.sort((a, b) => b.createdAt - a.createdAt);
  }, [llmSessions, imageTasks]);

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [llmRetrySession, setLLMRetrySession] = useState<LLMTaskSessionState | null>(null);
  const [imageRetryTask, setImageRetryTask] = useState<ImageTaskState | null>(null);

  const handleDismiss = useCallback(
    (task: NotificationTask) => {
      if (task.kind === 'llm') {
        // If LLM task is running, cancel it first
        if (task.status === 'running') {
          cancelLLMTask(task.id);
        }
        clearLLMNotification(task.id);
      } else {
        // If image task is running, cancel it first
        if (task.status === 'preparing' || task.status === 'generating' || task.status === 'processing') {
          cancelImageTask(task.id);
        }
        clearImageTask(task.id);
      }
    },
    [cancelLLMTask, clearLLMNotification, cancelImageTask, clearImageTask]
  );

  const handleOpenDetail = useCallback((task: NotificationTask) => {
    if (task.kind === 'llm') {
      setDetailSessionId(task.id);
    } else {
      // For image tasks, if error with retry context, open retry modal
      if (task.status === 'error' && task.retryContext) {
        setImageRetryTask(task);
      }
      // For success, could show image preview (future enhancement)
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailSessionId(null);
  }, []);

  const handleDismissToast = useCallback((id: string) => {
    setDetailSessionId(null);
    clearLLMNotification(id);
  }, [clearLLMNotification]);

  const handleLLMRetry = useCallback((session: LLMTaskSessionState) => {
    setLLMRetrySession(session);
    setDetailSessionId(null);
  }, []);

  const handleLLMRetryModalClose = useCallback(() => {
    if (llmRetrySession) {
      clearLLMNotification(llmRetrySession.id);
    }
    setLLMRetrySession(null);
  }, [llmRetrySession, clearLLMNotification]);

  const handleImageRetryModalClose = useCallback(() => {
    if (imageRetryTask) {
      clearImageTask(imageRetryTask.id);
    }
    setImageRetryTask(null);
  }, [imageRetryTask, clearImageTask]);

  const handleClearAll = useCallback(() => {
    clearAllLLMNotifications();
    clearAllImageTasks();
  }, [clearAllLLMNotifications, clearAllImageTasks]);

  const renderLLMRetryModal = () => {
    if (!llmRetrySession?.retryContext) return null;

    const { taskType, modalProps, formState } = llmRetrySession.retryContext;

    switch (taskType) {
      case 'ai-edit':
        return (
          <AIEditModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            category={modalProps.category}
            projectId={modalProps.projectId}
            targetId={modalProps.targetId}
            onResult={modalProps.onResult}
            defaultUserRequest={formState?.userRequest}
          />
        );

      case 'chapter-edit':
        return (
          <ManuscriptAIEditModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            projectId={modalProps.projectId}
            chapterId={modalProps.chapterId}
            chapterName={modalProps.chapterName}
            onResult={modalProps.onResult}
            defaultUserRequest={formState?.userRequest}
          />
        );

      case 'translation':
        return (
          <TranslationModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            projectId={modalProps.projectId}
            onComplete={modalProps.onComplete}
            allowedObjectTypes={modalProps.allowedObjectTypes}
            defaultSourceLanguage={formState?.sourceLanguage}
            defaultTargetLanguage={formState?.targetLanguage}
            defaultUserInput={formState?.userInput}
          />
        );

      case 'image-prompt':
        return (
          <UnifiedImagePromptModal
            isOpen={true}
            onClose={handleLLMRetryModalClose}
            contextType={modalProps.contextType || 'object'}
            objectType={modalProps.objectType}
            objectId={modalProps.objectId}
            onPromptGenerated={modalProps.onPromptGenerated}
            promptMode={modalProps.promptMode}
            defaultUserRequest={formState?.userRequest}
            sceneContext={modalProps.sceneContext}
          />
        );

      default:
        console.warn(`Retry not implemented for task type: ${taskType}`);
        return null;
    }
  };

  const renderImageRetryModal = () => {
    if (!imageRetryTask?.retryContext) return null;

    const { request } = imageRetryTask.retryContext;

    // Use UnifiedImageModal for retry with initial settings from failed request
    return (
      <UnifiedImageModal
        isOpen={true}
        onClose={handleImageRetryModalClose}
        preset={imageRetryTask.taskType === 'scene-image' ? 'sceneManager' : 'objectManager'}
        onImageGenerated={() => handleImageRetryModalClose()}
        title="Retry Image Generation"
        initialGenerationSettings={{
          provider: request.provider,
          model: request.model,
          size: request.size,
          prompt: request.prompt,
          positivePrompt: request.positivePrompt,
          negativePrompt: request.negativePrompt,
          settings: {
            // Provider-specific settings
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

  const detailSession = detailSessionId
    ? llmSessions.find((s) => s.id === detailSessionId)
    : null;

  return (
    <>
      {/* Thin Header Card */}
      <div className="notification-header">
        <h3 className="notification-header-title">Notifications</h3>
        {allTasks.length > 0 && (
          <button
            className="notification-header-clear"
            onClick={handleClearAll}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Floating Items */}
      {allTasks.length === 0 ? (
        <div className="notification-empty">
          <p>No notifications</p>
        </div>
      ) : (
        <div className="notification-items-container">
          {allTasks.map((task, index) => (
            <NotificationItem
              key={task.id}
              task={task}
              style={{ '--item-index': index } as React.CSSProperties}
              onDismiss={() => handleDismiss(task)}
              onOpenDetail={() => handleOpenDetail(task)}
            />
          ))}
        </div>
      )}

      {detailSession && (
        <NotificationDetailModal
          session={detailSession}
          onClose={handleCloseDetail}
          onDismissToast={() => handleDismissToast(detailSession.id)}
          onRetry={handleLLMRetry}
        />
      )}

      {renderLLMRetryModal()}
      {renderImageRetryModal()}
    </>
  );
};

export default NotificationPanel;
