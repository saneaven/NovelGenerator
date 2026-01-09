import React, { useLayoutEffect, useRef, useState, useCallback } from 'react';
import { motion, useMotionTemplate, useTransform, type MotionValue } from 'motion/react';
import type { NotificationEntry } from '../../store/notificationStore';
import { Check, Close } from '../icons';

interface NotificationItemProps {
  notification: NotificationEntry;
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
  onDismiss: (id: string) => void;
  onClick: (id: string) => void;
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
  notification,
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
  onClick,
}) => {
  const { id, label, message, status, updatedAt, isRead, customSlot, warning, source } = notification;
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
  const surfaceFillOpacity = useTransform(depth, (value) => Math.max(0.15, 1 - value * 0.85));
  const pointerEvents = useTransform(depth, (value) => (value > 0.92 ? 'none' : 'auto'));
  const zIndex = isMobile ? (index + 1) : (totalCount - index);
  const transform = useMotionTemplate`translateY(${y}px) translateZ(${z}px)`;
  const bodyFilter = useMotionTemplate`blur(${blur}px)`;

  const handleClick = useCallback(() => {
    if (status !== 'idle') {
      onClick(id);
    }
  }, [status, onClick, id]);

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return (
          <div className="notification-spinner">
            <div className="notification-spinner-ring" />
          </div>
        );
      case 'pending':
        return <span className="notification-icon notification-icon--pending">!</span>;
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

  const renderCustomSlot = () => {
    if (!customSlot || customSlot.type === 'none') return null;

    if (customSlot.type === 'thumbnail') {
      return (
        <div className="notification-item-thumbnail">
          <img src={customSlot.url} alt={customSlot.alt || 'Preview'} />
        </div>
      );
    }

    if (customSlot.type === 'component') {
      const Component = customSlot.render;
      return <Component notification={notification} />;
    }

    return null;
  };

  const isClickable = status !== 'idle';

  const animationIndex = isMobile ? (totalCount - 1 - index) : index;
  const surfaceStyle = {
    '--item-index': animationIndex,
  } as React.CSSProperties;

  return (
    <motion.div
      ref={itemRef}
      className={`notification-item notification-item--${status} notification-item--${source} ${isClickable ? 'notification-item--clickable' : ''} ${!isRead ? 'notification-item--unread' : ''}`}
      style={{ opacity, transform, pointerEvents, zIndex }}
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
        style={surfaceStyle}
      >
        <motion.div
          className="notification-item-backdrop"
          style={{ '--notification-surface-fill-opacity': surfaceFillOpacity } as React.CSSProperties}
        />
        <motion.div
          className="notification-item-body"
          style={{ filter: bodyFilter }}
        >
          <div className="notification-item-content">
            <div className="notification-item-icon">{getStatusIcon()}</div>
            <div className="notification-item-text">
              <div className="notification-item-label">{label || 'Task'}</div>
              <div className="notification-item-message">{message}</div>
              {warning && (
                <div className="notification-item-warning">{warning}</div>
              )}
              <div className="notification-item-time">{formatRelativeTime(updatedAt)}</div>
            </div>

            {renderCustomSlot()}

            <button
              className="notification-item-close"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(id);
              }}
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <Close size="xs" />
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default NotificationItem;
