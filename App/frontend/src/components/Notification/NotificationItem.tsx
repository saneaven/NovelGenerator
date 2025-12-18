import React from 'react';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import type { ImageTaskState } from '../../imageGeneration/types';
import { Check, Close } from '../icons';

// Unified task type for notifications
export type NotificationTask =
  | (LLMTaskSessionState & { kind: 'llm' })
  | (ImageTaskState & { kind: 'image' });

interface NotificationItemProps {
  task: NotificationTask;
  style?: React.CSSProperties;
  onDismiss: () => void;
  onOpenDetail: () => void;
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

// Type guards
const isImageTask = (task: NotificationTask): task is ImageTaskState & { kind: 'image' } =>
  task.kind === 'image';

// Normalize status for display (image tasks have more statuses)
const normalizeStatus = (task: NotificationTask): 'running' | 'success' | 'error' | 'cancelled' | 'idle' => {
  if (isImageTask(task)) {
    if (task.status === 'preparing' || task.status === 'generating' || task.status === 'processing') {
      return 'running';
    }
  }
  return task.status as 'running' | 'success' | 'error' | 'cancelled' | 'idle';
};

const NotificationItem: React.FC<NotificationItemProps> = ({
  task,
  style,
  onDismiss,
  onOpenDetail,
}) => {
  const { label, error, isRead, updatedAt } = task;
  const normalizedStatus = normalizeStatus(task);

  const handleClick = () => {
    // All clickable states open the same detail modal
    if (normalizedStatus === 'running' || normalizedStatus === 'success' || normalizedStatus === 'error') {
      onOpenDetail();
    }
  };

  const getStatusIcon = () => {
    switch (normalizedStatus) {
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
    // Image task specific messages
    if (isImageTask(task)) {
      switch (task.status) {
        case 'preparing':
          return 'Preparing...';
        case 'generating':
          return task.progress?.message || 'Generating...';
        case 'processing':
          return 'Processing...';
        case 'success':
          return 'Image generated';
        case 'error':
          return error || 'Generation failed';
        case 'cancelled':
          return 'Cancelled';
        default:
          return '';
      }
    }

    // LLM task messages
    switch (task.status) {
      case 'running':
        if (task.progress) {
          return task.progress.currentItemLabel || `${task.progress.current}/${task.progress.total}`;
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

  // Get thumbnail URL for image tasks
  const thumbnailUrl = isImageTask(task) && task.status === 'success' ? task.result?.thumbnailUrl : undefined;

  const isClickable = normalizedStatus === 'running' || normalizedStatus === 'success' || normalizedStatus === 'error';

  return (
    <div
      className={`notification-item notification-item--${normalizedStatus} notification-item--${task.kind} ${isClickable ? 'notification-item--clickable' : ''} ${!isRead ? 'notification-item--unread' : ''}`}
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

        {/* Thumbnail preview for completed image tasks */}
        {thumbnailUrl && (
          <div className="notification-item-thumbnail">
            <img src={thumbnailUrl} alt="Generated" />
          </div>
        )}

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
