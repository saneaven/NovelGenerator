/**
 * Journey Notification Helpers
 * Push-based notification registration, update, and removal for journeys
 */

import React from 'react';
import { useNotificationStore } from '../store/notificationStore';
import type { Journey, JourneyStatus } from '../store/journeyStore';
import type { NotificationStatus, NotificationHandlers } from '../store/notificationStore/types';

const SOURCE = 'journey';

/**
 * Maps journey status to notification status
 */
function mapStatus(status: JourneyStatus): NotificationStatus {
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
 * Creates notification message from journey state
 */
function getMessage(journey: Journey): string {
  switch (journey.status) {
    case 'running':
    case 'applying':
      if (journey.progress) {
        return (
          journey.progress.currentItemLabel ||
          `${journey.progress.current}/${journey.progress.total}`
        );
      }
      return 'Processing...';
    case 'pending_confirmation':
      return 'Needs confirmation';
    case 'success':
      return 'Completed';
    case 'error':
      return journey.error || 'An error occurred';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

/**
 * Register a new notification for a journey
 */
export function registerJourneyNotification(
  journey: Journey,
  handlers: NotificationHandlers
): void {
  useNotificationStore.getState().register(
    {
      id: journey.id,
      label: journey.label,
      message: getMessage(journey),
      status: mapStatus(journey.status),
      createdAt: journey.createdAt,
      updatedAt: journey.updatedAt,
      isRead: journey.isRead,
      progress: journey.progress
        ? {
            current: journey.progress.current,
            total: journey.progress.total,
            label: journey.progress.currentItemLabel,
          }
        : undefined,
      source: SOURCE,
      warning: journey.warning,
      customSlot: { type: 'none' },
    },
    handlers
  );
}

/**
 * Update an existing notification with current journey state
 */
export function updateJourneyNotification(
  journeyId: string,
  journey: Journey
): void {
  useNotificationStore.getState().update(journeyId, {
    message: getMessage(journey),
    status: mapStatus(journey.status),
    updatedAt: journey.updatedAt,
    isRead: journey.isRead,
    progress: journey.progress
      ? {
          current: journey.progress.current,
          total: journey.progress.total,
          label: journey.progress.currentItemLabel,
        }
      : undefined,
    warning: journey.warning,
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
