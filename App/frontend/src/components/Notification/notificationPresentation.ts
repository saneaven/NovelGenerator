import type { NotificationEntry, NotificationStatus } from '../../store/notificationStore';
import type { NotificationSourceKind } from '../../api/notificationService';

export type NotificationTone = 'active' | 'attention' | 'success' | 'neutral' | 'error';

export function formatNotificationStatusLabelFor(
  sourceKind: NotificationSourceKind,
  status: NotificationStatus,
): string {
  if (sourceKind === 'journey') {
    switch (status) {
      case 'running':
        return 'Running';
      case 'processing':
        return 'Applying changes';
      case 'waiting':
        return 'Needs confirmation';
      case 'paused':
        return 'Paused';
      case 'done':
        return 'Completed';
      case 'error':
        return 'Error';
      case 'canceled':
        return 'Canceled';
      default:
        return '';
    }
  }

  if (sourceKind === 'agent' || sourceKind === 'subAgent') {
    switch (status) {
      case 'running':
        return 'Running';
      case 'processing':
        return 'Applying changes';
      case 'waiting':
        return 'Needs confirmation';
      case 'paused':
        return 'Paused';
      case 'done':
        return 'Completed';
      case 'error':
        return 'Error';
      case 'canceled':
        return 'Canceled';
      default:
        return '';
    }
  }

  if (sourceKind === 'imageRun') {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'running':
        return 'Running';
      case 'review':
        return 'Preview ready';
      case 'applying':
        return 'Applying';
      case 'applied':
        return 'Completed';
      case 'rejected':
        return 'Rejected';
      case 'failed':
        return 'Failed';
      case 'canceled':
        return 'Canceled';
      default:
        return '';
    }
  }

  switch (status) {
    case 'running':
      return 'Running';
    case 'done':
      return 'Completed';
    case 'error':
      return 'Error';
    case 'canceled':
      return 'Canceled';
    default:
      return '';
  }
}

export function formatNotificationStatusLabel(entry: NotificationEntry): string {
  return formatNotificationStatusLabelFor(entry.source.kind, entry.status);
}

export function getNotificationToneFor(
  sourceKind: NotificationSourceKind,
  status: NotificationStatus,
): NotificationTone {
  if (sourceKind === 'journey') {
    if (status === 'running' || status === 'processing') return 'active';
    if (status === 'waiting' || status === 'paused') return 'attention';
    if (status === 'done') return 'success';
    if (status === 'error') return 'error';
    return 'neutral';
  }

  if (sourceKind === 'agent' || sourceKind === 'subAgent') {
    if (status === 'running' || status === 'processing') return 'active';
    if (status === 'waiting' || status === 'paused') return 'attention';
    if (status === 'done') return 'success';
    if (status === 'error') return 'error';
    return 'neutral';
  }

  if (sourceKind === 'imageRun') {
    if (status === 'queued' || status === 'running' || status === 'applying') return 'active';
    if (status === 'review') return 'attention';
    if (status === 'applied') return 'success';
    if (status === 'failed') return 'error';
    return 'neutral';
  }

  if (status === 'running') return 'active';
  if (status === 'done') return 'success';
  if (status === 'error') return 'error';
  return 'neutral';
}

export function getNotificationTone(entry: NotificationEntry): NotificationTone {
  return getNotificationToneFor(entry.source.kind, entry.status);
}

export function isNotificationActive(entry: NotificationEntry): boolean {
  return getNotificationTone(entry) === 'active';
}

export function shouldShowSpinner(entry: NotificationEntry): boolean {
  return isNotificationActive(entry);
}
