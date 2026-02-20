/**
 * Legacy image task notification helpers intentionally reduced to no-ops.
 * Notifications are now fully server-managed.
 */

import type { ImageTaskSession } from './types';

export function registerImageTaskNotification(_session: ImageTaskSession, _handlers: unknown): void {
  // No-op: backend notifications are the single source of truth.
}

export function updateImageTaskNotification(_session: ImageTaskSession): void {
  // No-op: backend notifications are the single source of truth.
}

export function removeImageTaskNotificationSilently(_taskId: string): void {
  // No-op: deletion is handled by backend notification APIs.
}

export function registerImageTaskModals(): void {
  // No-op: modal routing is source/meta-driven in NotificationModals.
}
