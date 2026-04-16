import apiClient from './client';
import type {
  AdminMemorySummaryResponse,
  AdminMemoryTracemallocAction,
  AdminMemoryTracemallocState,
  AdminUserUpdateRequest,
  AdminUsersStorageResponse,
  AdminUserStorageItem,
} from './types';

export const adminService = {
  async listUsersStorage(): Promise<AdminUsersStorageResponse> {
    return apiClient.get<AdminUsersStorageResponse>('/api/v1/admin/users/storage');
  },

  async updateUser(userId: string, data: AdminUserUpdateRequest): Promise<AdminUserStorageItem> {
    return apiClient.patch<AdminUserStorageItem>(`/api/v1/admin/users/${userId}`, data);
  },

  async getMemorySummary(): Promise<AdminMemorySummaryResponse> {
    return apiClient.get<AdminMemorySummaryResponse>('/api/v1/admin/memory/summary');
  },

  async controlTracemalloc(
    action: AdminMemoryTracemallocAction,
  ): Promise<AdminMemoryTracemallocState> {
    return apiClient.post<AdminMemoryTracemallocState>(
      '/api/v1/admin/memory/tracemalloc',
      { action },
    );
  },
};

export default adminService;
