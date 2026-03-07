import { apiClient } from './client';

export type NotificationSource = 'journey' | 'imageRun';
export type NotificationStatus = 'running' | 'pending' | 'success' | 'error' | 'cancelled';

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

export interface NotificationDTO {
  id: string;
  project_id: string;
  source: NotificationSource;
  source_ref_id: string;
  thread_id: string | null;
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
  source?: NotificationSource;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

export const notificationService = {
  async list(
    projectId: string,
    params: ListNotificationsParams = {},
  ): Promise<NotificationListResponseDTO> {
    const query = new URLSearchParams();
    query.set('limit', String(params.limit ?? DEFAULT_LIMIT));
    query.set('offset', String(params.offset ?? DEFAULT_OFFSET));
    query.set('include_read', String(params.includeRead ?? true));
    if (params.source) {
      query.set('source', params.source);
    }
    const suffix = query.toString();
    return apiClient.get<NotificationListResponseDTO>(
      `/api/v1/projects/${projectId}/notifications${suffix ? `?${suffix}` : ''}`,
    );
  },

  async markRead(
    projectId: string,
    payload: MarkNotificationsReadRequestDTO,
  ): Promise<MarkNotificationsReadResponseDTO> {
    return apiClient.patch<MarkNotificationsReadResponseDTO>(
      `/api/v1/projects/${projectId}/notifications/read`,
      payload,
    );
  },

  async deleteOne(projectId: string, notificationId: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/projects/${projectId}/notifications/${notificationId}`);
  },

  async deleteAll(
    projectId: string,
    payload: DeleteAllNotificationsRequestDTO,
  ): Promise<DeleteAllNotificationsResponseDTO> {
    return apiClient.post<DeleteAllNotificationsResponseDTO>(
      `/api/v1/projects/${projectId}/notifications/delete-all`,
      payload,
    );
  },
};

export default notificationService;
