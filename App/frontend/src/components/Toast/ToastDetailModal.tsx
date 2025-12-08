import React, { useMemo } from 'react';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import ThinkingDisplay from '../ThinkingDisplay';
import ToastProgressBar from './ToastProgressBar';
import './ToastDetailModal.css';

interface ToastDetailModalProps {
  session: LLMTaskSessionState;
  onClose: () => void;
}

const ToastDetailModal: React.FC<ToastDetailModalProps> = ({ session, onClose }) => {
  const streamContent = useMemo(() => {
    if (!session.contentParts || session.contentParts.length === 0) {
      return '';
    }
    return session.contentParts
      .filter((part) => part.type === 'content')
      .map((part) => part.text)
      .join('');
  }, [session.contentParts]);

  const hasThinking = useMemo(() => {
    return session.contentParts?.some((part) => part.type === 'thinking') ?? false;
  }, [session.contentParts]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getStatusLabel = () => {
    switch (session.status) {
      case 'running':
        return 'In Progress';
      case 'success':
        return 'Completed';
      case 'error':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="toast-detail-overlay" onClick={handleOverlayClick}>
      <div className="toast-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="toast-detail-header">
          <div className="toast-detail-title">
            <span className={`toast-detail-status toast-detail-status--${session.status}`}>
              {session.status === 'running' && (
                <span className="toast-detail-spinner" />
              )}
              {getStatusLabel()}
            </span>
            <h3>{session.label || 'Task'}</h3>
          </div>
          <button className="toast-detail-close" onClick={onClose} title="Close">
            &#10005;
          </button>
        </div>

        {session.progress && (
          <div className="toast-detail-progress">
            <div className="toast-detail-progress-text">
              {session.progress.currentItemLabel || `${session.progress.current} / ${session.progress.total}`}
            </div>
            <ToastProgressBar current={session.progress.current} total={session.progress.total} />
          </div>
        )}

        <div className="toast-detail-content">
          {/* Thinking Display */}
          {hasThinking && session.contentParts && (
            <div className="toast-detail-thinking">
              <ThinkingDisplay
                messageId={session.id}
                contentParts={session.contentParts}
                displayMode="separate"
                isStreaming={session.status === 'running'}
              />
            </div>
          )}

          {/* Streaming Content */}
          {streamContent && (
            <div className="toast-detail-stream">
              <div className="toast-detail-stream-label">Output</div>
              <div className="toast-detail-stream-content">
                {streamContent}
                {session.status === 'running' && (
                  <span className="toast-detail-cursor">|</span>
                )}
              </div>
            </div>
          )}

          {/* No content yet */}
          {!streamContent && !hasThinking && session.status === 'running' && (
            <div className="toast-detail-waiting">
              <div className="toast-detail-waiting-spinner" />
              <span>Waiting for response...</span>
            </div>
          )}
        </div>

        <div className="toast-detail-footer">
          <button className="toast-detail-btn" onClick={onClose}>
            {session.status === 'running' ? 'Continue in Background' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ToastDetailModal);
