/**
 * LLM Task Notification Helpers
 * Push-based notification registration, update, and removal
 */

import React from 'react';
import { useNotificationStore } from '../store/notificationStore';
import type { TaskSessionState, TaskSessionStatus } from './types';
import type { NotificationStatus, NotificationHandlers } from '../store/notificationStore/types';

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

/**
 * Register a new notification for a session
 */
export function registerSessionNotification(
  session: TaskSessionState,
  handlers: NotificationHandlers
): void {
  useNotificationStore.getState().register(
    {
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
    },
    handlers
  );
}

/**
 * Update an existing notification with current session state
 */
export function updateSessionNotification(
  sessionId: string,
  session: TaskSessionState
): void {
  useNotificationStore.getState().update(sessionId, {
    message: getMessage(session),
    status: mapStatus(session.status),
    updatedAt: session.updatedAt,
    isRead: session.isRead,
    progress: session.progress
      ? {
          current: session.progress.current,
          total: session.progress.total,
          label: session.progress.currentItemLabel,
        }
      : undefined,
    warning: session.warning,
  });
}

/**
 * Remove a notification without invoking onDismiss
 * (used when task is already handling cleanup)
 */
export function removeSessionNotification(sessionId: string): void {
  useNotificationStore.setState((state) => {
    const entry = state.notifications[sessionId];
    if (entry && entry.source === SOURCE) {
      const { [sessionId]: _, ...rest } = state.notifications;
      return { notifications: rest };
    }
    return state;
  });
}

/**
 * Register LLM task modal renderer
 * Call once at app initialization
 */
export function registerLLMModals(): void {
  import('./LLMTaskModals').then(({ LLMTaskModals }) => {
    useNotificationStore
      .getState()
      .registerModalRenderer(SOURCE, () => React.createElement(LLMTaskModals));
  });
}
