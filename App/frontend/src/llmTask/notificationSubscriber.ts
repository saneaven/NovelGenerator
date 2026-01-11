/**
 * LLM Task Notification Subscriber
 * Subscribes to llmTaskStore and registers notifications reactively
 */

import React from 'react';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useNotificationStore } from '../store/notificationStore';
import { LLMTaskModals } from './LLMTaskModals';
import type { TaskSessionState, TaskSessionStatus } from './types';
import type { NotificationStatus, NotificationData } from '../store/notificationStore/types';

const SOURCE = 'llm';

type AnySession = TaskSessionState<any, any>;

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
function getMessage(session: AnySession): string {
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
 * Build notification data from session
 */
function buildNotificationData(session: AnySession): NotificationData {
  return {
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
}

// Track previous sessions to detect changes
let prevSessions: Record<string, AnySession | undefined> = {};

/**
 * Initialize the subscription - call this once at app startup
 */
export function initLLMNotificationSubscriber(): () => void {
  // Register modal renderer
  useNotificationStore.getState().registerModalRenderer(SOURCE, () => React.createElement(LLMTaskModals));

  const unsubscribe = useLLMTaskStore.subscribe((state) => {
    const { sessions, openDetail, cancelTask, clearNotification } = state;
    const notificationStore = useNotificationStore.getState();

    // Detect added/changed sessions
    for (const [id, session] of Object.entries(sessions)) {
      if (!session || session.status === 'idle') continue;

      const prev = prevSessions[id];
      const isNew = !prev || prev.status === 'idle';
      const isChanged = prev && prev !== session;

      if (isNew) {
        // Register new notification
        notificationStore.register(buildNotificationData(session), {
          onClick: () => openDetail(id),
          onDismiss: () => {
            // Cancel running tasks when dismissed
            if (session.status === 'running' || session.status === 'applying') {
              cancelTask(id);
            }
            clearNotification(id);
          },
          onCancel: () => cancelTask(id),
          onRetry: undefined,
        });
      } else if (isChanged) {
        // Update existing notification
        notificationStore.update(id, buildNotificationData(session));
      }
    }

    // Detect removed sessions
    for (const id of Object.keys(prevSessions)) {
      const prev = prevSessions[id];
      const current = sessions[id];
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

    prevSessions = { ...sessions };
  });

  return () => {
    useNotificationStore.getState().unregisterModalRenderer(SOURCE);
    unsubscribe();
  };
}
