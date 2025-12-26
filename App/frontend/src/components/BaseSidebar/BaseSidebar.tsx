import React, { useEffect, useCallback } from 'react';
import { useSidebarStore } from '../../store/sidebarStore';
import type { BaseSidebarProps } from './types';
import './BaseSidebar.css';

const BaseSidebar: React.FC<BaseSidebarProps> = ({
  id,
  projectId = '__global__',
  position,
  className = '',
  children,
  onClose,
  header,
  closeOnEscape = true,
  zIndex,
}) => {
  const isVisible = useSidebarStore((state) => state.isOpen(projectId, id));
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  // Handle close action
  const handleClose = useCallback(() => {
    closeSidebar(projectId);
    onClose?.();
  }, [closeSidebar, projectId, onClose]);

  // Escape key handler
  useEffect(() => {
    if (!closeOnEscape || !isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, isVisible, handleClose]);

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (isVisible) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isVisible]);

  // Build class names
  const sidebarClasses = [
    'base-sidebar',
    `base-sidebar--${position}`,
    isVisible && 'base-sidebar--open',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Build inline styles
  const sidebarStyle: React.CSSProperties = {
    ...(zIndex !== undefined && { zIndex }),
  } as React.CSSProperties;

  // Show backdrop when sidebar is open
  const showBackdrop = isVisible;

  return (
    <>
      {showBackdrop && (
        <div
          className="base-sidebar-backdrop"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}
      <aside className={sidebarClasses} style={sidebarStyle}>
        {header && <div className="base-sidebar-header">{header}</div>}
        <div className="base-sidebar-content">{children}</div>
      </aside>
    </>
  );
};

export default BaseSidebar;
