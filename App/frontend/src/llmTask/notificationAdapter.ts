import { useNotificationStore } from '../store/notificationStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import type { TaskSessionState, TaskSessionStatus } from './types';
import type {
  NotificationStatus,
  NotificationData,
  NotificationHandlers,
} from '../store/notificationStore/types';

const SOURCE = 'llm';

/**
 * Maps LLM task status to notification status
 */
function mapStatus(status: TaskSessionStatus): NotificationStatus {
  switch (status) {
    case 'running':
    case 'applying':
      return 'running';
    case 'pending_confirmation':
      return 'pending';
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'idle';
  }
}

/**
 * Creates notification message from LLM task state
 */
function getMessage(session: TaskSessionState): string {
  switch (session.status) {
    case 'running':
    case 'applying':
      if (session.progress) {
        return (
          session.progress.currentItemLabel ||
          `${session.progress.current}/${session.progress.total}`
        );
      }
      return 'Processing...';
    case 'pending_confirmation':
      return 'Needs confirmation';
    case 'success':
      return 'Completed';
    case 'error':
      return session.error || 'An error occurred';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

export interface LLMNotificationSyncOptions {
  onOpenDetail: (sessionId: string) => void;
}

/**
 * Register/update LLM task in notification store
 */
export function syncLLMTaskToNotifications(
  session: TaskSessionState,
  options: LLMNotificationSyncOptions
): void {
  const { register, update, getNotification } = useNotificationStore.getState();
  const { cancelTask, clearNotification } = useLLMTaskStore.getState();

  const existing = getNotification(session.id);

  const data: NotificationData = {
    id: session.id,
    label: session.label,
    message: getMessage(session),
    status: mapStatus(session.status),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    isRead: session.isRead,
    progress: session.progress
      ? {
          current: session.progress.current,
          total: session.progress.total,
          label: session.progress.currentItemLabel,
        }
      : undefined,
    source: SOURCE,
    warning: session.warning,
    customSlot: { type: 'none' },
  };

  const handlers: NotificationHandlers = {
    onClick: () => options.onOpenDetail(session.id),
    onDismiss: () => {
      // Cancel running tasks when dismissed
      if (session.status === 'running' || session.status === 'applying') {
        cancelTask(session.id);
      }
      clearNotification(session.id);
    },
    onCancel: () => cancelTask(session.id),
    // Retry is handled inside the detail modal, not from the notification item
    onRetry: undefined,
  };

  if (existing) {
    // Update existing notification (handlers stay the same)
    update(session.id, data);
  } else {
    // Register new notification
    register(data, handlers);
  }
}

/**
 * Remove LLM task from notification store
 */
export function removeLLMTaskFromNotifications(sessionId: string): void {
  const { notifications } = useNotificationStore.getState();
  const entry = notifications[sessionId];
  if (entry && entry.source === SOURCE) {
    // Use direct delete without invoking onDismiss (task already removed from llmTaskStore)
    useNotificationStore.setState((state) => {
      const { [sessionId]: _, ...rest } = state.notifications;
      return { notifications: rest };
    });
  }
}
