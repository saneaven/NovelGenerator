import React, { useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionTemplate, useTransform, type MotionValue } from 'motion/react';
import type { LLMTaskSessionState } from '../../store/llmTaskStore';
import type { ImageTaskState } from '../../imageGeneration/types';
import { Check, Close } from '../icons';

// Unified task type for notifications
export type NotificationTask =
  | (LLMTaskSessionState & { kind: 'llm' })
  | (ImageTaskState & { kind: 'image' });

interface NotificationItemProps {
  task: NotificationTask;
  index: number;
  totalCount: number;
  scrollY: MotionValue<number>;
  itemStride: number;
  viewportHeight: number;
  frontCount: number;
  depthRange: number;
  maxDepthZ: number;
  stackLift: number;
  maxBlur: number;
  isMobile: boolean;
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
  index,
  totalCount,
  scrollY,
  itemStride,
  viewportHeight,
  frontCount,
  depthRange,
  maxDepthZ,
  stackLift,
  maxBlur,
  isMobile,
  onDismiss,
  onOpenDetail,
}) => {
  const { label, error, isRead, updatedAt } = task;
  const normalizedStatus = normalizeStatus(task);
  const itemRef = useRef<HTMLDivElement>(null);
  const [itemTop, setItemTop] = useState(0);
  const [itemHeight, setItemHeight] = useState(0);

  useLayoutEffect(() => {
    const node = itemRef.current;
    if (!node) return;

    const measure = () => {
      setItemTop(node.offsetTop);
      setItemHeight(node.offsetHeight);
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(node);
    return () => {
      resizeObserver.disconnect();
    };
  }, [index, totalCount]);

  const depth = useTransform(scrollY, (value) => {
    const safeStride = itemStride > 0 ? itemStride : 1;
    const safeRange = depthRange > 0 ? depthRange : 1;
    const itemBottom = itemTop + (itemHeight || safeStride);
    const distanceFromFront = isMobile
      ? (value + viewportHeight) - itemBottom
      : itemTop - value;
    const relative = distanceFromFront / safeStride;
    const depthRaw = relative - (frontCount - 1);
    if (depthRaw <= 0) return 0;
    const t = Math.min(1, depthRaw / safeRange);
    return t * t * (3 - 2 * t);
  });

  const opacity = useTransform(depth, (value) => 1 - value);
  const z = useTransform(depth, (value) => -value * maxDepthZ);
  const y = useTransform(depth, (value) => (isMobile ? value * stackLift : -value * stackLift));
  const blur = useTransform(depth, (value) => value * maxBlur);
  const pointerEvents = useTransform(depth, (value) => (value > 0.92 ? 'none' : 'auto'));
  const zIndex = isMobile ? (index + 1) : (totalCount - index);
  const transform = useMotionTemplate`translateY(${y}px) translateZ(${z}px)`;
  const filter = useMotionTemplate`blur(${blur}px)`;

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

  const animationIndex = isMobile ? (totalCount - 1 - index) : index;

  return (
    <motion.div
      ref={itemRef}
      className={`notification-item notification-item--${normalizedStatus} notification-item--${task.kind} ${isClickable ? 'notification-item--clickable' : ''} ${!isRead ? 'notification-item--unread' : ''}`}
      style={{ opacity, transform, filter, pointerEvents, zIndex }}
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
      <div
        className="notification-item-surface"
        style={{ '--item-index': animationIndex } as React.CSSProperties}
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
    </motion.div>
  );
};

export default NotificationItem;
