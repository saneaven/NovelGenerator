/**
 * Image Task Notification Subscriber
 * Subscribes to imageTaskStore and registers notifications reactively
 */

import React from 'react';
import { useImageTaskStore } from './store/imageTaskStore';
import { useNotificationStore } from '../store/notificationStore';
import { ImageTaskModals } from './ImageTaskModals';
import type { ImageTaskState, ImageTaskStatus } from './types';
import type { NotificationStatus, NotificationData } from '../store/notificationStore/types';
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

/**
 * Build notification data from task
 */
function buildNotificationData(task: ImageTaskState): NotificationData {
  const thumbnailUrl =
    task.status === 'success' && task.result?.thumbnailUrl
      ? `${API_BASE_URL}${task.result.thumbnailUrl}`
      : undefined;

  return {
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
}

// Track previous tasks to detect changes
let prevTasks: Record<string, ImageTaskState | undefined> = {};

/**
 * Initialize the subscription - call this once at app startup
 */
export function initImageNotificationSubscriber(): () => void {
  // Register modal renderer
  useNotificationStore.getState().registerModalRenderer(SOURCE, () => React.createElement(ImageTaskModals));

  const unsubscribe = useImageTaskStore.subscribe((state) => {
    const { tasks, openModal, cancelTask, clearTask } = state;
    const notificationStore = useNotificationStore.getState();

    // Detect added/changed tasks
    for (const [id, task] of Object.entries(tasks)) {
      if (!task || task.status === 'idle') continue;

      const prev = prevTasks[id];
      const isNew = !prev || prev.status === 'idle';
      const isChanged = prev && prev !== task;

      if (isNew) {
        // Register new notification
        notificationStore.register(buildNotificationData(task), {
          onClick: () => openModal(task.id),
          onDismiss: () => {
            // Cancel running tasks when dismissed
            if (isRunning(task.status)) {
              cancelTask(id);
            }
            clearTask(id);
          },
          onCancel: () => cancelTask(id),
          onRetry: task.retryContext ? () => openModal(task.id) : undefined,
        });
      } else if (isChanged) {
        // Update existing notification
        notificationStore.update(id, buildNotificationData(task));
      }
    }

    // Detect removed tasks
    for (const id of Object.keys(prevTasks)) {
      const prev = prevTasks[id];
      const current = tasks[id];
      if (prev && prev.status !== 'idle' && (!current || current.status === 'idle')) {
        // Remove notification without invoking onDismiss
        useNotificationStore.setState((state) => {
          const entry = state.notifications[id];
          if (entry && entry.source === SOURCE) {
            const { [id]: _, ...rest } = state.notifications;
            return { notifications: rest };
          }
          return state;
        });
      }
    }

    prevTasks = { ...tasks };
  });

  return () => {
    useNotificationStore.getState().unregisterModalRenderer(SOURCE);
    unsubscribe();
  };
}
