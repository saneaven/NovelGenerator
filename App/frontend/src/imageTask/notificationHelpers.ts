/**
 * Image Task Notification Helpers (LLMTask-style)
 * Push-based notification registration, update, and removal
 */

import React from 'react';
import { getAssetUrl } from '../utils/assetUrl';
import { useNotificationStore } from '../store/notificationStore';
import type { NotificationHandlers, NotificationStatus } from '../store/notificationStore/types';
import type { ImageProgressStage, ImageTaskSession, ImageTaskStatus } from './types';

const SOURCE = 'image';
const STAGES: ImageProgressStage[] = ['preparing', 'generating', 'saving', 'binding'];

function mapStatus(status: ImageTaskStatus): NotificationStatus {
  switch (status) {
    case 'running':
      return 'running';
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

function toNotificationProgress(session: ImageTaskSession) {
  const p = session.progress;
  if (!p || session.status !== 'running') return undefined;
  const idx = Math.max(0, STAGES.indexOf(p.stage));
  return { current: idx + 1, total: STAGES.length, label: p.message };
}

function getMessage(session: ImageTaskSession): string {
  if (session.status === 'running') return session.progress?.message ?? 'Working...';
  if (session.status === 'success') return 'Completed';
  if (session.status === 'error') return session.error ?? 'An error occurred';
  if (session.status === 'cancelled') return 'Cancelled';
  return '';
}

export function registerImageTaskNotification(session: ImageTaskSession, handlers: NotificationHandlers): void {
  const existing = useNotificationStore.getState().getNotification(session.id);
  const thumbnailUrl = session.status === 'success'
    ? getAssetUrl(session.result?.asset, 'thumbnail') ?? undefined
    : undefined;

  useNotificationStore.getState().register(
    {
      id: session.id,
      label: session.input.label ?? 'Image generation',
      message: getMessage(session),
      status: mapStatus(session.status),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      isRead: existing?.isRead ?? false,
      progress: toNotificationProgress(session),
      source: SOURCE,
      customSlot: thumbnailUrl
        ? { type: 'thumbnail', url: thumbnailUrl, alt: 'Generated image' }
        : { type: 'none' },
    },
    handlers
  );
}

export function updateImageTaskNotification(session: ImageTaskSession): void {
  const thumbnailUrl = session.status === 'success'
    ? getAssetUrl(session.result?.asset, 'thumbnail') ?? undefined
    : undefined;

  useNotificationStore.getState().update(session.id, {
    message: getMessage(session),
    status: mapStatus(session.status),
    updatedAt: session.updatedAt,
    progress: toNotificationProgress(session),
    customSlot: thumbnailUrl
      ? { type: 'thumbnail', url: thumbnailUrl, alt: 'Generated image' }
      : { type: 'none' },
  });
}

export function removeImageTaskNotificationSilently(taskId: string): void {
  useNotificationStore.setState((state) => {
    const entry = state.notifications[taskId];
    if (entry && entry.source === SOURCE) {
      const { [taskId]: _, ...rest } = state.notifications;
      return { notifications: rest };
    }
    return state;
  });
}

export function registerImageTaskModals(): void {
  import('./ImageTaskModals').then(({ ImageTaskModals }) => {
    useNotificationStore
      .getState()
      .registerModalRenderer(SOURCE, () => React.createElement(ImageTaskModals));
  });
}

