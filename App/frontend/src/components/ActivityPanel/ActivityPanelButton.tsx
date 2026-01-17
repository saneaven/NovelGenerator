import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNotificationStore } from '../../store/notificationStore';
import { Bell } from '../icons';
import { IconButton } from '../IconButton';
import ActivityPanelContainer, { type ActivityView } from './ActivityPanelContainer';
import './ActivityPanel.css';
import '../Notification/Notification.css';

interface ActivityPanelButtonProps {
  position?: 'desktop' | 'mobile';
  className?: string;
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

  // Subscribe to notification state for indicators
  const notificationsMap = useNotificationStore((state) => state.notifications);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);

  const hasUnread = useMemo(
    () =>
      Object.values(notificationsMap).some(
        (n) => n !== undefined && n.status !== 'idle' && !n.isRead
      ),
    [notificationsMap]
  );

  const hasRunning = useMemo(
    () =>
      Object.values(notificationsMap).some(
        (n) => n !== undefined && n.status === 'running'
      ),
    [notificationsMap]
  );

  const handleToggle = useCallback(() => {
    if (!isOpen) {
      // Opening the panel - mark all as read
      markAllAsRead();
      setIsOpen(true);
      setActiveView('notifications'); // Reset to notifications on open
    } else {
      // Closing with animation
      setIsClosing(true);
      setTimeout(() => {
        setIsOpen(false);
        setIsClosing(false);
      }, 150);
    }
  }, [isOpen, markAllAsRead]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 150);
  }, []);

  const handleViewChange = useCallback((view: ActivityView) => {
    setActiveView(view);
  }, []);

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

  const buttonSize = position === 'mobile' ? 'sm' : 'md';
  const isMobile = position === 'mobile';

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
      />

      {isOpen && (
        <div
          ref={panelRef}
          className={`activity-panel-container ${isClosing ? 'activity-panel-container--closing' : ''}`}
        >
          <ActivityPanelContainer
            activeView={activeView}
            onViewChange={handleViewChange}
            isMobile={isMobile}
          />
        </div>
      )}
    </div>
  );
};

export default ActivityPanelButton;
