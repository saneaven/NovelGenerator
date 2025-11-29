import React from 'react';
import type { NotificationType } from '../store/errorStore';
import './ErrorModal.css';

interface ErrorModalProps {
  isOpen: boolean;
  type?: NotificationType;
  title: string;
  message: string;
  onClose: () => void;
}

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: string; buttonClass: string }> = {
  success: { icon: '✓', buttonClass: 'notification-ok-btn--success' },
  error: { icon: '⚠️', buttonClass: 'notification-ok-btn--error' },
  info: { icon: 'ℹ️', buttonClass: 'notification-ok-btn--info' },
};

const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  type = 'error',
  title,
  message,
  onClose
}) => {
  if (!isOpen) return null;

  const config = NOTIFICATION_CONFIG[type];

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="error-modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className={`error-modal notification-modal--${type}`}>
        <div className="error-modal-header">
          <div className={`error-icon notification-icon--${type}`}>{config.icon}</div>
          <h3 className="error-title">{title}</h3>
          <button
            className="error-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="error-modal-body">
          <p className="error-message">{message}</p>
        </div>

        <div className="error-modal-footer">
          <button
            className={`error-ok-btn ${config.buttonClass}`}
            onClick={onClose}
            autoFocus
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorModal;
