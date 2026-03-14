import React, { useCallback } from 'react';
import { useNotificationStore } from '../../store/notificationStore';
import { useNotificationToastStore } from '../../store/notificationToastStore';
import { getNotificationToneFor } from '../Notification/notificationPresentation';
import './NotificationStatusToast.css';

const NotificationStatusToast: React.FC = () => {
  const toast = useNotificationToastStore((s) => s.activeToast);
  const clear = useNotificationToastStore((s) => s.clear);
  const openDetail = useNotificationStore((s) => s.openDetail);

  const handleClick = useCallback(() => {
    if (!toast) return;
    openDetail(toast.id);
    clear();
  }, [toast, clear, openDetail]);

  if (!toast) return null;

  const text = toast.message ? `${toast.label}: ${toast.message}` : toast.label;
  const tone = getNotificationToneFor(toast.sourceKind, toast.status);
  const role = tone === 'error' ? 'alert' : 'status';

  return (
    <div className={`notification-status-toast notification-status-toast--${tone}`} role={role}>
      <button
        type="button"
        className="notification-status-toast__button"
        onClick={handleClick}
        title={text}
        aria-label={text}
      >
        <span
          className={`notification-status-toast__dot notification-status-toast__dot--${tone}`}
          aria-hidden="true"
        />
        <span className="notification-status-toast__text">{text}</span>
      </button>
    </div>
  );
};

export default NotificationStatusToast;
