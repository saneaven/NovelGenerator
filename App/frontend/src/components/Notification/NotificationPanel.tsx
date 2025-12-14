import React, { useCallback, useMemo, useState } from 'react';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import NotificationItem from './NotificationItem';
import ToastDetailModal from '../Toast/ToastDetailModal';
import ToastErrorModal from '../Toast/ToastErrorModal';

// Import modal types for retry functionality
import AIEditModal from '../AIEditModal';
import NovelChapterAIEditModal from '../NovelChapterAIEditModal';
import TranslationModal from '../TranslationModal';
import ImagePromptBuilderModal from '../ImageGeneration/ImagePromptBuilderModal';

interface NotificationPanelProps {
  onClose: () => void;
  position?: 'desktop' | 'mobile';
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({ position = 'desktop' }) => {
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

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [errorSessionId, setErrorSessionId] = useState<string | null>(null);
  const [retrySession, setRetrySession] = useState<LLMTaskSessionState | null>(null);

  const handleDismiss = useCallback(
    (id: string) => {
      clearNotification(id);
    },
    [clearNotification]
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
          <NovelChapterAIEditModal
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
      <div className={`notification-panel notification-panel--${position}`}>
        <div className="notification-panel-header">
          <h3 className="notification-panel-title">Notifications</h3>
          {sessions.length > 0 && (
            <button
              className="notification-panel-clear"
              onClick={handleClearAll}
            >
              Clear All
            </button>
          )}
        </div>

        <div className="notification-panel-content">
          {sessions.length === 0 ? (
            <div className="notification-panel-empty">
              <p>No notifications</p>
            </div>
          ) : (
            <div className="notification-panel-list">
              {sessions.map((session) => (
                <NotificationItem
                  key={session.id}
                  session={session}
                  onDismiss={() => handleDismiss(session.id)}
                  onOpenDetail={() => handleOpenDetail(session.id)}
                  onOpenError={() => handleOpenError(session.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
