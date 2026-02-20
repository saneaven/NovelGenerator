import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationService } from '../../api/notificationService';
import { useProjectStore } from '../../store/projectStore';
import { useNotificationStore } from '../../store/notificationStore';
import NotificationItem from '../Notification/NotificationItem';
import { useScroll } from 'motion/react';

interface NotificationsViewProps {
  isMobile?: boolean;
}

const NotificationsView: React.FC<NotificationsViewProps> = ({ isMobile: isMobileProp }) => {
  const { t } = useTranslation();
  const itemsViewportRef = useRef<HTMLDivElement>(null);
  const itemsContainerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: itemsViewportRef });
  const [itemStride, setItemStride] = useState(80);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [isMobileDetected, setIsMobileDetected] = useState(false);

  const isMobile = isMobileProp ?? isMobileDetected;

  // Stack visualization constants
  const frontCount = 4;
  const depthRange = 4;
  const maxDepthZ = 260;
  const stackLift = 40;
  const maxBlur = 6;

  // Subscribe to raw state, derive sorted list with useMemo
  const notificationsMap = useNotificationStore((state) => state.notifications);
  const removeFromServer = useNotificationStore((state) => state.removeFromServer);
  const openDetail = useNotificationStore((state) => state.openDetail);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  // Derive sorted notifications from raw state
  const notifications = useMemo(
    () =>
      Object.values(notificationsMap)
        .filter((n): n is NonNullable<typeof n> => n !== undefined && n.status !== 'idle')
        .sort((a, b) => b.createdAt - a.createdAt),
    [notificationsMap]
  );

  // Reverse order for mobile (bottom-to-top stacking)
  const orderedNotifications = useMemo(() => {
    if (!isMobile) return notifications;
    return [...notifications].reverse();
  }, [notifications, isMobile]);

  const handleDismiss = useCallback(
    (id: string) => {
      if (!currentProjectId) return;
      void notificationService.deleteOne(currentProjectId, id)
        .then(() => {
          removeFromServer(id);
        })
        .catch((error) => {
          console.warn('Failed to delete notification', { id, currentProjectId, error });
        });
    },
    [currentProjectId, removeFromServer]
  );

  const handleClick = useCallback(
    (id: string) => {
      openDetail(id);
    },
    [openDetail]
  );

  // Detect mobile viewport
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleChange = () => setIsMobileDetected(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  // Measure item stride for stack visualization
  useLayoutEffect(() => {
    const container = itemsContainerRef.current;
    const viewport = itemsViewportRef.current;
    if (!container || !viewport) return;
    let frameId = 0;

    const measure = () => {
      const firstItem = container.querySelector<HTMLElement>('.notification-item');
      if (!firstItem) return;
      const styles = getComputedStyle(container);
      const gap = parseFloat(styles.rowGap || styles.gap || '0') || 0;
      const height = firstItem.getBoundingClientRect().height;
      if (height > 0) {
        setItemStride(height + gap);
      }
      const viewportBox = viewport.getBoundingClientRect();
      if (viewportBox.height > 0) {
        setViewportHeight(viewportBox.height);
      }
    };

    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(measure);
    };

    measure();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    resizeObserver.observe(viewport);
    const firstItem = container.querySelector<HTMLElement>('.notification-item');
    if (firstItem) {
      resizeObserver.observe(firstItem);
    }

    window.addEventListener('resize', scheduleMeasure);
    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [orderedNotifications.length, orderedNotifications[0]?.id]);

  // Auto-scroll to bottom on mobile
  useLayoutEffect(() => {
    if (!isMobile) return;
    const viewport = itemsViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isMobile, orderedNotifications.length]);

  return (
    <div className="notification-items-viewport" ref={itemsViewportRef}>
      <div
        className="notification-items-container"
        ref={itemsContainerRef}
        style={{
          paddingTop: isMobile ? stackLift * (depthRange + 2) : undefined,
          paddingBottom: !isMobile ? stackLift * (depthRange + 2) : undefined,
        }}
      >
        {orderedNotifications.length === 0 ? (
          <div className="notification-empty">
            <p>{t('activity.noNotifications')}</p>
          </div>
        ) : (
          orderedNotifications.map((notification, index) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              index={index}
              totalCount={orderedNotifications.length}
              scrollY={scrollY}
              itemStride={itemStride}
              viewportHeight={viewportHeight}
              frontCount={frontCount}
              depthRange={depthRange}
              maxDepthZ={maxDepthZ}
              stackLift={stackLift}
              maxBlur={maxBlur}
              isMobile={isMobile}
              onDismiss={handleDismiss}
              onClick={handleClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default NotificationsView;
