import React, { useState, useCallback } from 'react';
import { useModalHistory } from '../../hooks/useModalHistory';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import { Close } from '../icons';
import './ToastErrorModal.css';

interface ToastErrorModalProps {
  session: LLMTaskSessionState;
  onClose: () => void;
  onDismissToast: () => void;
  onRetry: (session: LLMTaskSessionState) => void;
}

const ToastErrorModal: React.FC<ToastErrorModalProps> = ({
  session,
  onClose,
  onDismissToast,
  onRetry,
}) => {
  useModalHistory(true, onClose);  // Always open when rendered

  const [copiedDetail, setCopiedDetail] = useState(false);

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
    onRetry(session);
  }, [session, onRetry]);

  return (
    <div className="toast-error-overlay" onClick={handleOverlayClick}>
      <div className="toast-error-modal" onClick={(e) => e.stopPropagation()}>
        <div className="toast-error-header">
          <div className="toast-error-icon">!</div>
          <h3>Error Occurred</h3>
          <button className="toast-error-close" onClick={onClose} title="Close">
            <Close size={14} />
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
  );
};

export default ToastErrorModal;
