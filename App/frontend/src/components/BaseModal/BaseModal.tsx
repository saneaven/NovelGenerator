import React, { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalHistory } from '../../hooks/useModalHistory';
import type { BaseModalProps } from './types';
import './BaseModal.css';

const BaseModal: React.FC<BaseModalProps> = ({
  isOpen,
  onClose,
  title,
  titleIcon,
  size = 'medium',
  showHeader = true,
  className = '',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  zIndexLayer = 0,
  showCloseButton = true,
  footer,
  children,
}) => {
  useModalHistory(isOpen, onClose);
  const modalRef = useRef<HTMLDivElement>(null);

  // Escape key handler
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  // Focus modal on open
  useEffect(() => {
    if (isOpen) {
      modalRef.current?.focus();
    }
  }, [isOpen]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlayClick && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  if (!isOpen) return null;

  const modalContent = (
    <div
      className={`base-modal-overlay base-modal-overlay--layer-${zIndexLayer}`}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'base-modal-title' : undefined}
    >
      <div
        ref={modalRef}
        className={`base-modal base-modal--${size} ${className}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {showHeader && (title || showCloseButton) && (
          <div className="base-modal-header">
            {title && (
              <h2 id="base-modal-title" className="base-modal-title">
                {titleIcon && <span className="base-modal-title-icon">{titleIcon}</span>}
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                className="base-modal-close"
                onClick={onClose}
                aria-label="Close"
                type="button"
              >
                &times;
              </button>
            )}
          </div>
        )}

        <div className="base-modal-body">{children}</div>

        {footer && <div className="base-modal-footer">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default BaseModal;
