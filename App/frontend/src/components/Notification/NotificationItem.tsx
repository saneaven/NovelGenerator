import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionTemplate, useTransform, useMotionValue, animate, useDragControls, type MotionValue } from 'motion/react';
import type { NotificationEntry } from '../../store/notificationStore';
import AuthenticatedImage from '../common/AuthenticatedImage';
import { Check, Close, ChevronRight, Trash } from '../icons';
import { Loading } from '../common/Loading';

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
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
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
  scrollRootRef,
  onDismiss,
  onClick,
}) => {
  const { id, label, message, status, updatedAt, isRead, customSlot, warning, source, important } = notification;
  const itemRef = useRef<HTMLDivElement>(null);
  const [itemTop, setItemTop] = useState(0);
  const [itemHeight, setItemHeight] = useState(0);
  const [shouldLoadThumbnail, setShouldLoadThumbnail] = useState(false);
  const hasImageThumbnail = customSlot.type === 'image';

  // Swipe-to-delete
  const DELETE_THRESHOLD = 80;
  const dragX = useMotionValue(0);
  const dragControls = useDragControls();
  const deleteWidth = useTransform(dragX, (v) => Math.abs(Math.min(0, v)));
  const deleteOpacity = useTransform(dragX, (v) => (v < -10 ? 1 : 0));
  const hasDraggedRef = useRef(false);

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

  useEffect(() => {
    if (!hasImageThumbnail) {
      setShouldLoadThumbnail(false);
      return;
    }

    if (shouldLoadThumbnail) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadThumbnail(true);
      return;
    }

    const node = itemRef.current;
    if (!node) return;

    const preloadDistance = Math.max(itemStride * 2, 120);
    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0);
        if (!isVisible) return;
        setShouldLoadThumbnail(true);
      },
      {
        root: scrollRootRef.current,
        rootMargin: `${preloadDistance}px 0px ${preloadDistance}px 0px`,
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasImageThumbnail, itemStride, scrollRootRef, shouldLoadThumbnail]);

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

  // Start drag manually - this allows buttons to work without triggering drag
  const startDrag = useCallback((e: React.PointerEvent) => {
    hasDraggedRef.current = false;
    dragControls.start(e);
  }, [dragControls]);

  // Track when actual drag movement occurs
  const handleDrag = useCallback(() => {
    hasDraggedRef.current = true;
  }, []);

  // Handle tap - check if drag occurred first
  const handleTap = useCallback(() => {
    if (hasDraggedRef.current) {
      return;
    }
    const currentX = dragX.get();
    if (currentX < 0) {
      animate(dragX, 0, { type: 'spring', stiffness: 500, damping: 30 });
      return;
    }
    if (status !== 'idle') {
      onClick(id);
    }
  }, [status, onClick, id, dragX]);

  // Snap based on current position, not offset from drag start
  const handleDragEnd = useCallback(
    () => {
      const currentX = dragX.get();
      if (currentX < -DELETE_THRESHOLD / 2) {
        animate(dragX, -DELETE_THRESHOLD, { type: 'spring', stiffness: 500, damping: 30 });
      } else {
        animate(dragX, 0, { type: 'spring', stiffness: 500, damping: 30 });
      }
    },
    [dragX, DELETE_THRESHOLD]
  );

  const handleChevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const currentX = dragX.get();
      if (currentX < 0) {
        animate(dragX, 0, { type: 'spring', stiffness: 500, damping: 30 });
      } else {
        animate(dragX, -DELETE_THRESHOLD, { type: 'spring', stiffness: 500, damping: 30 });
      }
    },
    [dragX, DELETE_THRESHOLD]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(id);
    },
    [onDismiss, id]
  );

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <Loading size="sm" />;
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

    if (customSlot.type === 'image') {
      return (
        <div className="notification-item-thumbnail">
          {shouldLoadThumbnail ? (
            <AuthenticatedImage
              src={customSlot.url}
              alt={customSlot.alt || 'Preview'}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
          ) : (
            <div
              className="notification-item-thumbnail-placeholder"
              aria-hidden="true"
            />
          )}
        </div>
      );
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
      className={`notification-item notification-item--${status} notification-item--${source.kind} ${isClickable ? 'notification-item--clickable' : ''} ${!isRead ? 'notification-item--unread' : ''} ${important ? 'notification-item--important' : ''}`}
      style={{ opacity, transform, pointerEvents, zIndex }}
    >
      <div className="notification-item-swipe-container">
        <motion.div
          className="notification-item-swipe-content"
          drag="x"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ left: -DELETE_THRESHOLD, right: 0 }}
          dragElastic={0.2}
          style={{ x: dragX }}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onTap={isClickable ? handleTap : undefined}
        >
          <div
            className="notification-item-surface"
            style={surfaceStyle}
            onPointerDown={startDrag}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={
              isClickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleTap();
                    }
                  }
                : undefined
            }
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
                  className="notification-item-chevron"
                  onClick={handleChevronClick}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Show delete"
                  aria-label="Show delete action"
                >
                  <ChevronRight size="xs" />
                </button>
              </div>
            </motion.div>
          </div>
        </motion.div>

        <motion.div
          className="notification-item-delete"
          style={{ width: deleteWidth, opacity: deleteOpacity }}
        >
          <button onClick={handleDelete} title="Delete" aria-label="Delete notification">
            <Trash size="lg" />
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default NotificationItem;
