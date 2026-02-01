import React, { useEffect } from 'react';
import { useNotificationStore, type NotificationEntry } from '../../store/notificationStore';
import { useNotificationToastStore } from '../../store/notificationToastStore';

const DEFAULT_TOAST_DURATION_MS = 2500;

function toToastData(entry: NotificationEntry) {
  return {
    id: entry.id,
    label: entry.label || 'Task',
    message: entry.message || '',
    status: entry.status,
    updatedAt: entry.updatedAt,
  };
}

export const NotificationToastManager: React.FC = () => {
  useEffect(() => {
    const unsubscribe = useNotificationStore.subscribe((state, prevState) => {
      const nextMap = state.notifications;
      const prevMap = prevState.notifications;

      if (nextMap === prevMap) return;

      let selected: NotificationEntry | null = null;

      for (const [id, nextEntry] of Object.entries(nextMap)) {
        if (!nextEntry) continue;

        const prevEntry = prevMap[id];
        const isNew = prevEntry === undefined;
        const statusChanged = prevEntry !== undefined && prevEntry.status !== nextEntry.status;

        if (!isNew && !statusChanged) continue;

        if (!selected) {
          selected = nextEntry;
          continue;
        }

        const nextIsNewer =
          nextEntry.updatedAt > selected.updatedAt ||
          (nextEntry.updatedAt === selected.updatedAt && nextEntry.createdAt > selected.createdAt);

        if (nextIsNewer) {
          selected = nextEntry;
        }
      }

      if (!selected) return;

      useNotificationToastStore
        .getState()
        .show(toToastData(selected), DEFAULT_TOAST_DURATION_MS);
    });

    return unsubscribe;
  }, []);

  return null;
};
