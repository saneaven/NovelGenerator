import { useNotificationStore } from '../store/notificationStore';
import { useImageTaskStore } from './store/imageTaskStore';
import type { ImageTaskState, ImageTaskStatus } from './types';
import type {
  NotificationStatus,
  NotificationData,
  NotificationHandlers,
} from '../store/notificationStore/types';
import { API_BASE_URL } from '../api/client';

const SOURCE = 'image';

/**
 * Maps Image task status to notification status
 */
function mapStatus(status: ImageTaskStatus): NotificationStatus {
  switch (status) {
    case 'preparing':
    case 'generating':
    case 'processing':
      return 'running';
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
 * Creates notification message from image task state
 */
function getMessage(task: ImageTaskState): string {
  switch (task.status) {
    case 'preparing':
      return 'Preparing...';
    case 'generating':
      return task.progress?.message || 'Generating...';
    case 'processing':
      return 'Processing...';
    case 'success':
      return 'Image generated';
    case 'error':
      return task.error || 'Generation failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

/**
 * Check if task is in a running state
 */
function isRunning(status: ImageTaskStatus): boolean {
  return status === 'preparing' || status === 'generating' || status === 'processing';
}

export interface ImageNotificationSyncOptions {
  onOpenPreview: (assetId: string) => void;
  onOpenRetry: (task: ImageTaskState) => void;
}

/**
 * Register/update image task in notification store
 */
export function syncImageTaskToNotifications(
  task: ImageTaskState,
  options: ImageNotificationSyncOptions
): void {
  const { register, update, getNotification } = useNotificationStore.getState();
  const { cancelTask, clearTask } = useImageTaskStore.getState();

  const existing = getNotification(task.id);

  // Build thumbnail slot if available
  const thumbnailUrl =
    task.status === 'success' && task.result?.thumbnailUrl
      ? `${API_BASE_URL}${task.result.thumbnailUrl}`
      : undefined;

  const data: NotificationData = {
    id: task.id,
    label: task.label,
    message: getMessage(task),
    status: mapStatus(task.status),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    isRead: task.isRead,
    progress: task.progress
      ? {
          current: 0,
          total: 100,
          label: task.progress.message,
          percentage: task.progress.percentage,
        }
      : undefined,
    source: SOURCE,
    customSlot: thumbnailUrl
      ? { type: 'thumbnail', url: thumbnailUrl, alt: 'Generated image' }
      : { type: 'none' },
  };

  const handlers: NotificationHandlers = {
    onClick: () => {
      if (task.status === 'error' && task.retryContext) {
        options.onOpenRetry(task);
      } else if (task.status === 'success' && task.result?.assetId) {
        options.onOpenPreview(task.result.assetId);
      }
    },
    onDismiss: () => {
      // Cancel running tasks when dismissed
      if (isRunning(task.status)) {
        cancelTask(task.id);
      }
      clearTask(task.id);
    },
    onCancel: () => cancelTask(task.id),
    onRetry: task.retryContext ? () => options.onOpenRetry(task) : undefined,
  };

  if (existing) {
    // Update existing notification (handlers stay the same)
    update(task.id, data);
  } else {
    // Register new notification
    register(data, handlers);
  }
}

/**
 * Remove image task from notification store
 */
export function removeImageTaskFromNotifications(taskId: string): void {
  const { notifications } = useNotificationStore.getState();
  const entry = notifications[taskId];
  if (entry && entry.source === SOURCE) {
    // Use direct delete without invoking onDismiss (task already removed from imageTaskStore)
    useNotificationStore.setState((state) => {
      const { [taskId]: _, ...rest } = state.notifications;
      return { notifications: rest };
    });
  }
}
