/**
 * Non-React reads of the notification cache via the `queryClient` singleton.
 *
 * For imperative callers (toast click handlers) that need the current feed
 * without subscribing through a hook.
 */

import { queryClient } from '../queryClient';
import { notificationKeys } from '../keys/notificationKeys';
import type { NotificationEntry } from '../../domain/notifications';
import type { NotificationMap } from './useNotificationsQuery';

const EMPTY: NotificationMap = {};

/** Current id → entry map (empty object if nothing is cached yet). */
export function readNotificationsFromCache(): NotificationMap {
  return queryClient.getQueryData<NotificationMap>(notificationKeys.list()) ?? EMPTY;
}

/** A single cached notification by id. */
export function readNotificationFromCache(id: string): NotificationEntry | undefined {
  return readNotificationsFromCache()[id];
}
