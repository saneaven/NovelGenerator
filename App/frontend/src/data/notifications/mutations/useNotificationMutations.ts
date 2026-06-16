/**
 * Notification mutations (delete one, delete all, mark all read).
 *
 * Each reproduces the old store's optimistic-update + manual-rollback via
 * onMutate/onError against the `notificationKeys.list()` map cache (see
 * data/presets/mutations/useVariableMutations for the pattern). SSE delete/
 * upsert events may also arrive for the same change — that's fine, they
 * converge on the same cache state.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '../../../api/notificationService';
import { notificationKeys } from '../../keys/notificationKeys';
import type { NotificationMap } from '../useNotificationsQuery';

/** Optimistically drop a notification, rolling back on error. */
export function useDeleteNotificationMutation() {
  const qc = useQueryClient();
  const key = notificationKeys.list();
  return useMutation({
    mutationFn: (id: string) => notificationService.deleteOne(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NotificationMap>(key);
      if (prev?.[id]) {
        const { [id]: _drop, ...rest } = prev;
        qc.setQueryData<NotificationMap>(key, rest);
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });
}

/** Optimistically clear the whole feed, rolling back on error. */
export function useDeleteAllNotificationsMutation() {
  const qc = useQueryClient();
  const key = notificationKeys.list();
  return useMutation({
    mutationFn: () => notificationService.deleteAll({ only_read: false }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NotificationMap>(key);
      qc.setQueryData<NotificationMap>(key, {});
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });
}

/** Optimistically mark every notification read, rolling back on error. */
export function useMarkAllNotificationsReadMutation() {
  const qc = useQueryClient();
  const key = notificationKeys.list();
  return useMutation({
    mutationFn: () => notificationService.markRead({ mark_all: true }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NotificationMap>(key);
      if (prev) {
        const next: NotificationMap = {};
        for (const [id, entry] of Object.entries(prev)) {
          next[id] = { ...entry, isRead: true };
        }
        qc.setQueryData<NotificationMap>(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });
}
