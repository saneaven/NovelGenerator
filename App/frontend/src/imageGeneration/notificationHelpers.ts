/**
 * Image Task Notification Helpers
 * Push-based notification registration, update, and removal
 */

import React from 'react';
import { useNotificationStore } from '../store/notificationStore';
import type { ImageTaskState, ImageTaskStatus } from './types';
import type { NotificationStatus, NotificationHandlers } from '../store/notificationStore/types';
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
 * Register a new notification for an image task
 */
export function registerImageNotification(
  task: ImageTaskState,
  handlers: NotificationHandlers
): void {
  const thumbnailUrl =
    task.status === 'success' && task.result?.thumbnailUrl
      ? `${API_BASE_URL}${task.result.thumbnailUrl}`
      : undefined;

  useNotificationStore.getState().register(
    {
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
    },
    handlers
  );
}

/**
 * Update an existing notification with current task state
 */
export function updateImageNotification(
  taskId: string,
  task: ImageTaskState
): void {
  const thumbnailUrl =
    task.status === 'success' && task.result?.thumbnailUrl
      ? `${API_BASE_URL}${task.result.thumbnailUrl}`
      : undefined;

  useNotificationStore.getState().update(taskId, {
    message: getMessage(task),
    status: mapStatus(task.status),
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
    customSlot: thumbnailUrl
      ? { type: 'thumbnail', url: thumbnailUrl, alt: 'Generated image' }
      : { type: 'none' },
  });
}

/**
 * Remove a notification without invoking onDismiss
 * (used when task is already handling cleanup)
 */
export function removeImageNotification(taskId: string): void {
  useNotificationStore.setState((state) => {
    const entry = state.notifications[taskId];
    if (entry && entry.source === SOURCE) {
      const { [taskId]: _, ...rest } = state.notifications;
      return { notifications: rest };
    }
    return state;
  });
}

/**
 * Register Image task modal renderer
 * Call once at app initialization
 */
export function registerImageModals(): void {
  import('./ImageTaskModals').then(({ ImageTaskModals }) => {
    useNotificationStore
      .getState()
      .registerModalRenderer(SOURCE, () => React.createElement(ImageTaskModals));
  });
}
