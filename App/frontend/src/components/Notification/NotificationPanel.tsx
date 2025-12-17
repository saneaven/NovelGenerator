import React, { useCallback, useMemo, useState } from 'react';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import NotificationItem from './NotificationItem';
import ToastDetailModal from '../Toast/ToastDetailModal';
import ToastErrorModal from '../Toast/ToastErrorModal';

// Import modal types for retry functionality
import AIEditModal from '../AIEditModal';
import ManuscriptAIEditModal from '../ManuscriptAIEditModal';
import TranslationModal from '../TranslationModal';
import ImagePromptBuilderModal from '../ImageGeneration/ImagePromptBuilderModal';

interface NotificationPanelProps {
  onClose: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = () => {
  // Select raw sessions object (stable reference) and derive list with useMemo
  const sessionsMap = useLLMTaskStore((state) => state.sessions);
  const sessions = useMemo(() =>
    Object.values(sessionsMap)
      .filter((s): s is LLMTaskSessionState => s !== undefined && s.status !== 'idle')
      .sort((a, b) => b.createdAt - a.createdAt),
    [sessionsMap]
  );
  const clearNotification = useLLMTaskStore((state) => state.clearNotification);
  const clearAllNotifications = useLLMTaskStore((state) => state.clearAllNotifications);
  const cancelTask = useLLMTaskStore((state) => state.cancelTask);

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [errorSessionId, setErrorSessionId] = useState<string | null>(null);
  const [retrySession, setRetrySession] = useState<LLMTaskSessionState | null>(null);

  const handleDismiss = useCallback(
    (id: string) => {
      const session = sessionsMap[id];
      // If task is running, cancel it first (abort request + update status)
      if (session?.status === 'running') {
        cancelTask(id);
      }
      clearNotification(id);
    },
    [sessionsMap, cancelTask, clearNotification]
  );

  const handleOpenDetail = useCallback((id: string) => {
    setDetailSessionId(id);
  }, []);

  const handleOpenError = useCallback((id: string) => {
    setErrorSessionId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailSessionId(null);
  }, []);

  const handleCloseError = useCallback(() => {
    setErrorSessionId(null);
  }, []);

  const handleRetry = useCallback((session: LLMTaskSessionState) => {
    setRetrySession(session);
    setErrorSessionId(null);
  }, []);

  const handleRetryModalClose = useCallback(() => {
    if (retrySession) {
      clearNotification(retrySession.id);
    }
    setRetrySession(null);
  }, [retrySession, clearNotification]);

  const handleClearAll = useCallback(() => {
    clearAllNotifications();
  }, [clearAllNotifications]);

  const renderRetryModal = () => {
    if (!retrySession?.retryContext) return null;

    const { taskType, modalProps, formState } = retrySession.retryContext;

    switch (taskType) {
      case 'ai-edit':
        return (
          <AIEditModal
            isOpen={true}
            onClose={handleRetryModalClose}
            category={modalProps.category}
            projectId={modalProps.projectId}
            targetId={modalProps.targetId}
            onResult={modalProps.onResult}
            defaultUserRequest={formState?.userRequest}
            defaultContextOptions={formState?.contextOptions}
          />
        );

      case 'chapter-edit':
        return (
          <ManuscriptAIEditModal
            isOpen={true}
            onClose={handleRetryModalClose}
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
            onClose={handleRetryModalClose}
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
          <ImagePromptBuilderModal
            isOpen={true}
            onClose={handleRetryModalClose}
            objectType={modalProps.objectType}
            objectId={modalProps.objectId}
            onPromptGenerated={modalProps.onPromptGenerated}
            promptMode={modalProps.promptMode}
            defaultUserRequest={formState?.userRequest}
          />
        );

      default:
        console.warn(`Retry not implemented for task type: ${taskType}`);
        return null;
    }
  };

  const detailSession = detailSessionId ? sessions.find((s) => s.id === detailSessionId) : null;
  const errorSession = errorSessionId ? sessions.find((s) => s.id === errorSessionId) : null;

  return (
    <>
      {/* Thin Header Card */}
      <div className="notification-header">
        <h3 className="notification-header-title">Notifications</h3>
        {sessions.length > 0 && (
          <button
            className="notification-header-clear"
            onClick={handleClearAll}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Floating Items */}
      {sessions.length === 0 ? (
        <div className="notification-empty">
          <p>No notifications</p>
        </div>
      ) : (
        <div className="notification-items-container">
          {sessions.map((session, index) => (
            <NotificationItem
              key={session.id}
              session={session}
              style={{ '--item-index': index } as React.CSSProperties}
              onDismiss={() => handleDismiss(session.id)}
              onOpenDetail={() => handleOpenDetail(session.id)}
              onOpenError={() => handleOpenError(session.id)}
            />
          ))}
        </div>
      )}

      {detailSession && (
        <ToastDetailModal session={detailSession} onClose={handleCloseDetail} />
      )}

      {errorSession && (
        <ToastErrorModal
          session={errorSession}
          onClose={handleCloseError}
          onDismissToast={() => {
            handleCloseError();
            handleDismiss(errorSession.id);
          }}
          onRetry={handleRetry}
        />
      )}

      {renderRetryModal()}
    </>
  );
};

export default NotificationPanel;
