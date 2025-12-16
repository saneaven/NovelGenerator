import React from 'react';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import { Check, Close } from '../icons';

interface NotificationItemProps {
  session: LLMTaskSessionState;
  style?: React.CSSProperties;
  onDismiss: () => void;
  onOpenDetail: () => void;
  onOpenError: () => void;
}

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

const NotificationItem: React.FC<NotificationItemProps> = ({
  session,
  style,
  onDismiss,
  onOpenDetail,
  onOpenError,
}) => {
  const { status, label, progress, error, isRead, updatedAt } = session;

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
          <div className="notification-spinner">
            <div className="notification-spinner-ring" />
          </div>
        );
      case 'success':
        return <span className="notification-icon notification-icon--success"><Check size="sm" /></span>;
      case 'error':
        return <span className="notification-icon notification-icon--error">!</span>;
      case 'cancelled':
        return <span className="notification-icon notification-icon--cancelled"><Close size="sm" /></span>;
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
      className={`notification-item notification-item--${status} ${isClickable ? 'notification-item--clickable' : ''} ${!isRead ? 'notification-item--unread' : ''}`}
      style={style}
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
      <div className="notification-item-content">
        <div className="notification-item-icon">{getStatusIcon()}</div>
        <div className="notification-item-text">
          <div className="notification-item-label">{label || 'Task'}</div>
          <div className="notification-item-message">{getStatusMessage()}</div>
          <div className="notification-item-time">{formatRelativeTime(updatedAt)}</div>
        </div>
        <button
          className="notification-item-close"
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
    </div>
  );
};

export default NotificationItem;
