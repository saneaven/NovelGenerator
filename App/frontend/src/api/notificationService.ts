import { apiClient } from './client';

export type NotificationSourceKind = 'journey' | 'imageRun' | 'system' | 'agent' | 'subAgent';
export type NotificationStatus =
  | 'running'
  | 'waiting'
  | 'processing'
  | 'paused'
  | 'done'
  | 'error'
  | 'canceled'
  | 'queued'
  | 'review'
  | 'applying'
  | 'applied'
  | 'rejected'
  | 'failed';
export type NotificationTargetKind = 'none' | 'project' | 'thread' | 'journey' | 'agent';

export interface NotificationProgressDTO {
  current?: number | null;
  total?: number | null;
  stage?: string | null;
  label?: string | null;
  percentage?: number | null;
}

export interface NotificationCustomSlotDTO {
  type: 'none' | 'image';
  url?: string | null;
  alt?: string | null;
}

export interface NotificationSourceDTO {
  kind: NotificationSourceKind;
  id: string;
  thread_id?: string | null;
  run_id?: string | null;
  journey_kind?: string | null;
  tool_call_id?: string | null;
  review_mode?: 'auto' | 'manual' | null;
  agent_id?: string | null;
}

export interface NotificationTargetDTO {
  kind: NotificationTargetKind;
  project_id?: string | null;
  thread_id?: string | null;
  journey_id?: string | null;
  agent_id?: string | null;
}

export interface NotificationDTO {
  id: string;
  project_id: string | null;
  source: NotificationSourceDTO;
  target: NotificationTargetDTO;
  important: boolean;
  status: NotificationStatus;
  label: string;
  message: string;
  warning: string | null;
  progress: NotificationProgressDTO | null;
  custom_slot: NotificationCustomSlotDTO | null;
  meta: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationListResponseDTO {
  items: NotificationDTO[];
  total: number;
}

export interface MarkNotificationsReadRequestDTO {
  notification_ids?: string[];
  mark_all: boolean;
}

export interface MarkNotificationsReadResponseDTO {
  updated: number;
  ids: string[];
}

export interface DeleteAllNotificationsRequestDTO {
  only_read: boolean;
}

export interface DeleteAllNotificationsResponseDTO {
  deleted: number;
  ids: string[];
}

export interface ListNotificationsParams {
  limit?: number;
  offset?: number;
  includeRead?: boolean;
  kind?: NotificationSourceKind;
  projectId?: string;
  important?: boolean;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

export const notificationService = {
  async list(params: ListNotificationsParams = {}): Promise<NotificationListResponseDTO> {
    const query = new URLSearchParams();
    query.set('limit', String(params.limit ?? DEFAULT_LIMIT));
    query.set('offset', String(params.offset ?? DEFAULT_OFFSET));
    query.set('include_read', String(params.includeRead ?? true));
    if (params.kind) {
      query.set('kind', params.kind);
    }
    if (params.projectId) {
      query.set('project_id', params.projectId);
    }
    if (typeof params.important === 'boolean') {
      query.set('important', String(params.important));
    }
    const suffix = query.toString();
    return apiClient.get<NotificationListResponseDTO>(`/api/v1/notifications${suffix ? `?${suffix}` : ''}`);
  },

  async markRead(payload: MarkNotificationsReadRequestDTO): Promise<MarkNotificationsReadResponseDTO> {
    return apiClient.patch<MarkNotificationsReadResponseDTO>('/api/v1/notifications/read', payload);
  },

  async deleteOne(notificationId: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/notifications/${notificationId}`);
  },

  async deleteAll(
    payload: DeleteAllNotificationsRequestDTO,
  ): Promise<DeleteAllNotificationsResponseDTO> {
    return apiClient.post<DeleteAllNotificationsResponseDTO>('/api/v1/notifications/delete-all', payload);
  },
};

export default notificationService;
