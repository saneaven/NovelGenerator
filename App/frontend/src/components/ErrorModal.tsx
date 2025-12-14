import React from 'react';
import { useModalHistory } from '../hooks/useModalHistory';
import type { NotificationType } from '../store/errorStore';
import { Check, Warning, Info } from './icons';
import './ErrorModal.css';

interface ErrorModalProps {
  isOpen: boolean;
  type?: NotificationType;
  title: string;
  message: string;
  detail?: string | null;
  onClose: () => void;
}

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: React.ReactNode; buttonClass: string }> = {
  success: { icon: <Check size="xl" />, buttonClass: 'notification-ok-btn--success' },
  error: { icon: <Warning size="xl" />, buttonClass: 'notification-ok-btn--error' },
  info: { icon: <Info size="xl" />, buttonClass: 'notification-ok-btn--info' },
};

const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  type = 'error',
  title,
  message,
  detail,
  onClose
}) => {
  useModalHistory(isOpen, onClose);

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
          {detail && (
            <details className="error-detail">
              <summary>Show Detail</summary>
              <pre className="error-detail-content">{detail}</pre>
            </details>
          )}
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
