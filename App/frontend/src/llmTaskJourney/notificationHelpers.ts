/**
 * Journey Notification Helpers
 * Push-based notification registration, update, and removal for journeys.
 * Status is derived from ThreadStore, not JourneyStore.
 */

import React from 'react';
import { useNotificationStore } from '../store/notificationStore';
import type { Journey } from '../store/journeyStore';
import type { ThreadInfo } from '../types/thread';
import type { NotificationStatus, NotificationHandlers } from '../store/notificationStore/types';

const SOURCE = 'journey';

/**
 * Maps ThreadStore status to notification status
 */
function mapThreadStatusToNotification(threadStatus: string | undefined, isStreamActive: boolean): NotificationStatus {
  if (!threadStatus) return 'idle';
  if (isStreamActive) return 'running';
  if (threadStatus === 'running') return 'running';
  if (threadStatus === 'waiting' || threadStatus === 'paused') return 'pending';
  if (threadStatus === 'processing') return 'running';
  if (threadStatus === 'error') return 'error';
  if (threadStatus === 'canceled') return 'cancelled';
  if (threadStatus === 'done') return 'success';
  return 'idle';
}

/**
 * Creates notification message from thread state
 */
function getMessageFromThread(thread: ThreadInfo | undefined): string {
  if (!thread) return '';
  if (thread.status === 'running') return 'Processing...';
  if (thread.status === 'processing') return 'Applying tools...';
  if (thread.status === 'waiting' || thread.status === 'paused') return 'Needs confirmation';
  if (thread.status === 'error') return thread.lastError || 'An error occurred';
  if (thread.status === 'canceled') return 'Canceled';
  if (thread.status === 'done') return 'Completed';
  return '';
}

/**
 * Register a new notification for a journey.
 * At registration time, the journey is always in "running" state (just dispatched).
 */
export function registerJourneyNotification(
  journey: Journey,
  handlers: NotificationHandlers
): void {
  const existing = useNotificationStore.getState().getNotification(journey.id);
  useNotificationStore.getState().register(
    {
      id: journey.id,
      label: journey.label,
      message: 'Processing...',
      status: 'running',
      createdAt: journey.createdAt,
      updatedAt: journey.updatedAt,
      isRead: existing?.isRead ?? false,
      source: SOURCE,
      customSlot: { type: 'none' },
    },
    handlers
  );
}

/**
 * Update an existing notification with current thread state.
 * Called by JourneyRuntime's ThreadStore subscription.
 */
export function updateJourneyNotificationFromThread(
  journeyId: string,
  _journey: Journey,
  thread: ThreadInfo,
  isStreamActive?: boolean,
): void {
  useNotificationStore.getState().update(journeyId, {
    message: getMessageFromThread(thread),
    status: mapThreadStatusToNotification(thread.status, Boolean(isStreamActive)),
    updatedAt: Date.now(),
  });
}

/**
 * Remove a notification without invoking onDismiss
 * (used when journey is already handling cleanup)
 */
export function removeJourneyNotification(journeyId: string): void {
  useNotificationStore.setState((state) => {
    const entry = state.notifications[journeyId];
    if (entry && entry.source === SOURCE) {
      const { [journeyId]: _, ...rest } = state.notifications;
      return { notifications: rest };
    }
    return state;
  });
}

/**
 * Register Journey modal renderer
 * Call once at app initialization
 */
export function registerJourneyModals(): void {
  import('./JourneyDetailModal').then(({ JourneyDetailModal }) => {
    useNotificationStore
      .getState()
      .registerModalRenderer(SOURCE, () => React.createElement(JourneyDetailModal));
  });
}
