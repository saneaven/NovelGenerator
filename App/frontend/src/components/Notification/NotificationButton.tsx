import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { Bell } from '../icons';
import NotificationPanel from './NotificationPanel';

interface NotificationButtonProps {
  position?: 'desktop' | 'mobile';
  className?: string;
}

const NotificationButton: React.FC<NotificationButtonProps> = ({
  position = 'desktop',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Select raw sessions object (stable reference) and derive values with useMemo
  const sessionsMap = useLLMTaskStore((state) => state.sessions);
  const hasUnread = useMemo(() =>
    Object.values(sessionsMap).some(s => s && !s.isRead && s.status !== 'running'),
    [sessionsMap]
  );
  const hasRunning = useMemo(() =>
    Object.values(sessionsMap).some(s => s && s.status === 'running'),
    [sessionsMap]
  );
  const markAllAsRead = useLLMTaskStore((state) => state.markAllAsRead);

  const handleToggle = () => {
    if (!isOpen) {
      // Opening the panel - mark all as read
      markAllAsRead();
    }
    setIsOpen(!isOpen);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        buttonRef.current &&
        panelRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        !panelRef.current.contains(event.target as Node)
      ) {
        // Check if click is on a modal (don't close panel when modal is open)
        const target = event.target as HTMLElement;
        if (target.closest('.modal-overlay')) {
          return;
        }
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  return (
    <div className={`notification-button-wrapper notification-button-wrapper--${position} ${className}`}>
      <button
        ref={buttonRef}
        className={`notification-button ${isOpen ? 'notification-button--active' : ''}`}
        onClick={handleToggle}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <div className="notification-button-icon">
          <Bell size="xl" />
          {hasRunning && (
            <div className="notification-button-spinner">
              <div className="notification-button-spinner-ring" />
            </div>
          )}
        </div>
        {hasUnread && !hasRunning && (
          <span className="notification-button-dot" />
        )}
      </button>

      {isOpen && (
        <div ref={panelRef} className="notification-panel-container">
          <NotificationPanel onClose={handleClose} position={position} />
        </div>
      )}
    </div>
  );
};

export default NotificationButton;
