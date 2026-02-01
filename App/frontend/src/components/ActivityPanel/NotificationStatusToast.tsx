import React, { useCallback } from 'react';
import { useNotificationStore } from '../../store/notificationStore';
import { useNotificationToastStore } from '../../store/notificationToastStore';
import './NotificationStatusToast.css';

const NotificationStatusToast: React.FC = () => {
  const toast = useNotificationToastStore((s) => s.toast);
  const clear = useNotificationToastStore((s) => s.clear);

  const handleClick = useCallback(() => {
    if (!toast) return;
    useNotificationStore.getState().invokeHandler(toast.id, 'onClick');
    clear();
  }, [toast, clear]);

  if (!toast) return null;

  const text = toast.message ? `${toast.label}: ${toast.message}` : toast.label;
  const role = toast.status === 'error' ? 'alert' : 'status';

  return (
    <div className={`notification-status-toast notification-status-toast--${toast.status}`} role={role}>
      <button
        type="button"
        className="notification-status-toast__button"
        onClick={handleClick}
        title={text}
        aria-label={text}
      >
        <span
          className={`notification-status-toast__dot notification-status-toast__dot--${toast.status}`}
          aria-hidden="true"
        />
        <span className="notification-status-toast__text">{text}</span>
      </button>
    </div>
  );
};

export default NotificationStatusToast;

