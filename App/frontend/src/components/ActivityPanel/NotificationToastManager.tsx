import React, { useEffect } from 'react';
import { useNotificationStore, type NotificationEntry } from '../../store/notificationStore';
import { useNotificationToastStore } from '../../store/notificationToastStore';

const DEFAULT_TOAST_DURATION_MS = 2500;

function toToastData(entry: NotificationEntry) {
  return {
    id: entry.id,
    label: entry.label || 'Task',
    message: entry.message || '',
    sourceKind: entry.source.kind,
    status: entry.status,
    updatedAt: entry.updatedAt,
  };
}

export const NotificationToastManager: React.FC = () => {
  useEffect(() => {
    let initialized = Object.keys(useNotificationStore.getState().notifications).length > 0;
    const unsubscribe = useNotificationStore.subscribe((state, prevState) => {
      if (!initialized) {
        initialized = true;
        return;
      }

      const nextMap = state.notifications;
      const prevMap = prevState.notifications;

      if (nextMap === prevMap) return;
      const changed: NotificationEntry[] = [];

      for (const [id, nextEntry] of Object.entries(nextMap)) {
        if (!nextEntry) continue;

        const prevEntry = prevMap[id];
        const isNew = prevEntry === undefined;
        const statusChanged = prevEntry !== undefined && prevEntry.status !== nextEntry.status;

        if (!isNew && !statusChanged) continue;
        changed.push(nextEntry);
      }

      if (changed.length === 0) return;
      changed
        .sort((a, b) => {
          if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
          return a.createdAt - b.createdAt;
        })
        .forEach((entry) => {
          useNotificationToastStore
            .getState()
            .show(toToastData(entry), DEFAULT_TOAST_DURATION_MS);
        });
    });

    return unsubscribe;
  }, []);

  return null;
};
