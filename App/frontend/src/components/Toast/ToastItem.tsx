import React from 'react';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import { Check, Close } from '../icons';
import { TextButton } from '../TextButton';
import ToastProgressBar from './ToastProgressBar';
import './ToastItem.css';

interface ToastItemProps {
  session: LLMTaskSessionState;
  onDismiss: () => void;
  onOpenDetail: () => void;
  onOpenError: () => void;
}

const ToastItem: React.FC<ToastItemProps> = ({
  session,
  onDismiss,
  onOpenDetail,
  onOpenError,
}) => {
  const { status, label, progress, error } = session;

  const handleClick = () => {
    if (status === 'running') {
      onOpenDetail();
    } else if (status === 'error') {
      onOpenError();
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return (
          <div className="toast-spinner">
            <div className="toast-spinner-ring" />
          </div>
        );
      case 'success':
        return <span className="toast-icon toast-icon--success"><Check size="sm" /></span>;
      case 'error':
        return <span className="toast-icon toast-icon--error">!</span>;
      case 'cancelled':
        return <span className="toast-icon toast-icon--cancelled"><Close size="sm" /></span>;
      default:
        return null;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'running':
        if (progress) {
          return progress.currentItemLabel || `${progress.current}/${progress.total}`;
        }
        return 'Processing...';
      case 'success':
        return 'Completed';
      case 'error':
        return error || 'An error occurred';
      case 'cancelled':
        return 'Cancelled';
      default:
        return '';
    }
  };

  const isClickable = status === 'running' || status === 'error';

  return (
    <div
      className={`toast-item toast-item--${status} ${isClickable ? 'toast-item--clickable' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      <div className="toast-item-content">
        <div className="toast-item-icon">{getStatusIcon()}</div>
        <div className="toast-item-text">
          <div className="toast-item-label">{label || 'Task'}</div>
          <div className="toast-item-message">{getStatusMessage()}</div>
        </div>
        <button
          className="toast-item-close"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          title="Dismiss"
          aria-label="Dismiss notification"
        >
          <Close size="xs" />
        </button>
      </div>

      {status === 'running' && progress && (
        <ToastProgressBar current={progress.current} total={progress.total} />
      )}

      {status === 'error' && (
        <div className="toast-item-action" onClick={(e) => e.stopPropagation()}>
          <TextButton
            variant="ghost"
            size="sm"
            onClick={onOpenError}
          >
            More Info
          </TextButton>
        </div>
      )}
    </div>
  );
};

export default ToastItem;
