import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useNotificationToastStore } from '../../store/notificationToastStore';
import { useFunctionCallUIStore } from '../../toolCall/ui';
import { getNotificationToneFor } from '../Notification/notificationPresentation';
import './NotificationStatusToast.css';

const NotificationStatusToast: React.FC = () => {
  const navigate = useNavigate();
  const toast = useNotificationToastStore((s) => s.activeToast);
  const clear = useNotificationToastStore((s) => s.clear);

  const handleClick = useCallback(() => {
    if (!toast) return;
    clear();
    const notification = useNotificationStore.getState().notifications[toast.id];
    if (!notification) return;

    if (notification.target.kind === 'agent' && notification.target.project_id) {
      const agentId = notification.target.agent_id;
      if (agentId) {
        useAgentStore.getState().selectAgent(notification.target.project_id, agentId);
        useAgentUIStore.getState().setAgentVisible(notification.target.project_id, true);
      }
      if (notification.source.kind === 'subAgent' && notification.meta) {
        const parentThreadId = notification.meta.parent_thread_id as string | undefined;
        const parentMessageId = notification.meta.parent_message_id as string | undefined;
        const childThreadId = notification.meta.child_thread_id as string | undefined;
        if (parentThreadId && parentMessageId) {
          const peekKey = `${parentThreadId}:${parentMessageId}:peek`;
          const fcStore = useFunctionCallUIStore.getState();
          fcStore.setPeekOpen(peekKey, true);
          if (childThreadId) fcStore.setSelectedPeekRun(peekKey, childThreadId);
        }
      }
      navigate(`/project/${notification.target.project_id}`);
      return;
    }
    if (notification.target.kind === 'project' && notification.target.project_id) {
      navigate(`/project/${notification.target.project_id}`);
      return;
    }
    useNotificationStore.getState().openDetail(toast.id);
  }, [toast, clear, navigate]);

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
