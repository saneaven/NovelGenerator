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
export type NotificationTarget = NotificationTargetDTO;

export type JourneyNotificationStatus =
  Extract<ServerNotificationStatus, 'running' | 'waiting' | 'processing' | 'paused' | 'done' | 'error' | 'canceled'>;
export type ImageRunNotificationStatus =
  Extract<ServerNotificationStatus, 'queued' | 'running' | 'review' | 'applying' | 'applied' | 'rejected' | 'failed' | 'canceled'>;
export type SystemNotificationStatus =
  Extract<ServerNotificationStatus, 'running' | 'done' | 'error' | 'canceled'>;

export type JourneyNotificationSource = NotificationSourceDTO & {
  kind: 'journey';
  thread_id?: string | null;
  run_id?: string | null;
  journey_kind?: string | null;
};

export type ImageRunNotificationSource = NotificationSourceDTO & {
  kind: 'imageRun';
  thread_id?: string | null;
  tool_call_id?: string | null;
  review_mode?: 'auto' | 'manual' | null;
};

export type SystemNotificationSource = NotificationSourceDTO & {
  kind: 'system';
};

export type NotificationSource =
  | JourneyNotificationSource
  | ImageRunNotificationSource
  | SystemNotificationSource;

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

interface NotificationEntryBase<S extends NotificationSource, T extends ServerNotificationStatus> {
  id: string;
  projectId: string | null;
  source: S;
  target: NotificationTarget;
  important: boolean;
  status: T;
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

export type JourneyNotificationEntry = NotificationEntryBase<JourneyNotificationSource, JourneyNotificationStatus>;
export type ImageRunNotificationEntry = NotificationEntryBase<ImageRunNotificationSource, ImageRunNotificationStatus>;
export type SystemNotificationEntry = NotificationEntryBase<SystemNotificationSource, SystemNotificationStatus>;

export type NotificationEntry =
  | JourneyNotificationEntry
  | ImageRunNotificationEntry
  | SystemNotificationEntry;
