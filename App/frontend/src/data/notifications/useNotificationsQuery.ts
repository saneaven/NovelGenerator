/**
 * Query for the in-app notification feed.
 *
 * Cache data is an id-keyed map (`Record<string, NotificationEntry>`), mirroring
 * the shape the old Zustand store held so SSE writes and optimistic mutations
 * stay O(1). Freshness is driven by the SSE layer (`sseNotificationBridge`), so
 * the shared `queryClient` defaults (no focus/reconnect refetch) apply.
 *
 * `select` fns and the empty-map sentinel live at module scope for stable
 * identity, so selector hooks don't churn on every render.
 */

import { useQuery } from '@tanstack/react-query';
import { notificationService } from '../../api/notificationService';
import { notificationKeys } from '../keys/notificationKeys';
import {
  hasRunningNotifications,
  hasUnreadNotifications,
  notificationsToRecord,
  sortNotifications,
  type NotificationEntry,
} from '../../domain/notifications';

export type NotificationMap = Record<string, NotificationEntry>;

const EMPTY: NotificationMap = {};

/**
 * Shared query options, so non-React callers (e.g. `runtimeStream`'s
 * rehydration via `queryClient.fetchQuery`) fetch the feed with the exact same
 * key and fetcher as the hook.
 */
export const notificationsQueryOptions = {
  queryKey: notificationKeys.list(),
  queryFn: () =>
    notificationService
      .list({ limit: 50, offset: 0, includeRead: true })
      .then((r) => notificationsToRecord(r.items)),
} as const;

function selectSorted(map: NotificationMap): NotificationEntry[] {
  return sortNotifications(Object.values(map));
}

function selectHasUnread(map: NotificationMap): boolean {
  return hasUnreadNotifications(Object.values(map));
}

function selectHasRunning(map: NotificationMap): boolean {
  return hasRunningNotifications(Object.values(map));
}

/** Subscribe to the raw notification feed (id → entry map). */
export function useNotificationsQuery() {
  return useQuery(notificationsQueryOptions);
}

/** Reactive id → entry map (empty object until loaded). */
export function useNotificationsMap(): NotificationMap {
  return useNotificationsQuery().data ?? EMPTY;
}

/** Notifications sorted for display (important first, unread, newest). */
export function useSortedNotifications(): NotificationEntry[] {
  return useQuery({ ...notificationsQueryOptions, select: selectSorted }).data ?? [];
}

/** A single notification by id, reactively. */
export function useNotificationById(
  id: string | null | undefined,
): NotificationEntry | undefined {
  return useNotificationsMap()[id ?? ''];
}

/** True when any notification is unread. */
export function useHasUnreadNotifications(): boolean {
  return useQuery({ ...notificationsQueryOptions, select: selectHasUnread }).data ?? false;
}

/** True when any notification is in an in-progress state. */
export function useHasRunningNotifications(): boolean {
  return useQuery({ ...notificationsQueryOptions, select: selectHasRunning }).data ?? false;
}
