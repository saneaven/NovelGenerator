import React, { useState, useCallback } from 'react';
import { BaseModal } from '../BaseModal';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import { Close } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
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
  const [copiedDetail, setCopiedDetail] = useState(false);

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
    <BaseModal
      isOpen={true}
      onClose={onClose}
      size="small"
      showHeader={false}
      className="toast-error-modal"
      footer={
        <>
          <TextButton variant="secondary" onClick={onDismissToast}>
            Dismiss
          </TextButton>
          {session.retryContext && (
            <TextButton variant="primary" onClick={handleRetry}>
              Retry
            </TextButton>
          )}
        </>
      }
    >
      {/* Custom Error Header */}
      <div className="toast-error-header">
        <div className="toast-error-icon">!</div>
        <h3>Error Occurred</h3>
        <IconButton
          icon={<Close size="sm" />}
          onClick={onClose}
          title="Close"
          size="sm"
        />
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
            <TextButton
              variant="ghost"
              size="sm"
              onClick={handleCopyDetail}
              title="Copy to clipboard"
            >
              {copiedDetail ? 'Copied!' : 'Copy'}
            </TextButton>
          </div>
          <pre className="toast-error-detail-content">
            {session.error || 'No additional details'}
          </pre>
        </div>
      </div>
    </BaseModal>
  );
};

export default ToastErrorModal;
