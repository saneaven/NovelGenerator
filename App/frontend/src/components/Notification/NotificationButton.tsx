import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { Bell } from '../icons';
import { IconButton } from '../IconButton';
import NotificationPanel from './NotificationPanel';
import './Notification.css';

interface NotificationButtonProps {
  position?: 'desktop' | 'mobile';
  className?: string;
}

const NotificationButton: React.FC<NotificationButtonProps> = ({
  position = 'desktop',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
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
      setIsOpen(true);
    } else {
      // Closing with animation
      setIsClosing(true);
      setTimeout(() => {
        setIsOpen(false);
        setIsClosing(false);
      }, 150);
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 150);
  };

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
  }, [isOpen, isClosing]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && !isClosing) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isClosing]);

  const buttonSize = position === 'mobile' ? 'sm' : 'md';

  return (
    <div className={`notification-button-wrapper notification-button-wrapper--${position} ${className}`}>
      <IconButton
        ref={buttonRef}
        icon={<Bell size="xl" />}
        onClick={handleToggle}
        title="Notifications"
        ariaLabel="Notifications"
        ariaExpanded={isOpen}
        isActive={isOpen}
        showSpinner={hasRunning}
        showDot={hasUnread && !hasRunning}
        size={buttonSize}
      />

      {isOpen && (
        <div
          ref={panelRef}
          className={`notification-panel-container ${isClosing ? 'notification-panel-container--closing' : ''}`}
        >
          <NotificationPanel onClose={handleClose} />
        </div>
      )}
    </div>
  );
};

export default NotificationButton;
