/**
 * Legacy journey notification helpers intentionally reduced to no-ops.
 * Notifications are now fully server-managed.
 */

import type { Journey } from '../store/journeyStore';
import type { ThreadInfo } from '../types/thread';

export function registerJourneyNotification(_journey: Journey, _handlers: unknown): void {
  // No-op: backend notifications are the single source of truth.
}

export function updateJourneyNotificationFromThread(
  _journeyId: string,
  _journey: Journey,
  _thread: ThreadInfo,
  _isStreamActive?: boolean,
): void {
  // No-op: backend notifications are the single source of truth.
}

export function removeJourneyNotification(_journeyId: string): void {
  // No-op: deletion is handled by backend notification APIs.
}

export function registerJourneyModals(): void {
  // No-op: modal routing is source/meta-driven in NotificationModals.
}
