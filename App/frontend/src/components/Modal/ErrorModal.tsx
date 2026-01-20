import React from 'react';
import { BaseModal } from '../BaseModal';
import type { NotificationType } from '../../store/errorStore';
import { Check, Warning, Info } from '../icons';
import { TextButton } from '../TextButton';
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
  const config = NOTIFICATION_CONFIG[type];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      title={
        <>
          <span className={`notification-icon notification-icon--${type}`}>{config.icon}</span>
          {title}
        </>
      }
      className={`notification-modal notification-modal--${type}`}
      footer={
        <TextButton variant="primary" onClick={onClose}>
          OK
        </TextButton>
      }
    >
      <p className="notification-message">{message}</p>
      {detail && (
        <details className="notification-detail">
          <summary>Show Detail</summary>
          <pre className="notification-detail-content">{detail}</pre>
        </details>
      )}
    </BaseModal>
  );
};

export default ErrorModal;
