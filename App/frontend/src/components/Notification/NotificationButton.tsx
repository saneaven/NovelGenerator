import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { useImageTaskStore } from '../../imageGeneration/store/imageTaskStore';
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

  // LLM task store
  const llmSessionsMap = useLLMTaskStore((state) => state.sessions);
  const llmHasUnread = useMemo(() =>
    Object.values(llmSessionsMap).some(s => s && !s.isRead && s.status !== 'running'),
    [llmSessionsMap]
  );
  const llmHasRunning = useMemo(() =>
    Object.values(llmSessionsMap).some(s => s && s.status === 'running'),
    [llmSessionsMap]
  );
  const markAllLLMAsRead = useLLMTaskStore((state) => state.markAllAsRead);

  // Image task store
  const imageTasksMap = useImageTaskStore((state) => state.tasks);
  const imageHasUnread = useMemo(() =>
    Object.values(imageTasksMap).some(t => t && !t.isRead && t.status !== 'idle'),
    [imageTasksMap]
  );
  const imageHasRunning = useMemo(() =>
    Object.values(imageTasksMap).some(t => t && (t.status === 'preparing' || t.status === 'generating' || t.status === 'processing')),
    [imageTasksMap]
  );
  const markAllImageAsRead = useImageTaskStore((state) => state.markAllAsRead);

  // Combined state
  const hasUnread = llmHasUnread || imageHasUnread;
  const hasRunning = llmHasRunning || imageHasRunning;

  const markAllAsRead = useCallback(() => {
    markAllLLMAsRead();
    markAllImageAsRead();
  }, [markAllLLMAsRead, markAllImageAsRead]);

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
