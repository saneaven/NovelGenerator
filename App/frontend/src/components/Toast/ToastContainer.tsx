import React, { useCallback, useState, useMemo } from 'react';
import { useLLMTaskStore, type LLMTaskSessionState } from '../../store/llmTaskStore';
import ToastItem from './ToastItem';
import ToastDetailModal from './ToastDetailModal';
import ToastErrorModal from './ToastErrorModal';
import './ToastContainer.css';

// Import modal types for retry functionality
import AIEditModal from '../AIEditModal';
import ManuscriptAIEditModal from '../ManuscriptAIEditModal';
import TranslationModal from '../TranslationModal';
import ImagePromptBuilderModal from '../ImageGeneration/ImagePromptBuilderModal';

const MAX_VISIBLE_TOASTS = 5;

const ToastContainer: React.FC = () => {
  // Select the raw sessions object to avoid infinite re-renders
  const sessionsObj = useLLMTaskStore((state) => state.sessions);
  const clearSession = useLLMTaskStore((state) => state.clearSession);

  // Derive active sessions list with useMemo to avoid creating new array on every render
  const sessions = useMemo(() => {
    return Object.values(sessionsObj)
      .filter((s): s is LLMTaskSessionState => s !== undefined && s.status !== 'idle')
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [sessionsObj]);

  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [errorSessionId, setErrorSessionId] = useState<string | null>(null);
  const [retrySession, setRetrySession] = useState<LLMTaskSessionState | null>(null);

  // Note: Auto-dismiss removed - notifications persist until manually cleared

  const handleDismiss = useCallback(
    (id: string) => {
      clearSession(id);
    },
    [clearSession]
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
    setErrorSessionId(null); // Close error modal
  }, []);

  const handleRetryModalClose = useCallback(() => {
    if (retrySession) {
      clearSession(retrySession.id);
    }
    setRetrySession(null);
  }, [retrySession, clearSession]);

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

  const visibleSessions = sessions.slice(0, MAX_VISIBLE_TOASTS);
  const hiddenCount = Math.max(0, sessions.length - MAX_VISIBLE_TOASTS);

  const detailSession = detailSessionId ? sessions.find((s) => s.id === detailSessionId) : null;
  const errorSession = errorSessionId ? sessions.find((s) => s.id === errorSessionId) : null;

  if (sessions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="toast-container">
        {hiddenCount > 0 && (
          <div className="toast-hidden-count">+{hiddenCount} more tasks</div>
        )}
        {visibleSessions.map((session) => (
          <ToastItem
            key={session.id}
            session={session}
            onDismiss={() => handleDismiss(session.id)}
            onOpenDetail={() => handleOpenDetail(session.id)}
            onOpenError={() => handleOpenError(session.id)}
          />
        ))}
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

export default ToastContainer;
