import type {
  NotificationDTO,
  NotificationSourceDTO,
  NotificationSourceKind,
  NotificationStatus as ServerNotificationStatus,
  NotificationTargetDTO,
} from '../../api/notificationService';

export type NotificationStatus = ServerNotificationStatus | 'idle';
export type NotificationServerDTO = NotificationDTO;
export type NotificationMeta = Record<string, unknown> | null;
export type NotificationSourceKindType = NotificationSourceKind;
export type NotificationSource = NotificationSourceDTO;
export type NotificationTarget = NotificationTargetDTO;

export interface NotificationProgress {
  current?: number;
  total?: number;
  stage?: string;
  label?: string;
  percentage?: number;
}

export type NotificationCustomSlot =
  | { type: 'none' }
  | { type: 'image'; url: string; alt?: string };

export interface NotificationEntry {
  id: string;
  projectId: string | null;
  source: NotificationSource;
  target: NotificationTarget;
  important: boolean;
  status: NotificationStatus;
  label: string;
  message: string;
  warning?: string;
  progress?: NotificationProgress;
  customSlot: NotificationCustomSlot;
  meta: NotificationMeta;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}
