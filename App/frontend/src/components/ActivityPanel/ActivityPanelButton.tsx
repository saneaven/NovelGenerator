import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  useHasRunningNotifications,
  useHasUnreadNotifications,
  useMarkAllNotificationsReadMutation,
} from '../../data/notifications';
import { useNotificationToastStore } from '../../store/notificationToastStore';
import { Bell } from '../icons';
import { IconButton } from '../IconButton';
import ActivityPanelContainer, { type ActivityView } from './ActivityPanelContainer';
import NotificationStatusToast from './NotificationStatusToast';
import './ActivityPanel.css';
import '../Notification/Notification.css';

interface ActivityPanelButtonProps {
  position?: 'desktop' | 'mobile';
  className?: string;
}

const DESKTOP_PANEL_WIDTH = 320;
const MOBILE_BREAKPOINT = 768;
const FALLBACK_VIEWPORT_PADDING = 16;
const FALLBACK_DESKTOP_GAP = 8;
const FALLBACK_MOBILE_GAP = 12;

function resolveCssLength(value: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;

  const trimmed = value.trim();
  if (!trimmed) return fallback;

  if (trimmed.endsWith('px')) {
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (trimmed.endsWith('rem')) {
    const parsed = Number.parseFloat(trimmed);
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Number.isFinite(parsed) ? parsed * rootFontSize : fallback;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const ActivityPanelButton: React.FC<ActivityPanelButtonProps> = ({
  position = 'desktop',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [activeView, setActiveView] = useState<ActivityView>('notifications');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const positionFrameRef = useRef<number | null>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);

  // Subscribe to notification state for indicators
  const hasUnread = useHasUnreadNotifications();
  const hasRunning = useHasRunningNotifications();
  const markAllRead = useMarkAllNotificationsReadMutation();

  const computePanelStyle = useCallback((): React.CSSProperties | null => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !buttonRef.current) {
      return null;
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const viewportPadding = resolveCssLength(
      rootStyle.getPropertyValue('--spacing-lg'),
      FALLBACK_VIEWPORT_PADDING,
    );
    const desktopGap = resolveCssLength(
      rootStyle.getPropertyValue('--spacing-sm'),
      FALLBACK_DESKTOP_GAP,
    );
    const mobileGap = resolveCssLength(
      rootStyle.getPropertyValue('--spacing-md'),
      FALLBACK_MOBILE_GAP,
    );
    const { innerWidth, innerHeight } = window;
    const rect = buttonRef.current.getBoundingClientRect();
    const availableWidth = Math.max(innerWidth - viewportPadding * 2, 0);
    const width = position === 'mobile'
      ? availableWidth
      : innerWidth <= MOBILE_BREAKPOINT
        ? availableWidth
        : Math.min(DESKTOP_PANEL_WIDTH, availableWidth);

    if (position === 'mobile') {
      return {
        width,
        right: Math.max(viewportPadding, innerWidth - rect.right),
        bottom: innerHeight - rect.top + mobileGap,
      };
    }

    const maxLeft = Math.max(viewportPadding, innerWidth - width - viewportPadding);
    return {
      width,
      top: rect.bottom + desktopGap,
      left: Math.min(Math.max(rect.left, viewportPadding), maxLeft),
    };
  }, [position]);

  const updatePanelPosition = useCallback(() => {
    const nextStyle = computePanelStyle();
    if (!nextStyle) return;
    setPanelStyle(nextStyle);
  }, [computePanelStyle]);

  const schedulePanelPositionUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (positionFrameRef.current !== null) return;

    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null;
      updatePanelPosition();
    });
  }, [updatePanelPosition]);

  const handleClose = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (closeTimeoutRef.current !== null) return;

    setIsClosing(true);
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      setIsOpen(false);
      setIsClosing(false);
      setPanelStyle(null);
      useNotificationToastStore.getState().setActivityPanelOpen(false);
    }, 150);
  }, []);

  const handleToggle = useCallback(() => {
    if (!isOpen) {
      // Opening the panel - mark all as read
      markAllRead.mutate();
      useNotificationToastStore.getState().setActivityPanelOpen(true);
      setPanelStyle(computePanelStyle() ?? { visibility: 'hidden' });
      setIsOpen(true);
      setActiveView('notifications'); // Reset to notifications on open
    } else {
      handleClose();
    }
  }, [isOpen, markAllRead, handleClose, computePanelStyle]);

  const handleViewChange = useCallback((view: ActivityView) => {
    setActiveView(view);
  }, []);

  // Safety: ensure toast suppression doesn't stick if this component unmounts while open.
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current);
      }
      useNotificationToastStore.getState().setActivityPanelOpen(false);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    schedulePanelPositionUpdate();

    const handleViewportChange = () => {
      schedulePanelPositionUpdate();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && buttonRef.current) {
      resizeObserver = new ResizeObserver(() => {
        schedulePanelPositionUpdate();
      });
      resizeObserver.observe(buttonRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      resizeObserver?.disconnect();
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current);
        positionFrameRef.current = null;
      }
    };
  }, [isOpen, schedulePanelPositionUpdate]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        !isClosing &&
        buttonRef.current &&
        panelRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        !panelRef.current.contains(event.target as Node)
      ) {
        // Check if click is on a modal (don't close panel when modal is open)
        const target = event.target as HTMLElement;
        if (target.closest('.base-modal-overlay')) {
          return;
        }
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing, handleClose]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && !isClosing) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isClosing, handleClose]);

  // Close on custom event (e.g. notification click navigating away)
  useEffect(() => {
    const handleForceClose = () => {
      if (isOpen && !isClosing) {
        handleClose();
      }
    };

    document.addEventListener('activity-panel:close', handleForceClose);
    return () => document.removeEventListener('activity-panel:close', handleForceClose);
  }, [isOpen, isClosing, handleClose]);

  const buttonSize = position === 'mobile' ? 'md' : 'lg';
  const isMobile = position === 'mobile';
  const panel = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        className={`activity-panel-container activity-panel-container--portal activity-panel-container--${position} ${isClosing ? 'activity-panel-container--closing' : ''}`}
        style={panelStyle ?? { visibility: 'hidden' }}
      >
        <ActivityPanelContainer
          activeView={activeView}
          onViewChange={handleViewChange}
          isMobile={isMobile}
        />
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={`activity-panel-button-wrapper activity-panel-button-wrapper--${position} ${className}`}>
      <IconButton
        ref={buttonRef}
        icon={<Bell size="xl" />}
        onClick={handleToggle}
        title="Activity"
        ariaLabel="Activity panel"
        ariaExpanded={isOpen}
        isActive={isOpen}
        showSpinner={hasRunning}
        showDot={hasUnread && !hasRunning}
        size={buttonSize}
        className={"activity-panel-button"}
      />

      <NotificationStatusToast />
      {panel}
    </div>
  );
};

export default ActivityPanelButton;
