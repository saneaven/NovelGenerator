/**
 * SSE → QueryClient bridge for in-app notifications.
 *
 * Replaces the old notificationStore upsert/remove actions. The
 * NotificationEventConsumer hands raw events here; each write patches the
 * `notificationKeys.list()` map cache in place (no refetch) so subscribers and
 * the toast manager react immediately.
 */

import { queryClient } from '../queryClient';
import { notificationKeys } from '../keys/notificationKeys';
import { normalizeNotification, type NotificationServerDTO } from '../../domain/notifications';
import type { NotificationMap } from '../notifications/useNotificationsQuery';

/** Insert or replace a notification from an `upsert` event. */
export function upsertNotificationFromSSE(dto: NotificationServerDTO): void {
  const entry = normalizeNotification(dto);
  if (!entry) return;
  queryClient.setQueryData<NotificationMap>(notificationKeys.list(), (prev) => ({
    ...(prev ?? {}),
    [entry.id]: entry,
  }));
}

/** Drop a single notification from a `delete` event. */
export function removeNotificationFromSSE(id: string): void {
  queryClient.setQueryData<NotificationMap>(notificationKeys.list(), (prev) => {
    if (!prev?.[id]) return prev;
    const { [id]: _drop, ...rest } = prev;
    return rest;
  });
}

/** Drop a batch of notifications from a `bulk_delete` event. */
export function removeManyNotificationsFromSSE(ids: string[]): void {
  if (!ids.length) return;
  const toDelete = new Set(ids);
  queryClient.setQueryData<NotificationMap>(notificationKeys.list(), (prev) => {
    if (!prev) return prev;
    let changed = false;
    const next: NotificationMap = {};
    for (const [id, entry] of Object.entries(prev)) {
      if (toDelete.has(id)) {
        changed = true;
        continue;
      }
      next[id] = entry;
    }
    return changed ? next : prev;
  });
}
