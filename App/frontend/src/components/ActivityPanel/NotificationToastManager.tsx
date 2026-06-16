import React, { useEffect, useRef } from 'react';
import { useNotificationsQuery } from '../../data/notifications';
import { useNotificationToastStore } from '../../store/notificationToastStore';
import type { NotificationEntry } from '../../domain/notifications';

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
  const { data, isSuccess } = useNotificationsQuery();
  const prevMapRef = useRef<Map<string, NotificationEntry>>(new Map());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isSuccess) return;

    const entries = Object.values(data);

    // Skip toasts on the first successful load: seed the baseline only.
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevMapRef.current = new Map(entries.map((entry) => [entry.id, entry]));
      return;
    }

    const prevMap = prevMapRef.current;
    const changed: NotificationEntry[] = [];

    for (const entry of entries) {
      const prevEntry = prevMap.get(entry.id);
      const isNew = prevEntry === undefined;
      const statusChanged = prevEntry !== undefined && prevEntry.status !== entry.status;
      if (!isNew && !statusChanged) continue;
      changed.push(entry);
    }

    if (changed.length > 0) {
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
    }

    prevMapRef.current = new Map(entries.map((entry) => [entry.id, entry]));
  }, [data, isSuccess]);

  return null;
};
