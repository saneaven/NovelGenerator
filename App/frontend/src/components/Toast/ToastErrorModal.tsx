import React, { useState, useCallback } from 'react';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import './ToastErrorModal.css';

// Import all modal types for retry functionality
import AIEditModal from '../AIEditModal';
import NovelChapterAIEditModal from '../NovelChapterAIEditModal';
import TranslationModal from '../TranslationModal';
import ImagePromptBuilderModal from '../ImageGeneration/ImagePromptBuilderModal';

interface ToastErrorModalProps {
  session: LLMTaskSessionState;
  onClose: () => void;
  onDismissToast: () => void;
}

const ToastErrorModal: React.FC<ToastErrorModalProps> = ({
  session,
  onClose,
  onDismissToast,
}) => {
  const [isRetryModalOpen, setIsRetryModalOpen] = useState(false);
  const [copiedDetail, setCopiedDetail] = useState(false);
  const clearSession = useLLMTaskStore((state) => state.clearSession);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleCopyDetail = useCallback(async () => {
    const textToCopy = `Error: ${session.error}\n\nTask: ${session.label || 'Unknown'}`;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedDetail(true);
      setTimeout(() => setCopiedDetail(false), 2000);
    } catch (err) {
      console.error('Failed to copy error details:', err);
    }
  }, [session.error, session.label]);

  const handleRetry = useCallback(() => {
    if (!session.retryContext) {
      console.warn('No retry context available');
      return;
    }
    setIsRetryModalOpen(true);
    onClose();
  }, [session.retryContext, onClose]);

  const handleRetryModalClose = useCallback(() => {
    setIsRetryModalOpen(false);
    clearSession(session.id);
  }, [clearSession, session.id]);

  const renderRetryModal = () => {
    if (!isRetryModalOpen || !session.retryContext) return null;

    const { taskType, modalProps, formState } = session.retryContext;

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
            defaultContextOptions={formState?.contextOptions}
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

      // For scene-image and chat translation, we'll handle them separately
      // as they may have different patterns
      default:
        console.warn(`Retry not implemented for task type: ${taskType}`);
        return null;
    }
  };

  return (
    <>
      <div className="toast-error-overlay" onClick={handleOverlayClick}>
        <div className="toast-error-modal" onClick={(e) => e.stopPropagation()}>
          <div className="toast-error-header">
            <div className="toast-error-icon">!</div>
            <h3>Error Occurred</h3>
            <button className="toast-error-close" onClick={onClose} title="Close">
              &#10005;
            </button>
          </div>

          <div className="toast-error-content">
            <div className="toast-error-task">
              <span className="toast-error-label">Task:</span>
              <span className="toast-error-value">{session.label || 'Unknown'}</span>
            </div>

            <div className="toast-error-message">
              {session.error || 'An unknown error occurred'}
            </div>

            <div className="toast-error-detail">
              <div className="toast-error-detail-header">
                <span className="toast-error-label">Details</span>
                <button
                  className="toast-error-copy-btn"
                  onClick={handleCopyDetail}
                  title="Copy to clipboard"
                >
                  {copiedDetail ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="toast-error-detail-content">
                {session.error || 'No additional details'}
              </pre>
            </div>
          </div>

          <div className="toast-error-footer">
            <button className="toast-error-btn toast-error-btn--secondary" onClick={onDismissToast}>
              Dismiss
            </button>
            {session.retryContext && (
              <button className="toast-error-btn toast-error-btn--primary" onClick={handleRetry}>
                Retry
              </button>
            )}
          </div>
        </div>
      </div>

      {renderRetryModal()}
    </>
  );
};

export default ToastErrorModal;
